"""
LZT Market API Client — async wrapper for all market operations.
Handles rate limiting, retries, and item purchase flow.
"""
import asyncio
import logging
import time
from typing import Any, Optional

import aiohttp

from bot.config import settings

logger = logging.getLogger(__name__)

MARKET_BASE = "https://api.lzt.market"
REQUEST_DELAY = 3.0  # Market API: 20 req/min => 3s between requests
MAX_RETRIES = 2


class LZTMarketAPI:
    """Async client for LZT Market API."""

    def __init__(self) -> None:
        self._session: Optional[aiohttp.ClientSession] = None
        self._last_request: float = 0.0
        self._lock = asyncio.Lock()
        self._purchase_balance_id: Optional[int] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={
                    "Authorization": f"Bearer {settings.lzt_token}",
                    "Accept": "application/json",
                },
            )
        return self._session

    async def close(self) -> None:
        """Close the HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Make a rate-limited API request with retry logic."""
        async with self._lock:
            # Rate limiting
            elapsed = time.monotonic() - self._last_request
            if elapsed < REQUEST_DELAY:
                await asyncio.sleep(REQUEST_DELAY - elapsed)

            session = await self._get_session()
            url = f"{MARKET_BASE}{endpoint}"
            logger.info("API >> %s %s data=%s params=%s", method, url, data, params)

            for attempt in range(MAX_RETRIES + 1):
                try:
                    self._last_request = time.monotonic()
                    async with session.request(method, url, params=params, data=data) as resp:
                        if resp.status == 429:
                            wait = 5.0 * (attempt + 1)
                            logger.warning("Rate limited, waiting %.1fs", wait)
                            await asyncio.sleep(wait)
                            continue

                        text = await resp.text()
                        if not resp.ok:
                            logger.error("API error %d: %s", resp.status, text[:200])
                            raise APIError(resp.status, text)

                        return await resp.json()
                except aiohttp.ClientError as e:
                    if attempt < MAX_RETRIES:
                        logger.warning("Request failed, retry %d: %s", attempt + 1, e)
                        await asyncio.sleep(2.0)
                    else:
                        raise

            raise APIError(429, "Rate limit exceeded after retries")

    # ═══════════════════════════════════════
    # Market Info
    # ═══════════════════════════════════════

    async def get_me(self) -> dict[str, Any]:
        """Get current user/balance info."""
        return await self._request("GET", "/me")

    async def get_balances(self) -> dict[str, Any]:
        """Get available balance types (regular, purchase, etc)."""
        return await self._request("GET", "/balance/exchange")

    async def init_purchase_balance(self) -> None:
        """Detect and cache the 'balance for purchasing accounts' ID."""
        try:
            data = await self.get_balances()
            # /balance/exchange returns {from: [...], to: [...], system_info: {...}}
            # Balances can be in 'from', 'to', 'balances', or 'items'
            all_balances: list[dict] = []
            for key in ("from", "to", "balances", "items"):
                raw = data.get(key, [])
                if isinstance(raw, dict):
                    all_balances.extend(v for v in raw.values() if isinstance(v, dict))
                elif isinstance(raw, list):
                    all_balances.extend(b for b in raw if isinstance(b, dict))

            logger.info("Found %d balance entries to scan", len(all_balances))
            for b in all_balances:
                name = (b.get("name", "") + b.get("title", "")).lower()
                bal_type = b.get("type", "").lower()
                bal_id = b.get("id") or b.get("balance_id")
                logger.info("  Balance: id=%s, type=%s, name=%s",
                            bal_id, bal_type, b.get("name", b.get("title", "?")))
                # Match purchase-related balance
                if "покупк" in name or "purchase" in name or bal_type == "purchase":
                    self._purchase_balance_id = bal_id
                    logger.info("Purchase balance selected: id=%s", bal_id)
                    return

            # If no match by name, log everything for debugging
            if all_balances:
                logger.warning("No purchase balance matched. Sample keys: %s",
                               list(all_balances[0].keys()) if all_balances else "empty")
            else:
                logger.warning("No balance entries found. Response keys: %s", list(data.keys()))
        except Exception as e:
            logger.warning("Failed to detect purchase balance: %s", e)

    async def get_categories(self) -> dict[str, Any]:
        """Get all market categories."""
        return await self._request("GET", "/category")

    # ═══════════════════════════════════════
    # Items / Catalog
    # ═══════════════════════════════════════

    async def get_items(
        self,
        category: str = "steam",
        pmin: float | None = None,
        pmax: float | None = None,
        title: str | None = None,
        page: int = 1,
    ) -> dict[str, Any]:
        """Get items from a category with optional filters."""
        params: dict[str, Any] = {"page": page}
        if pmin is not None:
            params["pmin"] = pmin
        if pmax is not None:
            params["pmax"] = pmax
        if title:
            params["title"] = title
        return await self._request("GET", f"/{category}", params=params)

    async def get_item(self, item_id: int) -> dict[str, Any]:
        """Get detailed info about a specific item."""
        return await self._request("GET", f"/{item_id}")

    # ═══════════════════════════════════════
    # Purchase Flow
    # ═══════════════════════════════════════

    async def reserve_item(self, item_id: int, price: float) -> dict[str, Any]:
        """Reserve an item for 300 seconds (step 1 of purchase)."""
        data: dict[str, Any] = {"price": price}
        if self._purchase_balance_id is not None:
            data["balance_id"] = self._purchase_balance_id
        return await self._request(
            "POST", f"/{item_id}/reserve",
            data=data,
        )

    async def check_item(self, item_id: int) -> dict[str, Any]:
        """Check if item is valid — LZT verifies the account (step 2)."""
        data: dict[str, Any] = {}
        if self._purchase_balance_id is not None:
            data["balance_id"] = self._purchase_balance_id
        return await self._request("POST", f"/{item_id}/check-account", data=data or None)

    async def confirm_buy(self, item_id: int) -> dict[str, Any]:
        """Confirm purchase after reserve + check (step 3)."""
        data: dict[str, Any] = {}
        if self._purchase_balance_id is not None:
            data["balance_id"] = self._purchase_balance_id
        return await self._request("POST", f"/{item_id}/confirm-buy", data=data or None)

    async def cancel_reserve(self, item_id: int) -> dict[str, Any]:
        """Cancel a reservation."""
        return await self._request("POST", f"/{item_id}/cancel-reserve")

    async def fast_buy(self, item_id: int, price: float, skip_validation: bool = False) -> dict[str, Any]:
        """Fast buy — single request purchase. Uses purchase balance if available."""
        data: dict[str, Any] = {"price": price}
        if skip_validation:
            data["buy_without_validation"] = 1
        if self._purchase_balance_id is not None:
            data["balance_id"] = self._purchase_balance_id
        return await self._request("POST", f"/{item_id}/fast-buy", data=data)

    async def get_purchased_item_data(self, item_id: int) -> dict[str, Any]:
        """Get account login data after successful purchase."""
        return await self._request("GET", f"/{item_id}/email-code")

    # ═══════════════════════════════════════
    # Safe Purchase Flow (for bot)
    # ═══════════════════════════════════════

    async def safe_purchase(self, item_id: int, price: float) -> dict[str, Any]:
        """
        Full safe purchase flow:
        1. Reserve item (5 min hold)
        2. Check account validity
        3. If valid — confirm purchase
        4. If invalid — cancel and report
        Returns purchase result with account data.
        """
        logger.info("Starting purchase flow for item %d (price: %.2f)", item_id, price)

        # Step 1: Reserve
        try:
            reserve_result = await self.reserve_item(item_id, price)
            logger.info("Item %d reserved successfully", item_id)
        except APIError as e:
            logger.error("Failed to reserve item %d: %s", item_id, e)
            raise PurchaseError(f"Не удалось зарезервировать: {e}") from e

        # Step 2: Check account
        try:
            check_result = await self.check_item(item_id)
            item_data = check_result.get("item", {})
            is_valid = item_data.get("account_is_valid", False)

            if not is_valid:
                logger.warning("Item %d failed validation, cancelling", item_id)
                await self.cancel_reserve(item_id)
                raise PurchaseError("Аккаунт не прошёл проверку, покупка отменена")

            logger.info("Item %d passed validation", item_id)
        except APIError as e:
            logger.error("Check failed for item %d: %s", item_id, e)
            try:
                await self.cancel_reserve(item_id)
            except Exception:
                pass
            raise PurchaseError(f"Ошибка проверки аккаунта: {e}") from e

        # Step 3: Confirm purchase
        try:
            result = await self.confirm_buy(item_id)
            logger.info("Item %d purchased successfully!", item_id)
            return result
        except APIError as e:
            logger.error("Failed to confirm purchase of item %d: %s", item_id, e)
            raise PurchaseError(f"Ошибка подтверждения покупки: {e}") from e


class APIError(Exception):
    """API request error."""

    def __init__(self, status: int, message: str) -> None:
        self.status = status
        self.message = message
        super().__init__(f"API {status}: {message[:200]}")


class PurchaseError(Exception):
    """Purchase flow error."""


# Singleton instance
lzt_api = LZTMarketAPI()
