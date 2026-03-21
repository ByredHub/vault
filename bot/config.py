"""
LZT Market Bot — Configuration
"""
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from .env file."""

    # Telegram
    bot_token: str = Field("", alias="BOT_TOKEN")
    admin_ids: str = Field("", alias="ADMIN_IDS")

    # LZT Market API
    lzt_token: str = Field(..., alias="LZT_TOKEN")

    # CryptoBot
    cryptobot_token: str = Field("", alias="CRYPTOBOT_TOKEN")

    # YooMoney
    yoomoney_token: str = Field("", alias="YOOMONEY_TOKEN")
    yoomoney_wallet: str = Field("", alias="YOOMONEY_WALLET")

    # Mini App
    webapp_url: str = Field("https://localhost:5173", alias="WEBAPP_URL")

    # Business
    markup_percent: float = Field(15.0, alias="MARKUP_PERCENT")
    min_markup_rub: float = Field(20.0, alias="MIN_MARKUP_RUB")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @property
    def admin_id_list(self) -> list[int]:
        """Parse comma-separated admin IDs into a list of integers."""
        if not self.admin_ids:
            return []
        return [int(x.strip()) for x in self.admin_ids.split(",") if x.strip().isdigit()]

    def is_admin(self, user_id: int) -> bool:
        """Check if a user ID is an admin."""
        return user_id in self.admin_id_list

    def calculate_price(self, original_price: float) -> float:
        """Calculate selling price with markup."""
        markup = original_price * (self.markup_percent / 100)
        if markup < self.min_markup_rub:
            markup = self.min_markup_rub
        return round(original_price + markup, 2)


settings = Settings()
