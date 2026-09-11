"""Measured health payload for GET /health."""
from __future__ import annotations

from importlib.metadata import version

from aiohttp import web

from mdtxtrt.bot import TelegramRuntime
from mdtxtrt.config import Settings


def rich_message_models_available() -> bool:
    try:
        from aiogram.types import InputRichMessage, InputRichMessageMedia
    except ImportError:
        return False
    return InputRichMessage is not None and InputRichMessageMedia is not None


async def health(request: web.Request) -> web.Response:
    settings: Settings = request.app["settings"]
    runtime: TelegramRuntime = request.app["telegram_runtime"]
    return web.json_response(
        {
            "ok": True,
            "runtime": "mdtxtrt-rebuild-v7-static-hardening",
            "target_bot_api_version": "10.3",
            "aiogram_version": version("aiogram"),
            "rich_message_models_available": rich_message_models_available(),
            "telegram_ready": runtime.telegram_ready,
            "polling_ready": runtime.polling_ready,
            "last_telegram_error": runtime.last_operational_error,
            "telegraph_key_configured": bool(settings.telegraph_key),
            "legacy_runtime_loaded": False,
        }
    )
