"""
Dev server — runs web API + serves webapp.
Validates Telegram init data for auth in production.
Usage: python dev_server.py
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote

from aiohttp import web

# Ensure project root is in path
sys.path.insert(0, str(Path(__file__).parent))

from bot.services.lzt_api import lzt_api
from bot.config import settings
from bot.db import (
    init_db, create_order, update_order_status, get_user_orders,
    upsert_user, get_all_orders, get_all_users, get_stats, get_user_balance,
    deposit_stars, get_order,
    create_ticket, get_user_tickets, get_ticket_detail, add_ticket_message,
    close_ticket, get_all_tickets,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("dev_server")

# Fake user for dev mode (only when BOT_TOKEN is missing)
DEV_USER = {"id": 9999699, "username": "dev_tester", "first_name": "Dev"}
DEV_MODE = not settings.bot_token  # true only when no bot token configured

WEBAPP_DIR = Path(__file__).parent / "webapp"

# Cache: {key: (data, timestamp)}
CATALOG_CACHE: dict[str, tuple[dict, float]] = {}
CACHE_TTL = 45  # seconds — short TTL keeps items fresh
MAX_CACHE_ENTRIES = 50


# ═══════════════════════════════════════
# Telegram Init Data Validation
# ═══════════════════════════════════════

def validate_init_data(init_data: str) -> dict[str, Any] | None:
    """Validate Telegram Mini App init data. Returns user dict if valid."""
    try:
        parsed = parse_qs(init_data)
        received_hash = parsed.get("hash", [None])[0]
        if not received_hash:
            return None
        data_pairs = []
        for key, values in sorted(parsed.items()):
            if key != "hash":
                data_pairs.append(f"{key}={values[0]}")
        data_check_string = "\n".join(data_pairs)
        secret_key = hmac.new(b"WebAppData", settings.bot_token.encode(), hashlib.sha256).digest()
        computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(computed_hash, received_hash):
            return None
        user_raw = parsed.get("user", [None])[0]
        if user_raw:
            return json.loads(unquote(user_raw))
        return None
    except Exception as e:
        logger.error("Init data validation error: %s", e)
        return None


def get_user_from_request(request: web.Request) -> dict[str, Any] | None:
    """Extract and validate user from request. Returns user dict or None."""
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if init_data and settings.bot_token:
        user = validate_init_data(init_data)
        if user:
            return user
    # Dev mode fallback — only when bot token is not configured
    if DEV_MODE:
        admin_list = settings.admin_id_list
        uid = admin_list[0] if admin_list else DEV_USER["id"]
        return {"id": uid, "username": "dev", "first_name": "Dev"}
    return None


def require_auth(handler):
    """Decorator: require valid auth."""
    async def wrapper(request: web.Request) -> web.Response:
        user = get_user_from_request(request)
        if not user:
            return web.json_response({"error": "Unauthorized"}, status=401)
        request["tg_user"] = user
        return await handler(request)
    return wrapper


def require_admin(handler):
    """Decorator: require admin privileges."""
    async def wrapper(request: web.Request) -> web.Response:
        user = get_user_from_request(request)
        if not user:
            return web.json_response({"error": "Unauthorized"}, status=401)
        if not settings.is_admin(user.get("id", 0)):
            return web.json_response({"error": "Forbidden"}, status=403)
        request["tg_user"] = user
        return await handler(request)
    return wrapper


async def _notify_purchase(user_id: int, item_title: str, order_id: int, stars: int) -> None:
    """Send Telegram notification about successful purchase."""
    try:
        import aiohttp as _aio
        bot_token = settings.bot_token
        if not bot_token:
            return
        text = (
            f"🎉 <b>Покупка совершена!</b>\n\n"
            f"📦 <b>{item_title}</b>\n"
            f"💰 Списано: ⭐ {stars} Stars\n"
            f"🔖 Заказ #{order_id}\n\n"
            f"Откройте магазин, чтобы получить данные аккаунта."
        )
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        async with _aio.ClientSession() as s:
            await s.post(url, json={
                "chat_id": user_id,
                "text": text,
                "parse_mode": "HTML",
            })
    except Exception as e:
        logger.warning("Failed to send purchase notification: %s", e)


# ═══════════════════════════════════════
# Catalog endpoints (real LZT data)
# ═══════════════════════════════════════

@require_auth
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

        total_on_page = len(items) if isinstance(items, list) else 0

        # Only keep active (available for purchase) items
        items = [i for i in items if i.get("item_state") == "active"]

        # Strip to essential fields only (reduces 430KB → ~40KB)
        KEEP_FIELDS = {
            "item_id", "title", "title_en", "price", "original_price",
            "category_id", "item_state", "item_origin",
            "published_date", "refreshed_date",
            "telegram_phone", "telegram_id", "telegram_premium",
            "telegram_country", "telegram_dc_id",
            "description", "login",
        }

        # Apply markup and strip
        slim_items = []
        for item in items:
            original = item.get("price", 0)
            slim = {k: v for k, v in item.items() if k in KEEP_FIELDS}
            slim["original_price"] = original
            slim["price"] = settings.calculate_price(original)
            slim_items.append(slim)

        # hasMore = LZT returned items on this page (likely more pages exist)
        has_more = total_on_page >= 10

        result = {
            "items": slim_items,
            "totalItems": data.get("totalItems", len(slim_items)),
            "currentPage": page,
            "hasMore": has_more,
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


@require_auth
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

@require_auth
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

        # Get user ID from auth
        user_id = request["tg_user"]["id"]
        user_id = int(user_id)

        # Check user has enough Stars balance
        user_bal = await get_user_balance(user_id)
        stars_needed = sell_price  # calculate_price already returns Stars
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
        try:
            result = await lzt_api.fast_buy(item_id, original_price)
        except Exception as buy_err:
            logger.error("Fast-buy failed for item #%d: %s", item_id, buy_err)
            from bot.db import deposit_stars
            await deposit_stars(user_id, stars_needed)
            logger.info("Refunded %d Stars to user %d", stars_needed, user_id)
            await update_order_status(order_id, "error", error_message=str(buy_err))
            CATALOG_CACHE.clear()
            return web.json_response(
                {"error": _parse_lzt_error(buy_err), "refunded": True},
                status=400,
            )

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

        # Send Telegram notification about purchase
        asyncio.create_task(_notify_purchase(user_id, title, order_id, stars_needed))

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


@require_auth
async def get_orders(request: web.Request) -> web.Response:
    """Get user orders."""
    user_id = request["tg_user"]["id"]
    orders = await get_user_orders(int(user_id))
    return web.json_response({"orders": orders})


@require_auth
async def get_order_detail(request: web.Request) -> web.Response:
    """Get order details including account data."""
    order_id = int(request.match_info["order_id"])
    order = await get_order(order_id)
    if not order:
        return web.json_response({"error": "Заказ не найден"}, status=404)

    # Only allow owner or admin to view
    user = request["tg_user"]
    if order["user_id"] != user["id"] and not settings.is_admin(user["id"]):
        return web.json_response({"error": "Forbidden"}, status=403)

    result = dict(order)
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


@require_auth
async def telegram_login_code(request: web.Request) -> web.Response:
    """Request Telegram login code for a purchased account."""
    item_id = int(request.match_info["item_id"])
    try:
        result = await lzt_api._request("GET", f"/{item_id}/telegram-login-code")
        return web.json_response(result)
    except Exception as e:
        logger.error("Telegram code error for #%d: %s", item_id, e)
        return web.json_response({"error": _parse_lzt_error(e)}, status=400)


@require_auth
async def telegram_reset_auth(request: web.Request) -> web.Response:
    """Reset other Telegram authorizations for a purchased account."""
    item_id = int(request.match_info["item_id"])
    try:
        result = await lzt_api._request("POST", f"/{item_id}/telegram-reset-authorizations")
        return web.json_response(result)
    except Exception as e:
        logger.error("Telegram reset error for #%d: %s", item_id, e)
        return web.json_response({"error": _parse_lzt_error(e)}, status=400)


@require_admin
async def get_balance(request: web.Request) -> web.Response:
    """Get LZT balance (regular + purchase). Admin only."""
    try:
        me = await lzt_api.get_me()
        user_data = me.get("user", {})
        result = {
            "balance": user_data.get("balance", 0),
            "hold": user_data.get("hold", 0),
            "purchase_balance": 0,
        }
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

@require_auth
async def user_balance(request: web.Request) -> web.Response:
    """Get current user's Stars balance."""
    user_id = request["tg_user"]["id"]
    balance = await get_user_balance(user_id)
    return web.json_response({"stars_balance": balance, "user_id": user_id})


# ═══════════════════════════════════════
# Admin endpoints
# ═══════════════════════════════════════

@require_admin
async def admin_stats(request: web.Request) -> web.Response:
    """Get admin dashboard stats."""
    try:
        stats = await get_stats()
        from bot.db import get_db
        db = await get_db()
        try:
            cursor = await db.execute("SELECT COALESCE(SUM(stars_balance), 0) as total FROM users")
            row = await cursor.fetchone()
            stats["total_stars"] = row["total"] if row else 0
        finally:
            await db.close()
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


@require_admin
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

    await upsert_user(user_id, None, None)

    new_balance = await deposit_stars(user_id, amount)
    logger.info("Admin deposited %d Stars to user %d, new balance: %d", amount, user_id, new_balance)

    return web.json_response({
        "ok": True,
        "user_id": user_id,
        "deposited": amount,
        "new_balance": new_balance,
    })


@require_admin
async def admin_orders(request: web.Request) -> web.Response:
    """Get all orders for admin."""
    status = request.query.get("status")
    orders = await get_all_orders(status=status)
    return web.json_response({"orders": orders})


@require_admin
async def admin_users(request: web.Request) -> web.Response:
    """Get all users for admin."""
    users = await get_all_users()
    return web.json_response({"users": users})


async def get_me(request: web.Request) -> web.Response:
    """Get current user info + admin check."""
    user = get_user_from_request(request)
    if not user:
        return web.json_response({"user_id": 0, "is_admin": False})

    user_id = user["id"]
    return web.json_response({
        "user_id": user_id,
        "is_admin": settings.is_admin(user_id),
    })


# ═══════════════════════════════════════
# Send account data to Telegram
# ═══════════════════════════════════════

@require_auth
async def send_account_tg(request: web.Request) -> web.Response:
    """Send account data as file to user in Telegram."""
    order_id = int(request.match_info["order_id"])
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    fmt = body.get("format", "json")  # tdata, telethon, pyrogram, json
    user_id = body.get("user_id")
    if not user_id:
        return web.json_response({"error": "user_id required"}, status=400)

    order = await get_order(order_id)
    if not order:
        return web.json_response({"error": "Order not found"}, status=404)

    ad = order.get("account_data")
    if isinstance(ad, str):
        ad = json.loads(ad)
    if not ad:
        return web.json_response({"error": "No account data"}, status=400)

    login_data = ad.get("loginData", {})
    auth_key = login_data.get("login", "") or ad.get("account", "")
    phone = ad.get("telegram_phone", "")
    dc_id = ad.get("telegram_dc_id", "")
    tg_id = ad.get("telegram_id", "")

    import io
    import aiohttp as _aio

    if fmt == "json":
        content = json.dumps({
            "phone": phone,
            "auth_key_hex": auth_key,
            "dc_id": dc_id,
            "user_id": tg_id,
            "country": ad.get("telegram_country", ""),
            "premium": ad.get("telegram_premium", 0),
        }, indent=2, ensure_ascii=False)
        filename = f"account_{order_id}.json"
        caption = f"📦 Заказ #{order_id} — JSON"

    elif fmt == "telethon":
        content = (
            f"# Telethon Session Data\n"
            f"# Заказ #{order_id}\n\n"
            f"phone = \"{phone}\"\n"
            f"auth_key_hex = \"{auth_key}\"\n"
            f"dc_id = {dc_id or 2}\n"
            f"user_id = {tg_id or 0}\n"
        )
        filename = f"account_{order_id}.session_info"
        caption = f"📦 Заказ #{order_id} — .session Telethon\n\nИспользуйте auth_key для создания .session файла"

    elif fmt == "pyrogram":
        content = json.dumps({
            "dc_id": int(dc_id) if dc_id else 2,
            "user_id": int(tg_id) if tg_id else 0,
            "auth_key": auth_key,
            "phone": phone,
            "is_bot": False,
        }, indent=2, ensure_ascii=False)
        filename = f"account_{order_id}_pyrogram.json"
        caption = f"📦 Заказ #{order_id} — .session Pyrogram\n\nИмпортируйте через Pyrogram"

    elif fmt == "tdata":
        content = (
            f"# TData Info\n"
            f"# Заказ #{order_id}\n\n"
            f"Phone: {phone}\n"
            f"Auth Key (HEX): {auth_key}\n"
            f"DC ID: {dc_id}\n"
            f"User ID: {tg_id}\n"
            f"Country: {ad.get('telegram_country', '')}\n"
            f"Premium: {ad.get('telegram_premium', 0)}\n"
        )
        filename = f"account_{order_id}_tdata.txt"
        caption = f"📦 Заказ #{order_id} — TData"

    else:
        return web.json_response({"error": "Unknown format"}, status=400)

    # Send file via Telegram Bot API
    bot_token = settings.bot_token
    if not bot_token:
        return web.json_response({"error": "Bot not configured"}, status=500)

    url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
    file_bytes = io.BytesIO(content.encode("utf-8"))
    file_bytes.name = filename

    form = _aio.FormData()
    form.add_field("chat_id", str(user_id))
    form.add_field("caption", caption)
    form.add_field("parse_mode", "HTML")
    form.add_field("document", file_bytes, filename=filename)

    async with _aio.ClientSession() as session:
        resp = await session.post(url, data=form)
        if resp.status != 200:
            err = await resp.text()
            logger.warning("Failed to send doc to %s: %s", user_id, err)
            return web.json_response({"error": "Failed to send"}, status=500)

    return web.json_response({"status": "sent", "format": fmt})


# ═══════════════════════════════════════
# Support
# ═══════════════════════════════════════

@require_auth
async def support_message(request: web.Request) -> web.Response:
    """Create a support ticket and notify admins."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    user_id = request["tg_user"]["id"]
    subject = (body.get("subject") or "Обращение в поддержку").strip()[:200]
    message = (body.get("message") or "").strip()
    if not message:
        return web.json_response({"error": "Empty message"}, status=400)
    if len(message) > 2000:
        message = message[:2000]

    # attachments is a JSON array of base64 image strings
    attachments = body.get("attachments")  # JSON string or None

    ticket_id = await create_ticket(user_id, subject, message, attachments)

    # Notify admins via Telegram
    admin_ids = [int(x.strip()) for x in settings.admin_ids.split(",") if x.strip()]
    bot_token = settings.bot_token
    text = (
        f"📩 <b>Новый тикет #{ticket_id}</b>\n\n"
        f"👤 User ID: <code>{user_id}</code>\n"
        f"📋 {subject}\n\n"
        f"💬 {message[:500]}"
    )
    if bot_token and admin_ids:
        import aiohttp as _aio
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        async with _aio.ClientSession() as s:
            for aid in admin_ids:
                try:
                    await s.post(url, json={"chat_id": aid, "text": text, "parse_mode": "HTML"})
                except Exception:
                    pass

    return web.json_response({"status": "created", "ticket_id": ticket_id})


@require_auth
async def tickets_list(request: web.Request) -> web.Response:
    """Get user's tickets."""
    uid = request["tg_user"]["id"]
    tickets = await get_user_tickets(uid)
    return web.json_response({"tickets": tickets})


@require_auth
async def ticket_detail(request: web.Request) -> web.Response:
    """Get ticket with messages."""
    tid = int(request.match_info["id"])
    ticket = await get_ticket_detail(tid)
    if not ticket:
        return web.json_response({"error": "Not found"}, status=404)
    # Only owner or admin can view
    user = request["tg_user"]
    if ticket["user_id"] != user["id"] and not settings.is_admin(user["id"]):
        return web.json_response({"error": "Forbidden"}, status=403)
    return web.json_response(ticket)


@require_auth
async def ticket_reply(request: web.Request) -> web.Response:
    """Add reply to ticket (admin or user)."""
    tid = int(request.match_info["id"])
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    user = request["tg_user"]
    # Determine sender role — only admins can send as 'admin'
    sender = "admin" if settings.is_admin(user["id"]) else "user"
    message = (body.get("message") or "").strip()
    if not message:
        return web.json_response({"error": "Empty message"}, status=400)
    attachments = body.get("attachments")

    await add_ticket_message(tid, sender, message, attachments)

    # If admin replies, notify user via Telegram
    if sender == "admin":
        ticket = await get_ticket_detail(tid)
        if ticket and settings.bot_token:
            import aiohttp as _aio
            text = f"💬 <b>Ответ поддержки</b> (Тикет #{tid})\n\n{message[:500]}"
            url = f"https://api.telegram.org/bot{settings.bot_token}/sendMessage"
            async with _aio.ClientSession() as s:
                try:
                    await s.post(url, json={"chat_id": ticket["user_id"], "text": text, "parse_mode": "HTML"})
                except Exception:
                    pass

    return web.json_response({"status": "sent"})


@require_admin
async def ticket_close(request: web.Request) -> web.Response:
    """Close a ticket. Admin only."""
    tid = int(request.match_info["id"])
    await close_ticket(tid)
    return web.json_response({"status": "closed"})


@require_admin
async def admin_tickets(request: web.Request) -> web.Response:
    """Get all tickets (admin)."""
    tickets = await get_all_tickets()
    return web.json_response({"tickets": tickets})


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
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Telegram-Init-Data"
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
    app.router.add_post("/api/orders/{order_id}/send-tg", send_account_tg)
    app.router.add_get("/api/telegram-code/{item_id}", telegram_login_code)
    app.router.add_post("/api/telegram-reset/{item_id}", telegram_reset_auth)
    app.router.add_get("/api/balance", get_balance)
    app.router.add_get("/api/admin/stats", admin_stats)
    app.router.add_get("/api/admin/orders", admin_orders)
    app.router.add_get("/api/admin/users", admin_users)
    app.router.add_post("/api/admin/deposit", admin_deposit)
    app.router.add_get("/api/user/balance", user_balance)
    app.router.add_get("/api/me", get_me)
    app.router.add_post("/api/support", support_message)
    app.router.add_get("/api/tickets", tickets_list)
    app.router.add_get("/api/tickets/{id}", ticket_detail)
    app.router.add_post("/api/tickets/{id}/reply", ticket_reply)
    app.router.add_post("/api/tickets/{id}/close", ticket_close)
    app.router.add_get("/api/admin/tickets", admin_tickets)

    # Serve webapp static files
    if WEBAPP_DIR.exists():
        app.router.add_static("/", WEBAPP_DIR, show_index=False)
        logger.info("Serving webapp from %s", WEBAPP_DIR)

    return app


if __name__ == "__main__":
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=8082, print=None)
