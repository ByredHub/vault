"""
LZT Market Bot — Entry point.
Starts the Telegram bot and web API server simultaneously.
"""
import asyncio
import logging
import sys
from pathlib import Path

from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiohttp import web

# Ensure project root is in path
sys.path.insert(0, str(Path(__file__).parent.parent))

from bot.config import settings
from bot.db import init_db
from bot.handlers import router
from bot.web import create_web_app
from bot.services.lzt_api import lzt_api

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


async def on_startup(bot: Bot) -> None:
    """Startup tasks."""
    logger.info("Initializing database...")
    await init_db()

    # Check LZT connection
    try:
        me = await lzt_api.get_me()
        balance = me.get("user", {}).get("balance", 0)
        logger.info("LZT Market connected. Balance: %.2f", balance)
    except Exception as e:
        logger.warning("LZT Market connection check failed: %s", e)

    logger.info("Bot started successfully!")
    logger.info("Admin IDs: %s", settings.admin_id_list)


async def on_shutdown(bot: Bot) -> None:
    """Shutdown cleanup."""
    await lzt_api.close()
    logger.info("Bot stopped.")


async def main() -> None:
    """Start bot and web server."""
    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )

    dp = Dispatcher()
    dp.include_router(router)
    dp.startup.register(on_startup)
    dp.shutdown.register(on_shutdown)

    # Create web app for Mini App API
    web_app = create_web_app()
    runner = web.AppRunner(web_app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8081)
    await site.start()
    logger.info("Web API started on http://0.0.0.0:8080")

    # Start polling
    try:
        await dp.start_polling(bot)
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
