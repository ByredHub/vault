"""
Web API server — serves data for the Telegram Mini App.
Validates Telegram init data for auth, provides catalog/orders/admin endpoints.
"""
import hashlib
import hmac
import json
import logging
import time
from typing import Any
from urllib.parse import parse_qs, unquote

from aiohttp import web

from bot.config import settings
from bot.db import (
    get_all_orders,
    get_all_users,
    get_order,
    get_stats,
    get_user,
    get_user_orders,
    upsert_user,
    create_order,
    update_order_status,
    block_user,
    get_user_count,
)
from bot.services.lzt_api import lzt_api
from bot.services.payments import get_available_providers, get_provider, PaymentError

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════
# Telegram Init Data Validation
# ═══════════════════════════════════════

def validate_init_data(init_data: str, bot_token: str) -> dict[str, Any] | None:
    """
    Validate Telegram Mini App init data.
    Returns parsed user data if valid, None otherwise.
    See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    try:
        parsed = parse_qs(init_data)
        received_hash = parsed.get("hash", [None])[0]
        if not received_hash:
            return None

        # Build data check string
        data_pairs = []
        for key, values in sorted(parsed.items()):
            if key != "hash":
                data_pairs.append(f"{key}={values[0]}")
        data_check_string = "\n".join(data_pairs)

        # Generate secret key
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

        if not hmac.compare_digest(computed_hash, received_hash):
            return None

        # Parse user data
        user_raw = parsed.get("user", [None])[0]
        if user_raw:
            return json.loads(unquote(user_raw))
        return None
    except Exception as e:
        logger.error("Init data validation error: %s", e)
        return None


def get_user_from_request(request: web.Request) -> dict[str, Any] | None:
    """Extract and validate Telegram user from request headers."""
    init_data = request.headers.get("X-Telegram-Init-Data", "")
    if not init_data:
        return None
    return validate_init_data(init_data, settings.bot_token)


def require_auth(handler):
    """Decorator: require valid Telegram init data."""
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


# ═══════════════════════════════════════
# Catalog Endpoints
# ═══════════════════════════════════════

@require_auth
async def get_catalog(request: web.Request) -> web.Response:
    """Get items from LZT Market with markup prices."""
    category = request.query.get("category", "steam")
    page = int(request.query.get("page", "1"))
    pmin = request.query.get("pmin")
    pmax = request.query.get("pmax")
    title = request.query.get("title")

    try:
        data = await lzt_api.get_items(
            category=category,
            page=page,
            pmin=float(pmin) if pmin else None,
            pmax=float(pmax) if pmax else None,
            title=title,
        )

        items = data.get("items", [])
        # Apply markup to prices
        for item in items:
            original = item.get("price", 0)
            item["original_price"] = original
            item["price"] = settings.calculate_price(original)

        return web.json_response({
            "items": items,
            "totalItems": data.get("totalItems", 0),
            "currentPage": page,
        })
    except Exception as e:
        logger.error("Catalog error: %s", e)
        return web.json_response({"error": str(e)}, status=500)


@require_auth
async def get_item_detail(request: web.Request) -> web.Response:
    """Get detailed item info."""
    item_id = int(request.match_info["item_id"])
    try:
        data = await lzt_api.get_item(item_id)
        item = data.get("item", {})
        original = item.get("price", 0)
        item["original_price"] = original
        item["price"] = settings.calculate_price(original)
        return web.json_response({"item": item})
    except Exception as e:
        logger.error("Item detail error: %s", e)
        return web.json_response({"error": str(e)}, status=500)


@require_auth
async def get_categories(request: web.Request) -> web.Response:
    """Get market categories."""
    try:
        data = await lzt_api.get_categories()
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ═══════════════════════════════════════
# Order Endpoints
# ═══════════════════════════════════════

@require_auth
async def create_new_order(request: web.Request) -> web.Response:
    """Create order — reserves item on LZT and creates payment."""
    user = request["tg_user"]
    user_id = user["id"]

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    item_id = body.get("item_id")
    payment_method = body.get("payment_method", "cryptobot")

    if not item_id:
        return web.json_response({"error": "item_id required"}, status=400)

    try:
        # Get item info from LZT
        item_data = await lzt_api.get_item(int(item_id))
        item = item_data.get("item", {})

        if not item:
            return web.json_response({"error": "Item not found"}, status=404)

        original_price = item.get("price", 0)
        sell_price = settings.calculate_price(original_price)
        title = item.get("title", item.get("title_en", "Account"))
        category = item.get("category_id", "")

        # Upsert user
        await upsert_user(user_id, user.get("username"), user.get("first_name"))

        # Create order in DB
        order_id = await create_order(
            user_id=user_id,
            lzt_item_id=int(item_id),
            item_title=title,
            item_category=str(category),
            original_price=original_price,
            sell_price=sell_price,
            payment_method=payment_method,
        )

        # Create payment invoice
        provider = get_provider(payment_method)
        invoice = await provider.create_invoice(
            amount=sell_price,
            order_id=order_id,
            description=f"Покупка: {title[:60]}",
        )

        await update_order_status(order_id, "awaiting_payment", payment_id=invoice.get("payment_id", ""))

        return web.json_response({
            "order_id": order_id,
            "sell_price": sell_price,
            "original_price": original_price,
            "payment_url": invoice.get("url", ""),
            "payment_id": invoice.get("payment_id", ""),
            "stars_amount": invoice.get("stars_amount"),
        })

    except PaymentError as e:
        logger.error("Payment error: %s", e)
        return web.json_response({"error": f"Ошибка платежа: {e}"}, status=500)
    except Exception as e:
        logger.error("Order creation error: %s", e)
        return web.json_response({"error": str(e)}, status=500)


@require_auth
async def check_order_payment(request: web.Request) -> web.Response:
    """Check if an order's payment is completed, then purchase the item on LZT."""
    order_id = int(request.match_info["order_id"])
    user = request["tg_user"]

    order = await get_order(order_id)
    if not order:
        return web.json_response({"error": "Order not found"}, status=404)
    if order["user_id"] != user["id"] and not settings.is_admin(user["id"]):
        return web.json_response({"error": "Forbidden"}, status=403)

    if order["status"] == "completed":
        return web.json_response({"status": "completed", "account_data": order.get("account_data")})
    if order["status"] not in ("awaiting_payment", "pending"):
        return web.json_response({"status": order["status"]})

    # Check payment
    try:
        provider = get_provider(order["payment_method"])
        is_paid = await provider.check_payment(order["payment_id"])

        if not is_paid:
            return web.json_response({"status": "awaiting_payment"})

        # Payment confirmed! Update status
        await update_order_status(order_id, "paid")

        # Purchase on LZT
        try:
            result = await lzt_api.safe_purchase(order["lzt_item_id"], order["original_price"])
            # Extract account data
            account_data = json.dumps(result.get("item", {}), ensure_ascii=False)
            await update_order_status(order_id, "completed", account_data=account_data)
            return web.json_response({"status": "completed", "account_data": account_data})
        except Exception as e:
            await update_order_status(order_id, "error", error_message=str(e))
            return web.json_response({"status": "error", "error": str(e)})

    except Exception as e:
        logger.error("Payment check error: %s", e)
        return web.json_response({"error": str(e)}, status=500)


@require_auth
async def get_my_orders(request: web.Request) -> web.Response:
    """Get current user's orders."""
    user = request["tg_user"]
    orders = await get_user_orders(user["id"])
    return web.json_response({"orders": orders})


@require_auth
async def get_payment_methods(request: web.Request) -> web.Response:
    """Get available payment methods."""
    return web.json_response({"methods": get_available_providers()})


# ═══════════════════════════════════════
# Admin Endpoints
# ═══════════════════════════════════════

@require_admin
async def admin_stats(request: web.Request) -> web.Response:
    """Get admin dashboard stats."""
    stats = await get_stats()
    try:
        me = await lzt_api.get_me()
        balance = me.get("user", {}).get("balance", 0)
        hold = me.get("user", {}).get("hold", 0)
        stats["lzt_balance"] = balance
        stats["lzt_hold"] = hold
    except Exception:
        stats["lzt_balance"] = 0
        stats["lzt_hold"] = 0

    stats["markup_percent"] = settings.markup_percent
    stats["min_markup_rub"] = settings.min_markup_rub
    return web.json_response(stats)


@require_admin
async def admin_orders(request: web.Request) -> web.Response:
    """Get all orders (admin)."""
    status_filter = request.query.get("status")
    page = int(request.query.get("page", "1"))
    limit = 50
    offset = (page - 1) * limit
    orders = await get_all_orders(status=status_filter, limit=limit, offset=offset)
    return web.json_response({"orders": orders})


@require_admin
async def admin_users(request: web.Request) -> web.Response:
    """Get all users (admin)."""
    page = int(request.query.get("page", "1"))
    limit = 50
    offset = (page - 1) * limit
    users = await get_all_users(limit=limit, offset=offset)
    total = await get_user_count()
    return web.json_response({"users": users, "total": total})


@require_admin
async def admin_block_user(request: web.Request) -> web.Response:
    """Block/unblock user (admin)."""
    body = await request.json()
    user_id = body.get("user_id")
    blocked = body.get("blocked", True)
    if not user_id:
        return web.json_response({"error": "user_id required"}, status=400)
    await block_user(int(user_id), blocked)
    return web.json_response({"ok": True})


# ═══════════════════════════════════════
# CORS Middleware
# ═══════════════════════════════════════

@web.middleware
async def cors_middleware(request: web.Request, handler) -> web.Response:
    """Add CORS headers for Mini App."""
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


# ═══════════════════════════════════════
# App Factory
# ═══════════════════════════════════════

def create_web_app() -> web.Application:
    """Create and configure the aiohttp web application."""
    app = web.Application(middlewares=[cors_middleware])

    # Catalog
    app.router.add_get("/api/catalog", get_catalog)
    app.router.add_get("/api/catalog/{item_id}", get_item_detail)
    app.router.add_get("/api/categories", get_categories)

    # Orders
    app.router.add_post("/api/orders", create_new_order)
    app.router.add_get("/api/orders/my", get_my_orders)
    app.router.add_get("/api/orders/{order_id}/check", check_order_payment)

    # Payments
    app.router.add_get("/api/payments/methods", get_payment_methods)

    # Admin
    app.router.add_get("/api/admin/stats", admin_stats)
    app.router.add_get("/api/admin/orders", admin_orders)
    app.router.add_get("/api/admin/users", admin_users)
    app.router.add_post("/api/admin/users/block", admin_block_user)

    return app
