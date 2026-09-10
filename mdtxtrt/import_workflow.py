"""Explicit staged-import review API.

Uploads are staged first. A partial Markdown conversion is shown before any
draft is created; completion requires an explicit confirmation flag.
"""
from __future__ import annotations

from aiohttp import web

from mdtxtrt.auth import validate_init_data
from mdtxtrt.config import Settings
from mdtxtrt.services import EncodingChoiceRequired, ImportReviewRequired, ImportService


def _identity(request: web.Request):
    settings: Settings = request.app["settings"]
    return validate_init_data(
        request.headers.get("X-Telegram-Init-Data", ""),
        bot_token=settings.telegram_token,
        ttl_seconds=settings.init_data_ttl_seconds,
    )


def _encoding_error(exc: EncodingChoiceRequired) -> web.Response:
    return web.json_response(
        {
            "ok": False,
            "error": "encoding_choice_required",
            "filename": exc.filename,
            "pending_import_id": exc.pending_import_id,
        },
        status=409,
    )


async def stage_import(request: web.Request) -> web.Response:
    identity = _identity(request)
    reader = await request.multipart()
    part = await reader.next()
    if part is None or part.name != "file":
        raise ValueError("missing_file")
    filename = part.filename or "import.txt"
    mime_type = part.headers.get("Content-Type")
    data = await part.read(decode=False)
    service: ImportService = request.app["imports"]
    pending = service.stage_file(
        user_id=identity.user_id,
        filename=filename,
        mime_type=mime_type,
        data=data,
    )
    try:
        review = service.preview_pending(
            user_id=identity.user_id,
            pending_import_id=pending.id,
        )
    except EncodingChoiceRequired as exc:
        return _encoding_error(exc)
    return web.json_response({"ok": True, "pending_import": pending.public(), "review": review}, status=201)


async def preview_import(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json() if request.can_read_body else {}
    encoding = str(payload.get("encoding") or "").strip() or None
    service: ImportService = request.app["imports"]
    try:
        review = service.preview_pending(
            user_id=identity.user_id,
            pending_import_id=request.match_info["pending_import_id"],
            encoding=encoding,
        )
    except EncodingChoiceRequired as exc:
        return _encoding_error(exc)
    return web.json_response({"ok": True, "review": review})


async def complete_import(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json() if request.can_read_body else {}
    encoding = str(payload.get("encoding") or "").strip() or None
    confirmed = payload.get("confirm_partial") is True
    service: ImportService = request.app["imports"]
    try:
        draft = service.complete_pending(
            user_id=identity.user_id,
            pending_import_id=request.match_info["pending_import_id"],
            encoding=encoding,
            confirm_partial=confirmed,
        )
    except EncodingChoiceRequired as exc:
        return _encoding_error(exc)
    except ImportReviewRequired as exc:
        return web.json_response(
            {
                "ok": False,
                "error": "import_review_required",
                "pending_import_id": exc.pending_import_id,
                "review": exc.review,
            },
            status=409,
        )
    return web.json_response({"ok": True, "draft": draft}, status=201)


def attach_import_workflow_routes(app: web.Application) -> None:
    app.router.add_post("/api/import-workflow/stage", stage_import)
    app.router.add_post("/api/import-workflow/{pending_import_id}/preview", preview_import)
    app.router.add_post("/api/import-workflow/{pending_import_id}/complete", complete_import)
