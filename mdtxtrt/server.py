"""aiohttp boundary for the rebuilt Web App and publication APIs."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from aiohttp import web
from aiogram.exceptions import TelegramAPIError
from telegraph.exceptions import TelegraphException

from mdtxtrt.auth import AuthError, validate_init_data
from mdtxtrt.bot import TelegramRuntime
from mdtxtrt.config import Settings
from mdtxtrt.publishing import (
    ProjectionConfirmationRequired,
    ProjectionRejected,
    TelegramPublicationService,
    TelegraphPublicationService,
)
from mdtxtrt.services import DocumentService, EncodingChoiceRequired, ImportService

STATIC_DIR = Path(__file__).resolve().parent / "static"
log = logging.getLogger("mdtxtrt.server")


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
    except ProjectionConfirmationRequired as exc:
        return _error("projection_confirmation_required", status=409, review=exc.review.public())
    except ProjectionRejected as exc:
        return _error("projection_not_publishable", status=422, review=exc.review.public())
    except TelegramAPIError as exc:
        log.warning("Telegram rejected publication: %s", exc)
        return _error("telegram_api_error", status=502, detail=str(exc))
    except TelegraphException as exc:
        log.warning("Telegraph rejected publication: %s", exc)
        return _error("telegraph_api_error", status=502, detail=str(exc))
    except (ValueError, TypeError) as exc:
        return _error(str(exc), status=400)
    except RuntimeError as exc:
        log.exception("runtime boundary failure")
        return _error(str(exc), status=503)
    except Exception:
        log.exception("unhandled request failure")
        return _error("internal_error", status=500)


async def index(_request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "index.html")


async def health(request: web.Request) -> web.Response:
    settings: Settings = request.app["settings"]
    return web.json_response(
        {
            "ok": True,
            "runtime": "mdtxtrt-rebuild-v5",
            "telegram_bot_api": "10.3",
            "canonical_document": True,
            "telegraph_per_user": True,
            "telegraph_key_configured": bool(settings.telegraph_key),
            "legacy_runtime_loaded": False,
        }
    )


async def list_drafts(request: web.Request) -> web.Response:
    identity = _identity(request)
    archived = request.query.get("archived", "0").lower() in {"1", "true", "yes"}
    service: DocumentService = request.app["documents"]
    return web.json_response({"ok": True, "drafts": service.list(user_id=identity.user_id, archived=archived)})


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


async def update_draft(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: DocumentService = request.app["documents"]
    draft_id = request.match_info["draft_id"]
    if "name" in payload:
        service.rename(user_id=identity.user_id, draft_id=draft_id, name=str(payload["name"]))
    if "archived" in payload:
        service.archive(user_id=identity.user_id, draft_id=draft_id, archived=bool(payload["archived"]))
    return web.json_response({"ok": True, "draft": service.get(user_id=identity.user_id, draft_id=draft_id)})


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
    return web.json_response({"ok": True, "draft": service.undo(user_id=identity.user_id, draft_id=request.match_info["draft_id"])})


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
    service.save_session(user_id=identity.user_id, draft_id=request.match_info["draft_id"], payload=payload)
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


async def list_publications(request: web.Request) -> web.Response:
    identity = _identity(request)
    repository = request.app["repository"]
    return web.json_response({"ok": True, "publications": repository.list_publications(user_id=identity.user_id)})


async def telegram_preview(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: TelegramPublicationService = request.app["telegram_publications"]
    revision_id, review = service.preview(user_id=identity.user_id, draft_id=str(payload["draft_id"]))
    return web.json_response({"ok": True, "revision_id": revision_id, "review": review.public()})


async def telegram_publish(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: TelegramPublicationService = request.app["telegram_publications"]
    runtime: TelegramRuntime = request.app["telegram_runtime"]
    publication = await service.publish(
        bot=runtime.bot,
        user_id=identity.user_id,
        draft_id=str(payload["draft_id"]),
        destination_chat_id=payload.get("destination_chat_id", identity.user_id),
        title=str(payload.get("title") or "Publicação Telegram"),
        confirmed_fingerprint=payload.get("confirmed_fingerprint"),
    )
    return web.json_response({"ok": True, "publication": publication}, status=201)


async def telegram_edit(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: TelegramPublicationService = request.app["telegram_publications"]
    runtime: TelegramRuntime = request.app["telegram_runtime"]
    publication = await service.edit(
        bot=runtime.bot,
        user_id=identity.user_id,
        publication_id=request.match_info["publication_id"],
        title=str(payload.get("title") or ""),
        confirmed_fingerprint=payload.get("confirmed_fingerprint"),
    )
    return web.json_response({"ok": True, "publication": publication})


def _telegraph_service(request: web.Request) -> TelegraphPublicationService:
    service = request.app.get("telegraph_publications")
    if service is None:
        raise RuntimeError("MDTXTRT_TELEGRAPH_KEY is not configured")
    return service


async def telegraph_preview(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    revision_id, review = _telegraph_service(request).preview(user_id=identity.user_id, draft_id=str(payload["draft_id"]))
    return web.json_response({"ok": True, "revision_id": revision_id, "review": review.public()})


async def telegraph_publish(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    publication = await _telegraph_service(request).publish(
        user_id=identity.user_id,
        draft_id=str(payload["draft_id"]),
        title=str(payload.get("title") or "Sem título"),
        confirmed_fingerprint=payload.get("confirmed_fingerprint"),
    )
    return web.json_response({"ok": True, "publication": publication}, status=201)


async def telegraph_edit(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    publication = await _telegraph_service(request).edit(
        user_id=identity.user_id,
        publication_id=request.match_info["publication_id"],
        title=str(payload.get("title") or ""),
        confirmed_fingerprint=payload.get("confirmed_fingerprint"),
    )
    return web.json_response({"ok": True, "publication": publication})


def create_web_app(
    settings: Settings,
    documents: DocumentService,
    imports: ImportService,
    repository,
    telegram_publications: TelegramPublicationService,
    telegraph_publications: TelegraphPublicationService | None,
    telegram_runtime: TelegramRuntime,
) -> web.Application:
    app = web.Application(middlewares=[error_boundary], client_max_size=0)
    app["settings"] = settings
    app["documents"] = documents
    app["imports"] = imports
    app["repository"] = repository
    app["telegram_publications"] = telegram_publications
    app["telegraph_publications"] = telegraph_publications
    app["telegram_runtime"] = telegram_runtime

    app.router.add_get("/", index)
    app.router.add_get("/health", health)
    app.router.add_static("/static/", STATIC_DIR, show_index=False)
    app.router.add_get("/api/drafts", list_drafts)
    app.router.add_post("/api/drafts", create_draft)
    app.router.add_get("/api/drafts/{draft_id}", get_draft)
    app.router.add_patch("/api/drafts/{draft_id}", update_draft)
    app.router.add_post("/api/drafts/{draft_id}/revisions", commit_revision)
    app.router.add_post("/api/drafts/{draft_id}/undo", undo)
    app.router.add_post("/api/drafts/{draft_id}/redo", redo)
    app.router.add_put("/api/drafts/{draft_id}/session", save_session)
    app.router.add_post("/api/import", import_file)
    app.router.add_get("/api/publications", list_publications)
    app.router.add_post("/api/publish/telegram/preview", telegram_preview)
    app.router.add_post("/api/publish/telegram", telegram_publish)
    app.router.add_put("/api/publications/{publication_id}/telegram", telegram_edit)
    app.router.add_post("/api/publish/telegraph/preview", telegraph_preview)
    app.router.add_post("/api/publish/telegraph", telegraph_publish)
    app.router.add_put("/api/publications/{publication_id}/telegraph", telegraph_edit)

    async def startup(_app: web.Application) -> None:
        await telegram_runtime.on_startup()

    async def cleanup(_app: web.Application) -> None:
        await telegram_runtime.on_cleanup()

    app.on_startup.append(startup)
    app.on_cleanup.append(cleanup)
    return app
