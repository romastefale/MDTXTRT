"""aiohttp boundary for the rebuilt Web App."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from aiohttp import web

from mdtxtrt.auth import AuthError, validate_init_data
from mdtxtrt.config import Settings
from mdtxtrt.services import DocumentService, EncodingChoiceRequired, ImportService

STATIC_DIR = Path(__file__).resolve().parent / "static"


def _identity(request: web.Request):
    settings: Settings = request.app["settings"]
    return validate_init_data(
        request.headers.get("X-Telegram-Init-Data", ""),
        bot_token=settings.telegram_token,
        ttl_seconds=settings.init_data_ttl_seconds,
    )


def _error(code: str, *, status: int = 400, **extra: Any) -> web.Response:
    return web.json_response({"ok": False, "error": code, **extra}, status=status)


@web.middleware
async def error_boundary(request: web.Request, handler):
    try:
        return await handler(request)
    except AuthError as exc:
        return _error(str(exc), status=401)
    except KeyError as exc:
        return _error(str(exc).strip("'"), status=404)
    except EncodingChoiceRequired as exc:
        return _error("encoding_choice_required", status=409, filename=exc.filename)
    except (ValueError, TypeError) as exc:
        return _error(str(exc), status=400)


async def index(_request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "index.html")


async def create_draft(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json() if request.can_read_body else {}
    service: DocumentService = request.app["documents"]
    draft = service.create(user_id=identity.user_id, name=payload.get("name", "Novo rascunho"))
    return web.json_response({"ok": True, "draft": draft}, status=201)


async def get_draft(request: web.Request) -> web.Response:
    identity = _identity(request)
    service: DocumentService = request.app["documents"]
    draft = service.get(user_id=identity.user_id, draft_id=request.match_info["draft_id"])
    return web.json_response({"ok": True, "draft": draft})


async def commit_revision(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: DocumentService = request.app["documents"]
    draft = service.commit(
        user_id=identity.user_id,
        draft_id=request.match_info["draft_id"],
        canonical=payload["document"],
        reason=str(payload.get("reason", "edit")),
    )
    return web.json_response({"ok": True, "draft": draft})


async def undo(request: web.Request) -> web.Response:
    identity = _identity(request)
    service: DocumentService = request.app["documents"]
    draft = service.undo(user_id=identity.user_id, draft_id=request.match_info["draft_id"])
    return web.json_response({"ok": True, "draft": draft})


async def redo(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: DocumentService = request.app["documents"]
    draft = service.redo(
        user_id=identity.user_id,
        draft_id=request.match_info["draft_id"],
        revision_id=str(payload["revision_id"]),
    )
    return web.json_response({"ok": True, "draft": draft})


async def save_session(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: DocumentService = request.app["documents"]
    service.save_session(
        user_id=identity.user_id,
        draft_id=request.match_info["draft_id"],
        payload=payload,
    )
    return web.json_response({"ok": True})


async def import_file(request: web.Request) -> web.Response:
    identity = _identity(request)
    reader = await request.multipart()
    file_part = await reader.next()
    if file_part is None or file_part.name != "file":
        raise ValueError("missing_file")
    filename = file_part.filename or "import.txt"
    mime_type = file_part.headers.get("Content-Type")
    data = await file_part.read(decode=False)

    encoding = None
    encoding_part = await reader.next()
    if encoding_part is not None and encoding_part.name == "encoding":
        encoding = (await encoding_part.text()).strip() or None

    service: ImportService = request.app["imports"]
    draft = service.import_file(
        user_id=identity.user_id,
        filename=filename,
        data=data,
        mime_type=mime_type,
        encoding=encoding,
    )
    return web.json_response({"ok": True, "draft": draft}, status=201)


def create_web_app(settings: Settings, documents: DocumentService, imports: ImportService) -> web.Application:
    # Do not invent a product upload limit here. Destination/API-specific limits
    # belong to their own validation boundaries.
    app = web.Application(middlewares=[error_boundary], client_max_size=0)
    app["settings"] = settings
    app["documents"] = documents
    app["imports"] = imports
    app.router.add_get("/", index)
    app.router.add_static("/static/", STATIC_DIR, show_index=False)
    app.router.add_post("/api/drafts", create_draft)
    app.router.add_get("/api/drafts/{draft_id}", get_draft)
    app.router.add_post("/api/drafts/{draft_id}/revisions", commit_revision)
    app.router.add_post("/api/drafts/{draft_id}/undo", undo)
    app.router.add_post("/api/drafts/{draft_id}/redo", redo)
    app.router.add_put("/api/drafts/{draft_id}/session", save_session)
    app.router.add_post("/api/import", import_file)
    return app
