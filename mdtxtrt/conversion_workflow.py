"""Explicit conversion review routes that never mutate a draft implicitly."""
from __future__ import annotations

from typing import Any

from aiohttp import web

from mdtxtrt.auth import validate_init_data
from mdtxtrt.config import Settings
from mdtxtrt.conversion import from_markdown, to_markdown, to_text
from mdtxtrt.domain import CanonicalNode


def _identity(request: web.Request):
    settings: Settings = request.app["settings"]
    return validate_init_data(
        request.headers.get("X-Telegram-Init-Data", ""),
        bot_token=settings.telegram_token,
        ttl_seconds=settings.init_data_ttl_seconds,
    )


def _collect_raw(nodes: tuple[CanonicalNode, ...]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def walk(node: CanonicalNode) -> None:
        if node.kind == "raw_markdown":
            out.append({"node_id": node.id, "reason": node.attrs.get("reason"), "text": node.text or ""})
        for child in node.children:
            walk(child)

    for node in nodes:
        walk(node)
    return out


async def review_raw_markdown(request: web.Request) -> web.Response:
    _identity(request)
    payload = await request.json()
    source = str(payload.get("source") or "")
    document = from_markdown(source)
    residual = _collect_raw(document.blocks)
    converted = document.to_dict()
    return web.json_response(
        {
            "ok": True,
            "review": {
                "original": source,
                "converted_document": converted,
                "converted_markdown": to_markdown(document),
                "converted_text": to_text(document),
                "residual_raw_markdown": residual,
                "has_residual_raw_markdown": bool(residual),
                "lossless_visual_conversion": not residual,
            },
        }
    )


def attach_conversion_routes(app: web.Application) -> None:
    app.router.add_post("/api/conversion/raw-markdown/review", review_raw_markdown)
