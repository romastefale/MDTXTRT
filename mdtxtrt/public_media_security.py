"""Same-origin public BLOB response hardening.

Public links are opt-in and tokenized by AssetService. This middleware only
controls browser interpretation of the anonymous response: active/document
MIME types are delivered as downloads instead of executable same-origin
content. Stored bytes and stored MIME metadata are never changed.
"""
from __future__ import annotations

from aiohttp import web

_SAFE_INLINE_PREFIXES = ("image/", "audio/", "video/")
_SAFE_INLINE_EXACT = {"text/plain"}
_ACTIVE_TYPES = {
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "application/xml",
    "text/xml",
    "application/pdf",
}


def _safe_inline(content_type: str) -> bool:
    value = (content_type or "").split(";", 1)[0].strip().lower()
    if value in _ACTIVE_TYPES:
        return False
    return value in _SAFE_INLINE_EXACT or value.startswith(_SAFE_INLINE_PREFIXES)


@web.middleware
async def public_media_response_policy(request: web.Request, handler):
    response = await handler(request)
    if not request.path.startswith("/public/media/"):
        return response

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"

    if not _safe_inline(response.content_type or ""):
        # Preserve bytes exactly, but prevent same-origin active interpretation.
        response.content_type = "application/octet-stream"
        response.headers.setdefault("Content-Disposition", "attachment")
    return response
