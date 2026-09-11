"""aiohttp boundary for the rebuilt Web App and publication APIs."""
from __future__ import annotations

import logging
from importlib.metadata import version
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from aiohttp import web
from aiogram.exceptions import TelegramAPIError
from telegraph.exceptions import TelegraphException

from mdtxtrt.assets import AssetService
from mdtxtrt.auth import AuthError, validate_init_data
from mdtxtrt.bot import TelegramRuntime
from mdtxtrt.config import Settings
from mdtxtrt.publishing import (
    ProjectionConfirmationRequired,
    ProjectionRejected,
    TelegramPublicationService,
    TelegraphPublicationService,
)
from mdtxtrt.services import (
    MAX_IMPORT_BYTES,
    DocumentService,
    EncodingChoiceRequired,
    ImportReviewRequired,
    ImportService,
)
from mdtxtrt.telegram_validation import TelegramDestinationContext

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


def _public_origin(settings: Settings) -> str:
    raw = (settings.web_app_url or "").strip()
    parts = urlsplit(raw)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise RuntimeError("WEB_APP_URL must be configured before creating public media links")
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


@web.middleware
async def error_boundary(request: web.Request, handler):
    try:
        return await handler(request)
    except AuthError as exc:
        return _error(str(exc), status=401)
    except KeyError as exc:
        return _error(str(exc).strip("'"), status=404)
    except EncodingChoiceRequired as exc:
        return _error(
            "encoding_choice_required",
            status=409,
            filename=exc.filename,
            pending_import_id=exc.pending_import_id,
        )
    except ImportReviewRequired as exc:
        return _error(
            "import_review_required",
            status=409,
            pending_import_id=exc.pending_import_id,
            review=exc.review,
        )
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
    runtime: TelegramRuntime = request.app["telegram_runtime"]
    return web.json_response(
        {
            "ok": True,
            "runtime": "mdtxtrt-rebuild-v7-static-hardening",
            "target_bot_api_version": "10.3",
            "aiogram_version": version("aiogram"),
            "rich_message_models_available": True,
            "telegram_ready": runtime.telegram_ready,
            "polling_ready": runtime.polling_ready,
            "last_telegram_error": runtime.last_operational_error,
            "canonical_document": True,
            "telegraph_per_user": True,
            "telegraph_key_configured": bool(settings.telegraph_key),
            "local_media": True,
            "native_location": True,
            "persistent_pending_imports": True,
            "telegram_representations": ["markdown", "html", "blocks"],
            "positional_output_override": True,
            "semantic_recovery_review": True,
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
    """Compatibility endpoint. It still obeys staged review and never bypasses it."""
    identity = _identity(request)
    reader = await request.multipart()
    file_part = await reader.next()
    if file_part is None or file_part.name != "file":
        raise ValueError("missing_file")
    filename = file_part.filename or "import.txt"
    mime_type = file_part.headers.get("Content-Type")
    chunks = bytearray()
    while not file_part.at_eof():
        chunks.extend(await file_part.read_chunk())
        if len(chunks) > MAX_IMPORT_BYTES:
            raise ValueError("import_file_too_large")
    data = bytes(chunks)
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
        confirm_partial=False,
    )
    return web.json_response({"ok": True, "draft": draft}, status=201)


async def get_pending_import(request: web.Request) -> web.Response:
    identity = _identity(request)
    service: ImportService = request.app["imports"]
    pending = service.get_pending(
        user_id=identity.user_id,
        pending_import_id=request.match_info["pending_import_id"],
    )
    return web.json_response({"ok": True, "pending_import": pending})


async def complete_pending_import(request: web.Request) -> web.Response:
    """Compatibility endpoint; partial conversions require explicit confirm_partial."""
    identity = _identity(request)
    payload = await request.json() if request.can_read_body else {}
    service: ImportService = request.app["imports"]
    draft = service.complete_pending(
        user_id=identity.user_id,
        pending_import_id=request.match_info["pending_import_id"],
        encoding=(str(payload.get("encoding") or "").strip() or None),
        confirm_partial=payload.get("confirm_partial") is True,
    )
    return web.json_response({"ok": True, "draft": draft}, status=201)


async def upload_media(request: web.Request) -> web.Response:
    identity = _identity(request)
    reader = await request.multipart()
    draft_id: str | None = None
    filename = "arquivo"
    mime_type: str | None = None
    data: bytes | None = None
    while True:
        part = await reader.next()
        if part is None:
            break
        if part.name == "draft_id":
            draft_id = (await part.text()).strip()
        elif part.name == "file":
            filename = part.filename or "arquivo"
            mime_type = part.headers.get("Content-Type")
            data = await part.read(decode=False)
    if not draft_id:
        raise ValueError("missing_draft_id")
    if data is None:
        raise ValueError("missing_file")
    assets: AssetService = request.app["assets"]
    media = assets.store_media(
        user_id=identity.user_id,
        draft_id=draft_id,
        filename=filename,
        mime_type=mime_type,
        data=data,
    )
    return web.json_response({"ok": True, "media": media}, status=201)


async def create_public_media_link(request: web.Request) -> web.Response:
    identity = _identity(request)
    assets: AssetService = request.app["assets"]
    settings: Settings = request.app["settings"]
    link = assets.create_public_link(
        user_id=identity.user_id,
        media_id=request.match_info["media_id"],
        public_base_url=_public_origin(settings),
    )
    return web.json_response({"ok": True, "public": link}, status=201)


async def revoke_public_media_links(request: web.Request) -> web.Response:
    identity = _identity(request)
    assets: AssetService = request.app["assets"]
    assets.revoke_public_links(user_id=identity.user_id, media_id=request.match_info["media_id"])
    return web.json_response({"ok": True})


async def public_media(request: web.Request) -> web.Response:
    assets: AssetService = request.app["assets"]
    blob = assets.get_public_media(request.match_info["token"])
    return web.Response(
        body=blob.data,
        content_type=blob.mime_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


async def create_location_request(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    draft_id = str(payload.get("draft_id") or "").strip()
    if not draft_id:
        raise ValueError("missing_draft_id")
    assets: AssetService = request.app["assets"]
    runtime: TelegramRuntime = request.app["telegram_runtime"]
    location_request = assets.create_location_request(user_id=identity.user_id, draft_id=draft_id)
    await runtime.prompt_location(identity.user_id)
    bot_url = f"https://t.me/{runtime.bot_username}" if runtime.bot_username else None
    return web.json_response({"ok": True, "request": location_request, "bot_url": bot_url}, status=201)


async def get_location_request(request: web.Request) -> web.Response:
    identity = _identity(request)
    assets: AssetService = request.app["assets"]
    location_request = assets.get_location_request(
        user_id=identity.user_id,
        request_id=request.match_info["request_id"],
    )
    return web.json_response({"ok": True, "request": location_request})


async def list_publications(request: web.Request) -> web.Response:
    identity = _identity(request)
    repository = request.app["repository"]
    return web.json_response({"ok": True, "publications": repository.list_publications(user_id=identity.user_id)})


async def _destination_context(
    request: web.Request, payload: dict[str, Any], default_chat_id: str | int
) -> TelegramDestinationContext:
    """Resolve destination facts once, before representation selection and send."""
    chat_id = payload.get("destination_chat_id", default_chat_id)
    supplied = dict(payload.get("destination_context") or {})
    supplied["chat_id"] = chat_id
    if str(chat_id) == str(default_chat_id) and str(default_chat_id).lstrip("-").isdigit() and int(default_chat_id) > 0:
        supplied["chat_type"] = "private"
    else:
        runtime: TelegramRuntime = request.app["telegram_runtime"]
        chat = await runtime.bot.get_chat(chat_id)
        chat_type = getattr(chat, "type", "unknown")
        supplied["chat_type"] = getattr(chat_type, "value", str(chat_type))
    return TelegramDestinationContext.from_dict(supplied, default_chat_id=chat_id)


async def telegram_preview(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: TelegramPublicationService = request.app["telegram_publications"]
    destination = await _destination_context(request, payload, identity.user_id)
    revision_id, representations = service.preview(
        user_id=identity.user_id,
        draft_id=str(payload["draft_id"]),
        document_override=payload.get("document_override"),
        destination=destination,
    )
    return web.json_response(
        {"ok": True, "revision_id": revision_id, "representations": representations.public()}
    )


async def telegram_publish(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: TelegramPublicationService = request.app["telegram_publications"]
    runtime: TelegramRuntime = request.app["telegram_runtime"]
    destination = await _destination_context(request, payload, identity.user_id)
    publication = await service.publish(
        bot=runtime.bot,
        user_id=identity.user_id,
        draft_id=str(payload["draft_id"]),
        destination_chat_id=payload.get("destination_chat_id", identity.user_id),
        title=str(payload.get("title") or "Publicação Telegram"),
        confirmed_fingerprint=payload.get("confirmed_fingerprint"),
        representation=payload.get("representation"),
        document_override=payload.get("document_override"),
        destination=destination,
    )
    return web.json_response({"ok": True, "publication": publication}, status=201)


async def telegram_edit(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: TelegramPublicationService = request.app["telegram_publications"]
    runtime: TelegramRuntime = request.app["telegram_runtime"]
    publication_record = request.app["repository"].get_publication(
        publication_id=request.match_info["publication_id"], user_id=identity.user_id
    )
    destination = await _destination_context(
        request, payload, publication_record.get("destination_chat_id") or identity.user_id
    )
    publication = await service.edit(
        bot=runtime.bot,
        user_id=identity.user_id,
        publication_id=request.match_info["publication_id"],
        title=str(payload.get("title") or ""),
        confirmed_fingerprint=payload.get("confirmed_fingerprint"),
        representation=payload.get("representation"),
        document_override=payload.get("document_override"),
        destination_context=destination,
    )
    return web.json_response({"ok": True, "publication": publication})


async def telegram_republish(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    service: TelegramPublicationService = request.app["telegram_publications"]
    runtime: TelegramRuntime = request.app["telegram_runtime"]
    previous = request.app["repository"].get_publication(
        publication_id=request.match_info["publication_id"], user_id=identity.user_id
    )
    destination = await _destination_context(
        request, payload, payload.get("destination_chat_id") or previous.get("destination_chat_id") or identity.user_id
    )
    publication = await service.republish(
        bot=runtime.bot,
        user_id=identity.user_id,
        publication_id=request.match_info["publication_id"],
        title=(str(payload.get("title") or "").strip() or None),
        destination_chat_id=payload.get("destination_chat_id"),
        confirmed_fingerprint=payload.get("confirmed_fingerprint"),
        representation=payload.get("representation"),
        document_override=payload.get("document_override"),
        destination=destination,
    )
    return web.json_response({"ok": True, "publication": publication}, status=201)


def _telegraph_service(request: web.Request) -> TelegraphPublicationService:
    service = request.app.get("telegraph_publications")
    if service is None:
        raise RuntimeError("MDTXTRT_TELEGRAPH_KEY is not configured")
    return service


async def telegraph_preview(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    revision_id, review = _telegraph_service(request).preview(
        user_id=identity.user_id,
        draft_id=str(payload["draft_id"]),
        document_override=payload.get("document_override"),
    )
    return web.json_response({"ok": True, "revision_id": revision_id, "review": review.public()})


async def telegraph_publish(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    publication = await _telegraph_service(request).publish(
        user_id=identity.user_id,
        draft_id=str(payload["draft_id"]),
        title=str(payload.get("title") or "Sem título"),
        confirmed_fingerprint=payload.get("confirmed_fingerprint"),
        document_override=payload.get("document_override"),
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
        document_override=payload.get("document_override"),
    )
    return web.json_response({"ok": True, "publication": publication})


def create_web_app(
    settings: Settings,
    documents: DocumentService,
    imports: ImportService,
    repository,
    assets: AssetService,
    telegram_publications: TelegramPublicationService,
    telegraph_publications: TelegraphPublicationService | None,
    telegram_runtime: TelegramRuntime,
) -> web.Application:
    app = web.Application(middlewares=[error_boundary], client_max_size=0)
    app["settings"] = settings
    app["documents"] = documents
    app["imports"] = imports
    app["repository"] = repository
    app["assets"] = assets
    app["telegram_publications"] = telegram_publications
    app["telegraph_publications"] = telegraph_publications
    app["telegram_runtime"] = telegram_runtime

    app.router.add_get("/", index)
    app.router.add_get("/health", health)
    app.router.add_static("/static/", STATIC_DIR, show_index=False)
    app.router.add_get("/public/media/{token}", public_media)
    app.router.add_get("/api/drafts", list_drafts)
    app.router.add_post("/api/drafts", create_draft)
    app.router.add_get("/api/drafts/{draft_id}", get_draft)
    app.router.add_patch("/api/drafts/{draft_id}", update_draft)
    app.router.add_post("/api/drafts/{draft_id}/revisions", commit_revision)
    app.router.add_post("/api/drafts/{draft_id}/undo", undo)
    app.router.add_post("/api/drafts/{draft_id}/redo", redo)
    app.router.add_put("/api/drafts/{draft_id}/session", save_session)
    app.router.add_post("/api/import", import_file)
    app.router.add_get("/api/imports/pending/{pending_import_id}", get_pending_import)
    app.router.add_post("/api/imports/pending/{pending_import_id}/complete", complete_pending_import)
    app.router.add_post("/api/media", upload_media)
    app.router.add_post("/api/media/{media_id}/public", create_public_media_link)
    app.router.add_delete("/api/media/{media_id}/public", revoke_public_media_links)
    app.router.add_post("/api/location-requests", create_location_request)
    app.router.add_get("/api/location-requests/{request_id}", get_location_request)
    app.router.add_get("/api/publications", list_publications)
    app.router.add_post("/api/publish/telegram/preview", telegram_preview)
    app.router.add_post("/api/publish/telegram", telegram_publish)
    app.router.add_put("/api/publications/{publication_id}/telegram", telegram_edit)
    app.router.add_post("/api/publications/{publication_id}/telegram/republish", telegram_republish)
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
