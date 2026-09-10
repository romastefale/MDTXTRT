"""Explicit draft and original-file lifecycle routes for the rebuilt runtime."""
from __future__ import annotations

from urllib.parse import quote

from aiohttp import web

from mdtxtrt.assets import AssetService
from mdtxtrt.auth import AuthError, validate_init_data
from mdtxtrt.config import Settings
from mdtxtrt.services import DocumentService
from mdtxtrt.storage import SQLiteRepository


def _identity(request: web.Request):
    settings: Settings = request.app["settings"]
    return validate_init_data(
        request.headers.get("X-Telegram-Init-Data", ""),
        bot_token=settings.telegram_token,
        ttl_seconds=settings.init_data_ttl_seconds,
    )


def _download_headers(filename: str) -> dict[str, str]:
    clean = (filename or "arquivo").replace("\r", "").replace("\n", "")
    encoded = quote(clean, safe="")
    return {
        "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    }


async def delete_draft(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json() if request.can_read_body else {}
    documents: DocumentService = request.app["documents"]
    documents.delete(
        user_id=identity.user_id,
        draft_id=request.match_info["draft_id"],
        confirmed=payload.get("confirm") is True,
    )
    return web.json_response({"ok": True})


async def list_draft_imports(request: web.Request) -> web.Response:
    identity = _identity(request)
    documents: DocumentService = request.app["documents"]
    items = documents.list_imports(
        user_id=identity.user_id,
        draft_id=request.match_info["draft_id"],
    )
    return web.json_response({"ok": True, "imports": items})


async def download_import_original(request: web.Request) -> web.Response:
    identity = _identity(request)
    repository: SQLiteRepository = request.app["repository"]
    item = repository.get_import(user_id=identity.user_id, import_id=request.match_info["import_id"])
    return web.Response(
        body=item["original_bytes"],
        content_type=item.get("mime_type") or "application/octet-stream",
        headers=_download_headers(str(item.get("filename") or "import-original")),
    )


async def download_media_original(request: web.Request) -> web.Response:
    identity = _identity(request)
    assets: AssetService = request.app["assets"]
    blob = assets.get_media(user_id=identity.user_id, media_id=request.match_info["media_id"])
    return web.Response(
        body=blob.data,
        content_type=blob.mime_type or "application/octet-stream",
        headers=_download_headers(blob.filename),
    )


def attach_lifecycle_routes(app: web.Application) -> None:
    app.router.add_delete("/api/drafts/{draft_id}", delete_draft)
    app.router.add_get("/api/drafts/{draft_id}/imports", list_draft_imports)
    app.router.add_get("/api/imports/{import_id}/original", download_import_original)
    app.router.add_get("/api/media/{media_id}/original", download_media_original)
