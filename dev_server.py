"""
Dev server — runs web API + serves webapp WITHOUT Telegram bot.
Bypasses Telegram auth for local testing.
Usage: python dev_server.py
"""
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

from aiohttp import web

# Ensure project root is in path
sys.path.insert(0, str(Path(__file__).parent))

from bot.services.lzt_api import lzt_api
from bot.config import settings
from bot.db import (
    init_db, create_order, update_order_status, get_user_orders,
    upsert_user, get_all_orders, get_all_users, get_stats, get_user_balance,
    deposit_stars, get_order,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("dev_server")

# Fake user for dev mode
DEV_USER = {"id": 999999, "username": "dev_tester", "first_name": "Dev"}

WEBAPP_DIR = Path(__file__).parent / "webapp"

# Cache: {key: (data, timestamp)}
CATALOG_CACHE: dict[str, tuple[dict, float]] = {}
CACHE_TTL = 45  # seconds — short TTL keeps items fresh
MAX_CACHE_ENTRIES = 50


# ═══════════════════════════════════════
# Catalog endpoints (real LZT data)
# ═══════════════════════════════════════

async def get_catalog(request: web.Request) -> web.Response:
    """Get items from LZT Market with markup. Only active items returned."""
    category = request.query.get("category", "telegram")
    page = int(request.query.get("page", "1"))
    pmin = request.query.get("pmin")
    pmax = request.query.get("pmax")
    title = request.query.get("title")
    order_by = request.query.get("order_by", "price")

    cache_key = f"{category}:{page}:{pmin}:{pmax}:{title}:{order_by}"

    # Check cache
    if cache_key in CATALOG_CACHE:
        cached_data, cached_at = CATALOG_CACHE[cache_key]
        if time.time() - cached_at < CACHE_TTL:
            return web.json_response(cached_data)
        else:
            del CATALOG_CACHE[cache_key]

    try:
        params: dict = {"page": page, "order_by": order_by}
        if pmin:
            params["pmin"] = float(pmin)
        if pmax:
            params["pmax"] = float(pmax)
        if title:
            params["title"] = title

        data = await lzt_api._request("GET", f"/{category}", params=params)

        raw_items = data.get("items", {})
        if isinstance(raw_items, dict):
            items = [v for v in raw_items.values() if isinstance(v, dict)]
        else:
            items = raw_items

        # Only keep active (available for purchase) items
        items = [i for i in items if i.get("item_state") == "active"]

        # Apply markup
        for item in items:
            original = item.get("price", 0)
            item["original_price"] = original
            item["price"] = settings.calculate_price(original)

        result = {
            "items": items,
            "totalItems": len(items),
            "currentPage": page,
        }

        # Store in cache (evict oldest if over limit)
        if len(CATALOG_CACHE) >= MAX_CACHE_ENTRIES:
            oldest_key = min(CATALOG_CACHE, key=lambda k: CATALOG_CACHE[k][1])
            del CATALOG_CACHE[oldest_key]
        CATALOG_CACHE[cache_key] = (result, time.time())

        return web.json_response(result)
    except Exception as e:
        logger.error("Catalog error: %s", e)
        return web.json_response({"error": str(e)}, status=500)


async def get_item_detail(request: web.Request) -> web.Response:
    """Get single item detail."""
    item_id = int(request.match_info["item_id"])
    try:
        data = await lzt_api.get_item(item_id)
        item = data.get("item", {})
        original = item.get("price", 0)
        item["original_price"] = original
        item["price"] = settings.calculate_price(original)
        return web.json_response({"item": item})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ═══════════════════════════════════════
# Purchase endpoint (real purchase!)
# ═══════════════════════════════════════

async def purchase_item(request: web.Request) -> web.Response:
    """Full purchase flow: reserve -> check -> confirm."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    item_id = body.get("item_id")
    if not item_id:
        return web.json_response({"error": "item_id required"}, status=400)

    item_id = int(item_id)

    try:
        # 1. Get item info
        logger.info("Purchase: getting item #%d info...", item_id)
        item_data = await lzt_api.get_item(item_id)
        item = item_data.get("item", {})
        if not item:
            return web.json_response({"error": "Товар не найден на маркете"}, status=404)

        original_price = item.get("price", 0)
        sell_price = settings.calculate_price(original_price)
        title = item.get("title", item.get("title_en", "Account"))

        state = item.get("item_state", "unknown")
        logger.info("Item #%d state: %s, price: %s", item_id, state, original_price)
        if state != "active":
            CATALOG_CACHE.clear()
            state_labels = {
                "closed": "уже продан",
                "deleted": "удалён",
                "awaiting": "на модерации",
            }
            label = state_labels.get(state, f"недоступен (статус: {state})")
            return web.json_response(
                {"error": f"Товар {label}. Обновите каталог."},
                status=400,
            )

        # Determine real user ID
        user_id = body.get("user_id")
        if not user_id:
            init_data = request.headers.get("X-Telegram-Init-Data", "")
            if init_data:
                from urllib.parse import parse_qs, unquote
                parsed = parse_qs(init_data)
                user_raw = parsed.get("user", [None])[0]
                if user_raw:
                    try:
                        tg_user = json.loads(unquote(user_raw))
                        user_id = tg_user.get("id")
                    except Exception:
                        pass
            if not user_id:
                admin_list = [int(x.strip()) for x in settings.admin_ids.split(",") if x.strip()]
                user_id = admin_list[0] if admin_list else DEV_USER["id"]
        user_id = int(user_id)

        # Check user has enough Stars balance
        user_bal = await get_user_balance(user_id)
        stars_needed = max(1, int(sell_price / 1.6))  # Same formula as frontend
        if user_bal < stars_needed:
            return web.json_response(
                {"error": f"Недостаточно Stars. Нужно ⭐{stars_needed}, у вас ⭐{user_bal}"},
                status=400,
            )

        # 2. Upsert user
        await upsert_user(user_id, None, None)

        # 3. Deduct Stars from user balance
        from bot.db import withdraw_stars
        stars_withdrawn = await withdraw_stars(user_id, stars_needed)
        if not stars_withdrawn:
            return web.json_response(
                {"error": "Не удалось списать Stars. Попробуйте ещё раз."},
                status=400,
            )
        logger.info("Deducted %d Stars from user %d", stars_needed, user_id)

        # 4. Create order in DB
        order_id = await create_order(
            user_id=user_id,
            lzt_item_id=item_id,
            item_title=title,
            item_category=str(item.get("category_id", "")),
            original_price=original_price,
            sell_price=sell_price,
            payment_method="stars",
        )
        logger.info("Order #%d created for item #%d", order_id, item_id)

        # 5. Purchase on LZT via fast-buy (includes account validation!)
        logger.info("Starting fast-buy for item #%d (price: %.2f)...", item_id, original_price)

        # Use StreamResponse to send real-time progress
        resp = web.StreamResponse(
            status=200,
            reason="OK",
            headers={"Content-Type": "application/x-ndjson", "Cache-Control": "no-cache"},
        )
        await resp.prepare(request)

        async def send_step(step: str, message: str) -> None:
            line = json.dumps({"step": step, "message": message}, ensure_ascii=False)
            await resp.write((line + "\n").encode())

        try:
            await send_step("check", "Проверяем аккаунт...")
            await send_step("confirm", "Оформляем покупку...")
            result = await lzt_api.fast_buy(item_id, original_price)
        except Exception as buy_err:
            logger.error("Fast-buy failed for item #%d: %s", item_id, buy_err)
            from bot.db import deposit_stars
            await deposit_stars(user_id, stars_needed)
            logger.info("Refunded %d Stars to user %d", stars_needed, user_id)
            await update_order_status(order_id, "error", error_message=str(buy_err))
            CATALOG_CACHE.clear()
            await send_step("error", _parse_lzt_error(buy_err))
            await resp.write_eof()
            return resp

        # 6. Extract account data
        purchased_item = result.get("item", {})
        login_data = purchased_item.get("loginData", {})
        account_data = {
            "loginData": login_data,
            "account": purchased_item.get("account", ""),
            "password": purchased_item.get("password", ""),
            "email": purchased_item.get("email", ""),
            "emailPassword": purchased_item.get("emailPassword", ""),
            "item_id": item_id,
            "title": title,
            # Telegram-specific fields
            "telegram_phone": purchased_item.get("telegram_phone", ""),
            "telegram_id": purchased_item.get("telegram_id", ""),
            "telegram_dc_id": purchased_item.get("telegram_dc_id", ""),
            "telegram_country": purchased_item.get("telegram_country", ""),
            "telegram_premium": purchased_item.get("telegram_premium", 0),
        }

        # 7. Update order as completed
        await update_order_status(
            order_id, "completed",
            account_data=json.dumps(account_data, ensure_ascii=False),
        )
        logger.info("Order #%d completed! Item #%d purchased.", order_id, item_id)
        CATALOG_CACHE.clear()

        await send_step("done", "Готово!")
        final = json.dumps({
            "step": "result",
            "status": "completed",
            "order_id": order_id,
            "sell_price": sell_price,
            "original_price": original_price,
            "account_data": account_data,
        }, ensure_ascii=False)
        await resp.write((final + "\n").encode())
        await resp.write_eof()
        return resp

    except Exception as e:
        logger.error("Purchase error for item #%s: %s", item_id, e, exc_info=True)
        order_id_local = locals().get("order_id")
        if order_id_local:
            try:
                await update_order_status(order_id_local, "error", error_message=str(e))
            except Exception:
                pass

        # PurchaseError = expected failure (sold, validation failed, etc)
        from bot.services.lzt_api import PurchaseError
        if isinstance(e, PurchaseError):
            CATALOG_CACHE.clear()
            return web.json_response({"error": str(e)}, status=400)

        return web.json_response({"error": str(e)}, status=500)


async def get_orders(request: web.Request) -> web.Response:
    """Get user orders."""
    user_id = request.query.get("user_id")
    if not user_id:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        if init_data:
            from urllib.parse import parse_qs, unquote
            parsed = parse_qs(init_data)
            user_raw = parsed.get("user", [None])[0]
            if user_raw:
                try:
                    tg_user = json.loads(unquote(user_raw))
                    user_id = tg_user.get("id")
                except Exception:
                    pass
        if not user_id:
            admin_list = [int(x.strip()) for x in settings.admin_ids.split(",") if x.strip()]
            user_id = admin_list[0] if admin_list else DEV_USER["id"]
    orders = await get_user_orders(int(user_id))
    return web.json_response({"orders": orders})


async def get_order_detail(request: web.Request) -> web.Response:
    """Get order details including account data."""
    order_id = int(request.match_info["order_id"])
    order = await get_order(order_id)
    if not order:
        return web.json_response({"error": "Заказ не найден"}, status=404)

    result = dict(order)
    # Parse account_data JSON string
    if result.get("account_data"):
        try:
            result["account_data"] = json.loads(result["account_data"])
        except Exception:
            pass

    return web.json_response({"order": result})


def _parse_lzt_error(error: str) -> str:
    """Convert raw LZT API error to user-friendly message."""
    e = str(error)
    if "недействительна" in e or "заблокирован" in e:
        return "Сессия недействительна — аккаунт заблокирован или деавторизован"
    if "Слишком новая авторизация" in e:
        return "Слишком новая авторизация. Подождите 24 часа (ограничение Telegram)"
    if "429" in e or "Too many" in e or "подождите" in e.lower():
        return "Слишком частые запросы. Подождите пару минут"
    if "не найден" in e or "404" in e:
        return "Аккаунт не найден на маркете"
    if "403" in e:
        # Try to extract the actual error message from JSON
        import re
        match = re.search(r'"errors":\s*\[\s*"(.+?)"', e)
        if match:
            return match.group(1)
        return "Доступ запрещён"
    return "Ошибка: " + e[:100]


async def telegram_login_code(request: web.Request) -> web.Response:
    """Request Telegram login code for a purchased account."""
    item_id = int(request.match_info["item_id"])
    try:
        result = await lzt_api._request("GET", f"/{item_id}/telegram-login-code")
        return web.json_response(result)
    except Exception as e:
        logger.error("Telegram code error for #%d: %s", item_id, e)
        return web.json_response({"error": _parse_lzt_error(e)}, status=400)


async def telegram_reset_auth(request: web.Request) -> web.Response:
    """Reset other Telegram authorizations for a purchased account."""
    item_id = int(request.match_info["item_id"])
    try:
        result = await lzt_api._request("POST", f"/{item_id}/telegram-reset-authorizations")
        return web.json_response(result)
    except Exception as e:
        logger.error("Telegram reset error for #%d: %s", item_id, e)
        return web.json_response({"error": _parse_lzt_error(e)}, status=400)


async def get_balance(request: web.Request) -> web.Response:
    """Get LZT balance (regular + purchase)."""
    try:
        me = await lzt_api.get_me()
        user_data = me.get("user", {})
        result = {
            "balance": user_data.get("balance", 0),
            "hold": user_data.get("hold", 0),
            "purchase_balance": 0,
        }
        # Get purchase balance from exchange data
        try:
            exchange = await lzt_api.get_balances()
            for key in ("from", "to"):
                for b in (exchange.get(key) or []):
                    if isinstance(b, dict):
                        name = (b.get("name", "") + b.get("title", "")).lower()
                        if "покупк" in name or b.get("type") == "account":
                            result["purchase_balance"] = b.get("amount", b.get("balance", 0))
        except Exception:
            pass
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ═══════════════════════════════════════
# User balance endpoint
# ═══════════════════════════════════════

async def user_balance(request: web.Request) -> web.Response:
    """Get current user's Stars balance."""
    # Try to get user_id from query, then from initData header, then fallback
    user_id = request.query.get("user_id")
    if user_id:
        user_id = int(user_id)
    else:
        # Try Telegram initData
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        if init_data:
            import json
            from urllib.parse import parse_qs, unquote
            parsed = parse_qs(init_data)
            user_raw = parsed.get("user", [None])[0]
            if user_raw:
                try:
                    tg_user = json.loads(unquote(user_raw))
                    user_id = tg_user.get("id")
                except Exception:
                    pass
        if not user_id:
            user_id = DEV_USER["id"]
    balance = await get_user_balance(user_id)
    return web.json_response({"stars_balance": balance, "user_id": user_id})


# ═══════════════════════════════════════
# Admin endpoints
# ═══════════════════════════════════════

async def admin_stats(request: web.Request) -> web.Response:
    """Get admin dashboard stats."""
    try:
        stats = await get_stats()
        # Add total Stars across all users
        from bot.db import get_db
        db = await get_db()
        try:
            cursor = await db.execute("SELECT COALESCE(SUM(stars_balance), 0) as total FROM users")
            row = await cursor.fetchone()
            stats["total_stars"] = row["total"] if row else 0
        finally:
            await db.close()
        # Add LZT balances (regular + purchase)
        try:
            me = await lzt_api.get_me()
            user_data = me.get("user", {})
            stats["lzt_balance"] = user_data.get("balance", 0)
            stats["lzt_hold"] = user_data.get("hold", 0)
            stats["lzt_purchase_balance"] = 0
            try:
                exchange = await lzt_api.get_balances()
                for key in ("from", "to"):
                    for b in (exchange.get(key) or []):
                        if isinstance(b, dict):
                            name = (b.get("name", "") + b.get("title", "")).lower()
                            if "покупк" in name or b.get("type") == "account":
                                stats["lzt_purchase_balance"] = b.get("amount", b.get("balance", 0))
            except Exception:
                pass
        except Exception:
            stats["lzt_balance"] = 0
            stats["lzt_purchase_balance"] = 0
        return web.json_response(stats)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def admin_deposit(request: web.Request) -> web.Response:
    """Admin: deposit Stars to a user's balance."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    user_id = body.get("user_id")
    amount = body.get("amount")

    if not user_id or not amount:
        return web.json_response({"error": "user_id and amount required"}, status=400)

    user_id = int(user_id)
    amount = int(amount)
    if amount <= 0:
        return web.json_response({"error": "amount must be positive"}, status=400)

    # Ensure user exists
    await upsert_user(user_id, None, None)

    new_balance = await deposit_stars(user_id, amount)
    logger.info("Admin deposited %d Stars to user %d, new balance: %d", amount, user_id, new_balance)

    return web.json_response({
        "ok": True,
        "user_id": user_id,
        "deposited": amount,
        "new_balance": new_balance,
    })


async def admin_orders(request: web.Request) -> web.Response:
    """Get all orders for admin."""
    status = request.query.get("status")
    orders = await get_all_orders(status=status)
    return web.json_response({"orders": orders})


async def admin_users(request: web.Request) -> web.Response:
    """Get all users for admin."""
    users = await get_all_users()
    return web.json_response({"users": users})


async def get_me(request: web.Request) -> web.Response:
    """Get current user info + admin check."""
    user_id = None

    # 1. Try Telegram initData header
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if init_data:
        import json as _json
        from urllib.parse import parse_qs, unquote
        parsed = parse_qs(init_data)
        user_raw = parsed.get("user", [None])[0]
        if user_raw:
            try:
                tg_user = _json.loads(unquote(user_raw))
                user_id = tg_user.get("id")
            except Exception:
                pass

    # 2. Try query param
    if not user_id:
        raw = request.query.get("user_id", "")
        if raw:
            try:
                user_id = int(raw)
            except ValueError:
                pass

    # 3. Fallback to first admin ID (the real owner)
    if not user_id:
        admin_list = [int(x.strip()) for x in settings.admin_ids.split(",") if x.strip()]
        user_id = admin_list[0] if admin_list else DEV_USER["id"]

    admin_ids = [int(x.strip()) for x in settings.admin_ids.split(",") if x.strip()]
    return web.json_response({
        "user_id": user_id,
        "is_admin": user_id in admin_ids,
    })

# ═══════════════════════════════════════
# CORS + Static
# ═══════════════════════════════════════

@web.middleware
async def cors_middleware(request: web.Request, handler) -> web.Response:
    if request.method == "OPTIONS":
        response = web.Response()
    else:
        try:
            response = await handler(request)
        except web.HTTPException as ex:
            response = ex

    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


async def on_startup(app: web.Application) -> None:
    await init_db()
    try:
        me = await lzt_api.get_me()
        balance = me.get("user", {}).get("balance", 0)
        logger.info("LZT Market connected. Balance: %s₽", balance)
    except Exception as e:
        logger.warning("LZT check failed: %s", e)
    # Detect purchase balance for fast-buy
    await lzt_api.init_purchase_balance()
    logger.info("Dev server ready! Open http://localhost:8080")


async def on_shutdown(app: web.Application) -> None:
    await lzt_api.close()


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)

    # API routes
    app.router.add_get("/api/catalog", get_catalog)
    app.router.add_get("/api/catalog/{item_id}", get_item_detail)
    app.router.add_post("/api/purchase", purchase_item)
    app.router.add_get("/api/orders/my", get_orders)
    app.router.add_get("/api/orders/{order_id}", get_order_detail)
    app.router.add_get("/api/telegram-code/{item_id}", telegram_login_code)
    app.router.add_post("/api/telegram-reset/{item_id}", telegram_reset_auth)
    app.router.add_get("/api/balance", get_balance)
    app.router.add_get("/api/admin/stats", admin_stats)
    app.router.add_get("/api/admin/orders", admin_orders)
    app.router.add_get("/api/admin/users", admin_users)
    app.router.add_post("/api/admin/deposit", admin_deposit)
    app.router.add_get("/api/user/balance", user_balance)
    app.router.add_get("/api/me", get_me)

    # Serve webapp static files
    if WEBAPP_DIR.exists():
        app.router.add_static("/", WEBAPP_DIR, show_index=False)
        logger.info("Serving webapp from %s", WEBAPP_DIR)

    return app


if __name__ == "__main__":
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=8080, print=None)
