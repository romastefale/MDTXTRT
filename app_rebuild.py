"""Compatibility entrypoint name for the rebuilt runtime.

`app.py` is now the canonical production entrypoint. This file remains so links
and operational references to the v4 rebuild are not broken.
"""
from aiohttp import web

from app import build_application
from mdtxtrt.config import Settings


if __name__ == "__main__":
    settings = Settings.from_env()
    web.run_app(build_application(settings), host=settings.host, port=settings.port)
