"""
Payment services — CryptoBot, YooMoney, Telegram Stars.
Each provider implements create_invoice() and check_payment().
"""
import logging
import hashlib
import hmac
import json
import time
from typing import Any, Optional

import aiohttp

from bot.config import settings

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════
# Base Payment Provider
# ═══════════════════════════════════════

class PaymentProvider:
    """Base class for payment providers."""

    name: str = "base"

    async def create_invoice(
        self,
        amount: float,
        order_id: int,
        description: str,
    ) -> dict[str, Any]:
        """Create payment invoice. Returns dict with 'url' and 'payment_id'."""
        raise NotImplementedError

    async def check_payment(self, payment_id: str) -> bool:
        """Check if payment is completed."""
        raise NotImplementedError


# ═══════════════════════════════════════
# CryptoBot (Crypto Pay)
# ═══════════════════════════════════════

class CryptoBotProvider(PaymentProvider):
    """CryptoBot payment via Crypto Pay API."""

    name = "cryptobot"
    BASE_URL = "https://pay.crypt.bot/api"

    async def _request(self, method: str, endpoint: str, **kwargs: Any) -> dict[str, Any]:
        """Make request to Crypto Pay API."""
        headers = {"Crypto-Pay-API-Token": settings.cryptobot_token}
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.request(method, f"{self.BASE_URL}{endpoint}", **kwargs) as resp:
                data = await resp.json()
                if not data.get("ok"):
                    raise PaymentError(f"CryptoBot error: {data}")
                return data.get("result", {})

    async def create_invoice(
        self,
        amount: float,
        order_id: int,
        description: str,
    ) -> dict[str, Any]:
        """Create CryptoBot invoice."""
        result = await self._request(
            "POST", "/createInvoice",
            json={
                "currency_type": "fiat",
                "fiat": "RUB",
                "amount": str(round(amount, 2)),
                "description": description[:1024],
                "payload": json.dumps({"order_id": order_id}),
                "expires_in": 1800,  # 30 minutes
            },
        )

        return {
            "url": result.get("pay_url", result.get("bot_invoice_url", "")),
            "payment_id": str(result.get("invoice_id", "")),
        }

    async def check_payment(self, payment_id: str) -> bool:
        """Check CryptoBot invoice status."""
        result = await self._request(
            "GET", "/getInvoices",
            params={"invoice_ids": payment_id},
        )
        items = result if isinstance(result, list) else result.get("items", [])
        if items:
            return items[0].get("status") == "paid"
        return False


# ═══════════════════════════════════════
# YooMoney
# ═══════════════════════════════════════

class YooMoneyProvider(PaymentProvider):
    """YooMoney (YuKassa) payment."""

    name = "yoomoney"

    async def create_invoice(
        self,
        amount: float,
        order_id: int,
        description: str,
    ) -> dict[str, Any]:
        """Create YooMoney payment link."""
        # Quickpay form for P2P payments
        base_url = "https://yoomoney.ru/quickpay/confirm.xml"
        params = {
            "receiver": settings.yoomoney_wallet,
            "quickpay-form": "shop",
            "targets": description[:100],
            "paymentType": "AC",  # Bank card
            "sum": str(round(amount, 2)),
            "label": str(order_id),
            "successURL": f"https://t.me/{settings.bot_token.split(':')[0]}",
        }

        # Build URL
        from urllib.parse import urlencode
        url = f"{base_url}?{urlencode(params)}"

        return {
            "url": url,
            "payment_id": str(order_id),
        }

    async def check_payment(self, payment_id: str) -> bool:
        """Check YooMoney payment — requires notification webhook."""
        # YooMoney P2P uses webhook notifications, manual check via API
        if not settings.yoomoney_token:
            return False

        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://yoomoney.ru/api/operation-history",
                headers={"Authorization": f"Bearer {settings.yoomoney_token}"},
                data={"type": "deposition", "records": 10, "label": payment_id},
            ) as resp:
                if resp.ok:
                    data = await resp.json()
                    operations = data.get("operations", [])
                    for op in operations:
                        if op.get("label") == payment_id and op.get("status") == "success":
                            return True
        return False


# ═══════════════════════════════════════
# Telegram Stars
# ═══════════════════════════════════════

class TelegramStarsProvider(PaymentProvider):
    """Telegram Stars payment (native Telegram payments)."""

    name = "stars"

    async def create_invoice(
        self,
        amount: float,
        order_id: int,
        description: str,
    ) -> dict[str, Any]:
        """Stars payment is handled directly by aiogram in the handler."""
        # Stars conversion: ~1 Star ≈ 1.3 RUB (approximate)
        stars_amount = max(1, int(amount / 1.3))
        return {
            "url": "",  # Handled inline by bot
            "payment_id": str(order_id),
            "stars_amount": stars_amount,
        }

    async def check_payment(self, payment_id: str) -> bool:
        """Stars payments are confirmed via Telegram pre_checkout callback."""
        return True  # Handled by aiogram's pre_checkout_query handler


class PaymentError(Exception):
    """Payment processing error."""


# Provider registry
PROVIDERS: dict[str, PaymentProvider] = {
    "cryptobot": CryptoBotProvider(),
    "yoomoney": YooMoneyProvider(),
    "stars": TelegramStarsProvider(),
}


def get_provider(name: str) -> PaymentProvider:
    """Get payment provider by name."""
    provider = PROVIDERS.get(name)
    if not provider:
        raise PaymentError(f"Unknown payment provider: {name}")
    return provider


def get_available_providers() -> list[dict[str, str]]:
    """Get list of configured payment providers."""
    available = []
    if settings.cryptobot_token:
        available.append({"id": "cryptobot", "name": "💎 CryptoBot", "icon": "crypto"})
    if settings.yoomoney_wallet:
        available.append({"id": "yoomoney", "name": "💳 YooMoney", "icon": "card"})
    available.append({"id": "stars", "name": "⭐ Telegram Stars", "icon": "stars"})
    return available
