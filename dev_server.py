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
            "totalItems": data.get("totalItems", len(items)),
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
            # Invalidate cached catalog so user sees fresh data
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

        # 2. Upsert dev user
        await upsert_user(DEV_USER["id"], DEV_USER["username"], DEV_USER["first_name"])

        # 3. Create order in DB
        order_id = await create_order(
            user_id=DEV_USER["id"],
            lzt_item_id=item_id,
            item_title=title,
            item_category=str(item.get("category_id", "")),
            original_price=original_price,
            sell_price=sell_price,
            payment_method="stars",
        )
        logger.info("Order #%d created for item #%d", order_id, item_id)

        # 4. Purchase on LZT via fast-buy (single step, works for all categories)
        logger.info("Starting fast-buy for item #%d (original price: %.2f)...", item_id, original_price)
        try:
            result = await lzt_api.fast_buy(item_id, original_price)
        except Exception as buy_err:
            logger.error("Fast-buy failed for item #%d: %s", item_id, buy_err)
            await update_order_status(order_id, "error", error_message=str(buy_err))
            CATALOG_CACHE.clear()
            return web.json_response({"error": f"Ошибка покупки: {buy_err}"}, status=400)

        # 5. Extract account data
        purchased_item = result.get("item", {})
        account_data = {
            "loginData": purchased_item.get("loginData", {}),
            "account": purchased_item.get("account", ""),
            "password": purchased_item.get("password", ""),
            "email": purchased_item.get("email", ""),
            "emailPassword": purchased_item.get("emailPassword", ""),
            "item_id": item_id,
            "title": title,
        }

        # 6. Update order as completed
        await update_order_status(
            order_id, "completed",
            account_data=json.dumps(account_data, ensure_ascii=False),
        )
        logger.info("Order #%d completed! Item #%d purchased.", order_id, item_id)

        return web.json_response({
            "status": "completed",
            "order_id": order_id,
            "sell_price": sell_price,
            "original_price": original_price,
            "account_data": account_data,
        })

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
    """Get dev user orders."""
    orders = await get_user_orders(DEV_USER["id"])
    return web.json_response({"orders": orders})


async def get_balance(request: web.Request) -> web.Response:
    """Get LZT balance."""
    try:
        me = await lzt_api.get_me()
        return web.json_response({
            "balance": me.get("user", {}).get("balance", 0),
            "hold": me.get("user", {}).get("hold", 0),
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ═══════════════════════════════════════
# Admin endpoints
# ═══════════════════════════════════════

async def admin_stats(request: web.Request) -> web.Response:
    """Get admin dashboard stats."""
    try:
        stats = await get_stats()
        # Add LZT balance
        try:
            me = await lzt_api.get_me()
            stats["lzt_balance"] = me.get("user", {}).get("balance", 0)
        except Exception:
            stats["lzt_balance"] = 0
        return web.json_response(stats)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def admin_orders(request: web.Request) -> web.Response:
    """Get all orders for admin."""
    status = request.query.get("status")
    orders = await get_all_orders(status=status)
    return web.json_response({"orders": orders})


async def admin_users(request: web.Request) -> web.Response:
    """Get all users for admin."""
    users = await get_all_users()
    return web.json_response({"users": users})


async def user_balance(request: web.Request) -> web.Response:
    """Get current user's Stars balance."""
    user_id = DEV_USER["id"]
    # In production, extract user_id from Telegram init data
    balance = await get_user_balance(user_id)
    return web.json_response({"stars_balance": balance})


async def get_me(request: web.Request) -> web.Response:
    """Get current user info + admin check."""
    raw = request.query.get("user_id", "")
    try:
        user_id = int(raw) if raw else DEV_USER["id"]
    except ValueError:
        user_id = DEV_USER["id"]
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
        logger.info("LZT Market connected. Balance: $%s", balance)
    except Exception as e:
        logger.warning("LZT check failed: %s", e)
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
    app.router.add_get("/api/balance", get_balance)
    app.router.add_get("/api/admin/stats", admin_stats)
    app.router.add_get("/api/admin/orders", admin_orders)
    app.router.add_get("/api/admin/users", admin_users)
    app.router.add_get("/api/user/balance", user_balance)
    app.router.add_get("/api/me", get_me)

    # Serve webapp static files
    if WEBAPP_DIR.exists():
        app.router.add_static("/", WEBAPP_DIR, show_index=True)
        logger.info("Serving webapp from %s", WEBAPP_DIR)

    return app


if __name__ == "__main__":
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=8080, print=None)
