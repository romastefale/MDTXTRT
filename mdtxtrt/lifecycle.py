"""Explicit draft and original-file lifecycle routes for the rebuilt runtime."""
from __future__ import annotations

from typing import Any
from urllib.parse import quote
from uuid import uuid4

from aiohttp import web

from mdtxtrt.assets import AssetService
from mdtxtrt.auth import validate_init_data
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


def _remap_media(value: Any, mapping: dict[str, str]) -> Any:
    if isinstance(value, list):
        return [_remap_media(item, mapping) for item in value]
    if not isinstance(value, dict):
        return value
    out = {key: _remap_media(item, mapping) for key, item in value.items()}
    attrs = out.get("attrs")
    if isinstance(attrs, dict):
        old_id = str(attrs.get("media_blob_id") or "")
        if old_id and old_id in mapping:
            attrs["media_blob_id"] = mapping[old_id]
            attrs.pop("src", None)
    return out


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


async def duplicate_draft(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json() if request.can_read_body else {}
    if payload.get("confirm") is not True:
        raise ValueError("draft_duplicate_confirmation_required")
    documents: DocumentService = request.app["documents"]
    assets: AssetService = request.app["assets"]
    source_id = request.match_info["draft_id"]
    source = documents.get(user_id=identity.user_id, draft_id=source_id)
    requested_name = str(payload.get("name") or "").strip()
    target = documents.create(
        user_id=identity.user_id,
        name=requested_name or f"{source['name']} — cópia",
    )
    try:
        mapping = assets.clone_draft_media(
            user_id=identity.user_id,
            source_draft_id=source_id,
            target_draft_id=target["id"],
        )
        remapped = _remap_media(source["document"], mapping)
        remapped["id"] = str(uuid4())
        target = documents.commit(
            user_id=identity.user_id,
            draft_id=target["id"],
            canonical=remapped,
            reason=f"duplicate:{source_id}",
        )
    except Exception:
        documents.delete(user_id=identity.user_id, draft_id=target["id"], confirmed=True)
        raise
    return web.json_response({"ok": True, "draft": target, "copied_media": len(mapping)}, status=201)


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


async def replace_media(request: web.Request) -> web.Response:
    identity = _identity(request)
    assets: AssetService = request.app["assets"]
    previous = assets.get_media(user_id=identity.user_id, media_id=request.match_info["media_id"])
    reader = await request.multipart()
    part = await reader.next()
    if part is None or part.name != "file":
        raise ValueError("missing_file")
    data = await part.read(decode=False)
    media = assets.store_media(
        user_id=identity.user_id,
        draft_id=previous.draft_id,
        filename=part.filename or previous.filename,
        mime_type=part.headers.get("Content-Type") or previous.mime_type,
        data=data,
        replaces_media_id=previous.id,
    )
    return web.json_response({"ok": True, "media": media}, status=201)


async def media_history(request: web.Request) -> web.Response:
    identity = _identity(request)
    assets: AssetService = request.app["assets"]
    history = assets.replacement_history(user_id=identity.user_id, media_id=request.match_info["media_id"])
    return web.json_response({"ok": True, "history": history})


def attach_lifecycle_routes(app: web.Application) -> None:
    app.router.add_delete("/api/drafts/{draft_id}", delete_draft)
    app.router.add_post("/api/drafts/{draft_id}/duplicate", duplicate_draft)
    app.router.add_get("/api/drafts/{draft_id}/imports", list_draft_imports)
    app.router.add_get("/api/imports/{import_id}/original", download_import_original)
    app.router.add_get("/api/media/{media_id}/original", download_media_original)
    app.router.add_post("/api/media/{media_id}/replace", replace_media)
    app.router.add_get("/api/media/{media_id}/history", media_history)
