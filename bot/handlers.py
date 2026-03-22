"""
Telegram Bot handlers — commands, inline buttons, Stars topup and payment.
"""
import json
import logging

from aiogram import Router, F
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
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
from bot.db import (
    upsert_user, get_order, update_order_status, get_stats,
    get_user_orders, get_user_balance, deposit_stars,
)
from bot.services.lzt_api import lzt_api

logger = logging.getLogger(__name__)
router = Router()


class TopupStates(StatesGroup):
    """FSM states for custom top-up amount input."""
    waiting_for_amount = State()

WEBAPP_URL = settings.webapp_url


# ═══════════════════════════════════════
# /start — main entry point
# ═══════════════════════════════════════

@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    """Handle /start — welcome message with inline keyboard."""
    user = message.from_user
    if not user:
        return

    await upsert_user(user.id, user.username, user.first_name)

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🛒 Открыть магазин",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )],
        [
            InlineKeyboardButton(text="💰 Баланс", callback_data="balance"),
            InlineKeyboardButton(text="📦 Заказы", callback_data="my_orders"),
        ],
        [
            InlineKeyboardButton(text="⭐ Пополнить Stars", callback_data="topup"),
            InlineKeyboardButton(text="❓ Помощь", callback_data="help"),
        ],
    ])

    if settings.is_admin(user.id):
        kb.inline_keyboard.append([
            InlineKeyboardButton(
                text="⚙️ Админ-панель",
                web_app=WebAppInfo(url=f"{WEBAPP_URL}#admin"),
            )
        ])

    await message.answer(
        f"👋 Привет, <b>{user.first_name}</b>!\n\n"
        "🏪 <b>VAULT</b> — магазин аккаунтов\n\n"
        "🎮 Steam, Telegram, Fortnite и другие\n"
        "✅ Проверка перед покупкой\n"
        "⚡ Моментальная выдача\n"
        "🔒 Гарантия на каждый аккаунт\n\n"
        "Жми кнопку ниже, чтобы начать 👇",
        reply_markup=kb,
    )


# ═══════════════════════════════════════
# /help
# ═══════════════════════════════════════

@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    """Show available commands."""
    await message.answer(
        "📋 <b>Доступные команды:</b>\n\n"
        "/start — Главное меню\n"
        "/shop — Открыть магазин\n"
        "/balance — Проверить баланс Stars\n"
        "/topup — Пополнить баланс Stars\n"
        "/orders — Мои заказы\n"
        "/help — Эта справка\n"
    )


@router.callback_query(F.data == "help")
async def cb_help(callback: CallbackQuery) -> None:
    """Inline help button."""
    await callback.answer()
    await callback.message.answer(
        "📋 <b>Как купить аккаунт:</b>\n\n"
        "1️⃣ Пополни баланс Stars → /topup\n"
        "2️⃣ Открой магазин → /shop\n"
        "3️⃣ Выбери аккаунт и нажми «Купить»\n"
        "4️⃣ Stars спишутся, аккаунт будет выдан моментально\n\n"
        "💡 <b>Курс:</b> 1 ⭐ = 1.6 ₽\n\n"
        "Вопросы? Напиши /help или обратись в поддержку.",
    )


# ═══════════════════════════════════════
# /shop — open Mini App
# ═══════════════════════════════════════

@router.message(Command("shop"))
async def cmd_shop(message: Message) -> None:
    """Open the shop Mini App."""
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🛒 Открыть магазин",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )],
    ])
    await message.answer("🛒 Нажми кнопку, чтобы открыть магазин:", reply_markup=kb)


# ═══════════════════════════════════════
# /balance — check Stars balance
# ═══════════════════════════════════════

@router.message(Command("balance"))
async def cmd_balance(message: Message) -> None:
    """Show user's Stars balance."""
    user = message.from_user
    if not user:
        return

    balance = await get_user_balance(user.id)

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="⭐ Пополнить", callback_data="topup")],
        [InlineKeyboardButton(
            text="🛒 Магазин",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )],
    ])

    await message.answer(
        f"💰 <b>Ваш баланс:</b> ⭐ {balance} Stars\n\n"
        f"💡 Это примерно {round(balance * 1.6)} ₽\n\n"
        "Чтобы пополнить, нажми кнопку ниже 👇",
        reply_markup=kb,
    )


@router.callback_query(F.data == "balance")
async def cb_balance(callback: CallbackQuery) -> None:
    """Inline balance button."""
    user = callback.from_user
    if not user:
        return

    balance = await get_user_balance(user.id)
    await callback.answer(f"⭐ Баланс: {balance} Stars (~{round(balance * 1.6)}₽)", show_alert=True)


# ═══════════════════════════════════════
# /topup — Stars top-up via Telegram payment
# ═══════════════════════════════════════

TOPUP_OPTIONS = [
    (50, "50 ⭐ (~80₽)"),
    (100, "100 ⭐ (~160₽)"),
    (250, "250 ⭐ (~400₽)"),
    (500, "500 ⭐ (~800₽)"),
    (1000, "1000 ⭐ (~1600₽)"),
]


@router.message(Command("topup"))
async def cmd_topup(message: Message) -> None:
    """Show top-up options."""
    await _show_topup_menu(message)


@router.callback_query(F.data == "topup")
async def cb_topup(callback: CallbackQuery) -> None:
    """Inline topup button."""
    await callback.answer()
    await _show_topup_menu(callback.message, edit=False)


async def _show_topup_menu(message: Message, edit: bool = False) -> None:
    """Render top-up amount selection."""
    buttons = []
    for amount, label in TOPUP_OPTIONS:
        buttons.append([
            InlineKeyboardButton(text=f"⭐ {label}", callback_data=f"topup:{amount}")
        ])
    buttons.append([InlineKeyboardButton(text="✏️ Своя сумма", callback_data="topup_custom")])
    buttons.append([InlineKeyboardButton(text="↩️ Назад", callback_data="back_start")])

    kb = InlineKeyboardMarkup(inline_keyboard=buttons)

    text = (
        "⭐ <b>Пополнение баланса</b>\n\n"
        "Выбери сумму пополнения.\n"
        "Оплата через Telegram Stars.\n\n"
        "💡 <b>Курс:</b> 1 ⭐ = 1.6 ₽"
    )

    if edit:
        await message.edit_text(text, reply_markup=kb)
    else:
        await message.answer(text, reply_markup=kb)


@router.callback_query(F.data.startswith("topup:"))
async def cb_topup_amount(callback: CallbackQuery) -> None:
    """User selected a top-up amount — send Telegram Stars invoice."""
    amount = int(callback.data.split(":")[1])

    await callback.answer()

    # Send Stars invoice via Telegram Payments
    await callback.message.answer_invoice(
        title=f"Пополнение ⭐ {amount} Stars",
        description=f"Пополнение баланса VAULT на {amount} Stars (~{round(amount * 1.6)}₽)",
        payload=json.dumps({"type": "topup", "stars": amount}),
        currency="XTR",  # Telegram Stars currency
        prices=[LabeledPrice(label=f"{amount} Stars", amount=amount)],
    )


@router.callback_query(F.data == "topup_custom")
async def cb_topup_custom(callback: CallbackQuery, state: FSMContext) -> None:
    """User wants to enter a custom top-up amount."""
    await callback.answer()
    await state.set_state(TopupStates.waiting_for_amount)

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="❌ Отмена", callback_data="topup_custom_cancel")],
    ])

    await callback.message.answer(
        "✏️ <b>Своя сумма</b>\n\n"
        "Введи количество Stars для пополнения\n"
        "(от 1 до 10000):\n\n"
        "💡 <b>Курс:</b> 1 ⭐ = 1.6 ₽",
        reply_markup=kb,
    )


@router.callback_query(F.data == "topup_custom_cancel")
async def cb_topup_custom_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    """Cancel custom top-up input."""
    await state.clear()
    await callback.answer("Отменено")
    await _show_topup_menu(callback.message, edit=False)


@router.message(TopupStates.waiting_for_amount)
async def process_custom_topup_amount(message: Message, state: FSMContext) -> None:
    """Process the custom top-up amount entered by the user."""
    text = (message.text or "").strip()

    if not text.isdigit():
        await message.answer(
            "❌ Введи целое число.\n"
            "Например: <b>75</b> или <b>300</b>",
        )
        return

    amount = int(text)

    if amount < 1 or amount > 10000:
        await message.answer(
            "❌ Сумма должна быть от <b>1</b> до <b>10000</b> Stars.\n"
            "Попробуй ещё раз:",
        )
        return

    # Clear FSM state
    await state.clear()

    # Send Stars invoice
    await message.answer_invoice(
        title=f"Пополнение ⭐ {amount} Stars",
        description=f"Пополнение баланса VAULT на {amount} Stars (~{round(amount * 1.6)}₽)",
        payload=json.dumps({"type": "topup", "stars": amount}),
        currency="XTR",
        prices=[LabeledPrice(label=f"{amount} Stars", amount=amount)],
    )


# ═══════════════════════════════════════
# /orders — recent orders
# ═══════════════════════════════════════

@router.message(Command("orders"))
async def cmd_orders(message: Message) -> None:
    """Show recent orders."""
    user = message.from_user
    if not user:
        return
    await _show_orders(message, user.id)


@router.callback_query(F.data == "my_orders")
async def cb_my_orders(callback: CallbackQuery) -> None:
    """Inline orders button."""
    user = callback.from_user
    if not user:
        return
    await callback.answer()
    await _show_orders(callback.message, user.id, edit=False)


async def _show_orders(message: Message, user_id: int, edit: bool = False) -> None:
    """Render order list."""
    orders = await get_user_orders(user_id, limit=10)

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🛒 В магазин",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )],
    ])

    if not orders:
        text = "📦 У вас пока нет заказов.\n\nОткройте магазин и выберите аккаунт!"
    else:
        status_emoji = {
            "pending": "⏳", "awaiting_payment": "💳",
            "paid": "✅", "completed": "🎉",
            "error": "❌", "cancelled": "🚫",
        }
        text = "📦 <b>Ваши заказы:</b>\n\n"
        for o in orders:
            emoji = status_emoji.get(o["status"], "❓")
            text += (
                f"{emoji} <b>#{o['id']}</b> — {o['item_title'][:35]}\n"
                f"   💰 {o['sell_price']:.0f}₽ · {o['status']}\n\n"
            )

    if edit:
        await message.edit_text(text, reply_markup=kb)
    else:
        await message.answer(text, reply_markup=kb)


# ═══════════════════════════════════════
# Back to start
# ═══════════════════════════════════════

@router.callback_query(F.data == "back_start")
async def cb_back_start(callback: CallbackQuery) -> None:
    """Go back to main menu."""
    await callback.answer()
    user = callback.from_user
    if not user:
        return
    # Rebuild start keyboard
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🛒 Открыть магазин",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )],
        [
            InlineKeyboardButton(text="💰 Баланс", callback_data="balance"),
            InlineKeyboardButton(text="📦 Заказы", callback_data="my_orders"),
        ],
        [
            InlineKeyboardButton(text="⭐ Пополнить Stars", callback_data="topup"),
            InlineKeyboardButton(text="❓ Помощь", callback_data="help"),
        ],
    ])

    if settings.is_admin(user.id):
        kb.inline_keyboard.append([
            InlineKeyboardButton(
                text="⚙️ Админ-панель",
                web_app=WebAppInfo(url=f"{WEBAPP_URL}#admin"),
            )
        ])

    await callback.message.edit_text(
        f"👋 Привет, <b>{user.first_name}</b>!\n\n"
        "🏪 <b>VAULT</b> — магазин аккаунтов\n\n"
        "Жми кнопку ниже, чтобы начать 👇",
        reply_markup=kb,
    )


# ═══════════════════════════════════════
# Telegram Stars Payment Processing
# ═══════════════════════════════════════

@router.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery) -> None:
    """Handle Stars pre-checkout — validate payload before approving."""
    try:
        payload = json.loads(query.invoice_payload)
        if payload.get("type") == "topup":
            stars = payload.get("stars", 0)
            if not isinstance(stars, int) or stars < 1 or stars > 10000:
                await query.answer(ok=False, error_message="Некорректная сумма пополнения")
                return
        elif payload.get("order_id"):
            order_id = payload["order_id"]
            order = await get_order(order_id)
            if not order:
                await query.answer(ok=False, error_message="Заказ не найден")
                return
        else:
            await query.answer(ok=False, error_message="Неизвестный тип платежа")
            return
        await query.answer(ok=True)
    except Exception as e:
        logger.error("Pre-checkout validation error: %s", e)
        await query.answer(ok=False, error_message="Ошибка валидации платежа")


@router.message(F.successful_payment)
async def successful_payment(message: Message) -> None:
    """Handle successful Stars payment — deposit to user balance."""
    payment = message.successful_payment
    if not payment or not payment.invoice_payload:
        return

    user = message.from_user
    if not user:
        return

    try:
        payload = json.loads(payment.invoice_payload)

        # Top-up flow
        if payload.get("type") == "topup":
            stars = payload.get("stars", 0)
            if stars <= 0:
                return

            new_balance = await deposit_stars(user.id, stars)
            logger.info("User %d topped up %d Stars, new balance: %d", user.id, stars, new_balance)

            kb = InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(
                    text="🛒 Перейти в магазин",
                    web_app=WebAppInfo(url=WEBAPP_URL),
                )],
            ])

            await message.answer(
                f"✅ <b>Баланс пополнен!</b>\n\n"
                f"➕ Зачислено: ⭐ {stars} Stars\n"
                f"💰 Текущий баланс: ⭐ {new_balance} Stars\n\n"
                f"Теперь можешь покупать аккаунты в магазине! 🛒",
                reply_markup=kb,
            )
            return

        # Direct purchase flow (legacy)
        order_id = payload.get("order_id")
        if not order_id:
            return

        order = await get_order(order_id)
        if not order:
            return

        await update_order_status(order_id, "paid")

        try:
            result = await lzt_api.fast_buy(order["lzt_item_id"], order["original_price"])
            account_data = json.dumps(result.get("item", {}), ensure_ascii=False)
            await update_order_status(order_id, "completed", account_data=account_data)

            await message.answer(
                f"🎉 <b>Покупка успешна!</b>\n\n"
                f"Заказ #{order_id} выполнен.\n"
                f"Данные аккаунта в магазине → Мои заказы.",
            )
        except Exception as e:
            await update_order_status(order_id, "error", error_message=str(e))
            await message.answer(f"❌ Ошибка покупки: {e}\n\nСвяжитесь с поддержкой.")

    except Exception as e:
        logger.error("Stars payment processing error: %s", e, exc_info=True)


# ═══════════════════════════════════════
# /admin — quick stats in chat
# ═══════════════════════════════════════

@router.message(Command("admin"))
async def cmd_admin(message: Message) -> None:
    """Admin stats quick view."""
    user = message.from_user
    if not user or not settings.is_admin(user.id):
        return

    stats = await get_stats()

    # Get LZT balance
    lzt_balance = 0
    try:
        me = await lzt_api.get_me()
        lzt_balance = me.get("user", {}).get("balance", 0)
    except Exception:
        pass

    text = (
        "📊 <b>Статистика VAULT</b>\n\n"
        f"👥 Пользователей: {stats['total_users']}\n"
        f"📦 Всего заказов: {stats['total_orders']}\n"
        f"✅ Выполнено: {stats['completed_orders']}\n"
        f"💰 Профит: {stats['total_profit']:.2f}₽\n"
        f"💵 Оборот: {stats['total_revenue']:.2f}₽\n\n"
        f"📅 Сегодня: {stats['today_orders']} зак. · {stats['today_profit']:.2f}₽\n"
        f"🏦 Баланс LZT: {lzt_balance}₽\n"
    )

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="⚙️ Админ-панель",
            web_app=WebAppInfo(url=f"{WEBAPP_URL}#admin"),
        )],
    ])

    await message.answer(text, reply_markup=kb)


# ═══════════════════════════════════════
# Unhandled messages
# ═══════════════════════════════════════

@router.message()
async def unhandled_message(message: Message) -> None:
    """Catch-all for messages without a command."""
    if message.text and message.text.startswith("/"):
        await message.answer("❓ Неизвестная команда. Попробуй /help")
        return

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🛒 Открыть магазин",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )],
    ])
    await message.answer(
        "Привет! Я бот магазина VAULT.\n"
        "Используй /start или кнопку ниже 👇",
        reply_markup=kb,
    )
