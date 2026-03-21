"""
Telegram Bot handlers — /start, inline buttons, payment callbacks.
"""
import json
import logging

from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    Message,
    CallbackQuery,
    WebAppInfo,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    LabeledPrice,
    PreCheckoutQuery,
)
from aiogram.enums import ParseMode

from bot.config import settings
from bot.db import upsert_user, get_order, update_order_status, get_stats
from bot.services.lzt_api import lzt_api
from bot.services.payments import get_available_providers

logger = logging.getLogger(__name__)
router = Router()


# ═══════════════════════════════════════
# /start — main entry point
# ═══════════════════════════════════════

@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    """Handle /start command — show welcome + Mini App button."""
    user = message.from_user
    if not user:
        return

    await upsert_user(user.id, user.username, user.first_name)

    webapp_url = settings.webapp_url

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🛒 Открыть магазин",
            web_app=WebAppInfo(url=webapp_url),
        )],
        [InlineKeyboardButton(text="📦 Мои заказы", callback_data="my_orders")],
        [InlineKeyboardButton(text="💬 Поддержка", callback_data="support")],
    ])

    # Add admin button
    if settings.is_admin(user.id):
        keyboard.inline_keyboard.append([
            InlineKeyboardButton(
                text="⚙️ Админ-панель",
                web_app=WebAppInfo(url=f"{webapp_url}#admin"),
            )
        ])

    await message.answer(
        "🏪 <b>LZT Market Store</b>\n\n"
        "Добро пожаловать в магазин аккаунтов!\n\n"
        "🎮 Steam, Fortnite, Genshin Impact и другие\n"
        "✅ Проверка аккаунтов перед покупкой\n"
        "🔒 Гарантия на каждую покупку\n"
        "⚡ Моментальная выдача\n\n"
        "Нажми кнопку ниже, чтобы открыть магазин 👇",
        reply_markup=keyboard,
        parse_mode=ParseMode.HTML,
    )


# ═══════════════════════════════════════
# Callback: My Orders
# ═══════════════════════════════════════

@router.callback_query(F.data == "my_orders")
async def cb_my_orders(callback: CallbackQuery) -> None:
    """Show user's recent orders."""
    from bot.db import get_user_orders
    user = callback.from_user
    if not user:
        return

    orders = await get_user_orders(user.id, limit=5)

    if not orders:
        await callback.answer("У вас пока нет заказов", show_alert=True)
        return

    status_emoji = {
        "pending": "⏳",
        "awaiting_payment": "💳",
        "paid": "✅",
        "purchasing": "🔄",
        "completed": "🎉",
        "error": "❌",
        "cancelled": "🚫",
    }

    text = "📦 <b>Ваши заказы:</b>\n\n"
    for order in orders:
        emoji = status_emoji.get(order["status"], "❓")
        text += (
            f"{emoji} <b>#{order['id']}</b> — {order['item_title'][:40]}\n"
            f"   Цена: {order['sell_price']}₽ | Статус: {order['status']}\n\n"
        )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🛒 В магазин",
            web_app=WebAppInfo(url=settings.webapp_url),
        )],
    ])

    await callback.message.edit_text(text, reply_markup=keyboard, parse_mode=ParseMode.HTML)


# ═══════════════════════════════════════
# Callback: Support
# ═══════════════════════════════════════

@router.callback_query(F.data == "support")
async def cb_support(callback: CallbackQuery) -> None:
    """Show support info."""
    await callback.answer(
        "Для поддержки напишите @ваш_юзернейм",
        show_alert=True,
    )


# ═══════════════════════════════════════
# Telegram Stars Payment
# ═══════════════════════════════════════

@router.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery) -> None:
    """Handle Stars pre-checkout — always approve."""
    await query.answer(ok=True)


@router.message(F.successful_payment)
async def successful_payment(message: Message) -> None:
    """Handle successful Stars payment."""
    payment = message.successful_payment
    if not payment or not payment.invoice_payload:
        return

    try:
        payload = json.loads(payment.invoice_payload)
        order_id = payload.get("order_id")
        if not order_id:
            return

        order = await get_order(order_id)
        if not order:
            return

        # Mark as paid
        await update_order_status(order_id, "paid")

        # Purchase on LZT
        try:
            result = await lzt_api.safe_purchase(order["lzt_item_id"], order["original_price"])
            account_data = json.dumps(result.get("item", {}), ensure_ascii=False)
            await update_order_status(order_id, "completed", account_data=account_data)

            await message.answer(
                f"🎉 <b>Покупка успешна!</b>\n\n"
                f"Заказ #{order_id} выполнен.\n"
                f"Данные аккаунта отправлены в магазин.\n\n"
                f"Откройте магазин → Мои заказы для просмотра.",
                parse_mode=ParseMode.HTML,
            )
        except Exception as e:
            await update_order_status(order_id, "error", error_message=str(e))
            await message.answer(
                f"❌ Ошибка покупки: {e}\n\nСвяжитесь с поддержкой.",
                parse_mode=ParseMode.HTML,
            )

    except Exception as e:
        logger.error("Stars payment processing error: %s", e)


# ═══════════════════════════════════════
# Admin command
# ═══════════════════════════════════════

@router.message(Command("admin"))
async def cmd_admin(message: Message) -> None:
    """Admin stats quick view."""
    user = message.from_user
    if not user or not settings.is_admin(user.id):
        return

    stats = await get_stats()

    text = (
        "📊 <b>Статистика</b>\n\n"
        f"👥 Пользователей: {stats['total_users']}\n"
        f"📦 Всего заказов: {stats['total_orders']}\n"
        f"✅ Выполнено: {stats['completed_orders']}\n"
        f"💰 Общий профит: {stats['total_profit']:.2f}₽\n"
        f"💵 Оборот: {stats['total_revenue']:.2f}₽\n\n"
        f"📅 Сегодня: {stats['today_orders']} заказов, {stats['today_profit']:.2f}₽ профита"
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="⚙️ Админ-панель",
            web_app=WebAppInfo(url=f"{settings.webapp_url}#admin"),
        )],
    ])

    await message.answer(text, reply_markup=keyboard, parse_mode=ParseMode.HTML)
