"""Instala a camada canônica Rich 10.3 sem reescrever handlers já validados do bot."""
from __future__ import annotations

import asyncio
import json
import re
import time
from collections import defaultdict, deque
from pathlib import Path

from aiohttp import web
from aiogram.types import (
    BufferedInputFile,
    InputMediaAnimation,
    InputMediaAudio,
    InputMediaDocument,
    InputMediaPhoto,
    InputMediaVideo,
    InputRichMessage,
    InputRichMessageMedia,
)
from telegraph import Telegraph
from telegraph.exceptions import TelegraphException

from canonical import CanonicalDocument

MAX_MEDIA_BYTES = 50 * 1024 * 1024
_PUBLISH_RATE: dict[str, deque[float]] = defaultdict(deque)
_BASE = None
_ORIGINAL_HEALTH = None
_ROOT = Path(__file__).resolve().parent


def _media_kind(filename: str, mime: str, requested: str) -> str:
    requested = (requested or "auto").lower()
    if requested in {"photo", "video", "animation", "audio", "document"}:
        return requested
    name, mime = (filename or "").lower(), (mime or "").lower()
    if mime == "image/gif" or name.endswith(".gif"):
        return "animation"
    if mime.startswith("image/"):
        return "photo"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    return "document"


def _input_media(item: dict):
    upload = BufferedInputFile(item["data"], filename=item["name"])
    kind = item["kind"]
    if kind == "photo":
        return InputMediaPhoto(media=upload)
    if kind == "video":
        return InputMediaVideo(media=upload)
    if kind == "animation":
        return InputMediaAnimation(media=upload)
    if kind == "audio":
        return InputMediaAudio(media=upload)
    return InputMediaDocument(media=upload)


def build_rich_message(content: str) -> InputRichMessage:
    markdown, refs = CanonicalDocument.from_markdown(content).telegram_markdown()
    media: list[InputRichMessageMedia] = []
    now = time.time()
    for ref in refs:
        item = _BASE.MEDIA.get(ref.media_id)
        if not item or item.get("exp", 0) < now:
            raise ValueError(f"Mídia local {ref.media_id} expirou; faça o upload novamente.")
        media.append(InputRichMessageMedia(id=ref.media_id, media=_input_media(item)))
    return InputRichMessage(markdown=markdown, media=media or None)


def publish_page(title: str, content_md: str, _path_hint: str = "") -> dict:
    title = (title or "Sem título").strip()[:256] or "Sem título"
    projection = CanonicalDocument.from_markdown(content_md).telegraph()
    telegraph = Telegraph()
    telegraph.create_account(short_name="MDTXTRT")
    page = telegraph.create_page(title=title, html_content=projection.html)
    return {
        "url": page.get("url"),
        "path": page.get("path"),
        "title": title,
        "degradations": list(projection.degradations),
    }


async def publish_page_async(title: str, content_md: str, path_hint: str = "") -> dict:
    return await asyncio.get_running_loop().run_in_executor(None, publish_page, title, content_md, path_hint)


def _publish_allowed(request: web.Request) -> bool:
    forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    key = forwarded or request.remote or "unknown"
    now = time.time()
    queue = _PUBLISH_RATE[key]
    while queue and queue[0] < now - 60:
        queue.popleft()
    if len(queue) >= 6:
        return False
    queue.append(now)
    return True


async def api_publish(request: web.Request):
    if not _publish_allowed(request):
        return web.json_response({"ok": False, "error": "Muitas publicações em sequência; tente novamente em um minuto."}, status=429)
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    raw = _BASE.init_data_from_request(data, request)
    if raw and not _BASE.validate_init_data(raw):
        return _BASE.session_error(raw)
    content = (data.get("content") or "").strip()
    if not content:
        return web.json_response({"ok": False, "error": "Documento vazio"}, status=400)
    try:
        page = await publish_page_async(data.get("title") or "Sem título", content)
        return web.json_response({"ok": True, **page})
    except TelegraphException as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=502)
    except Exception as exc:
        _BASE.log.exception("api_publish")
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


async def api_media(request: web.Request):
    _BASE.purge_stash()
    try:
        post = await request.post()
    except Exception:
        return web.json_response({"ok": False, "error": "Envio inválido"}, status=400)
    raw_init = str(post.get("init_data") or "").strip()
    if not _BASE.validate_init_data(raw_init):
        return _BASE.session_error(raw_init)
    upload = post.get("file")
    if upload is None or not hasattr(upload, "file"):
        return web.json_response({"ok": False, "error": "Falta o arquivo"}, status=400)
    raw = upload.file.read()
    if not raw:
        return web.json_response({"ok": False, "error": "Arquivo vazio"}, status=400)
    if len(raw) > MAX_MEDIA_BYTES:
        return web.json_response({"ok": False, "error": "Mídia acima de 50 MB"}, status=413)
    filename = getattr(upload, "filename", None) or "media.bin"
    mime = (getattr(upload, "content_type", None) or "application/octet-stream").lower()
    kind = _media_kind(filename, mime, str(post.get("kind") or "auto"))
    if kind == "photo" and len(raw) > 10 * 1024 * 1024:
        return web.json_response({"ok": False, "error": "Foto acima de 10 MB"}, status=413)
    mid = _BASE.new_stash_code()
    _BASE.MEDIA[mid] = {"data": raw, "name": filename, "mime": mime, "kind": kind, "exp": time.time() + _BASE.STASH_TTL}
    return web.json_response({"ok": True, "id": mid, "kind": kind})


def render_index() -> str:
    shell = (_ROOT / "ui_shell.html").read_text(encoding="utf-8")
    css = (_ROOT / "ui.css").read_text(encoding="utf-8")
    js = "".join(path.read_text(encoding="utf-8") for path in sorted(_ROOT.glob("ui.*.js")))
    return shell.replace("/*__CSS__*/", css).replace("/*__JS__*/", js)


async def serve_index(_request: web.Request):
    return web.Response(text=render_index(), content_type="text/html", charset="utf-8")


async def health(request: web.Request):
    if _ORIGINAL_HEALTH is None:
        raise RuntimeError("runtime_v2.install() não capturou o health original")
    base = await _ORIGINAL_HEALTH(request)
    payload = json.loads(base.text)
    payload.update({"document_model": "canonical", "telegram_rich": "10.3", "media_model": "typed"})
    return web.json_response(payload)


def install(base_module) -> None:
    global _BASE, _ORIGINAL_HEALTH
    _BASE = base_module
    # Capture before patching. Reinstall is idempotent and must never capture our wrapper.
    if _ORIGINAL_HEALTH is None and base_module.health is not health:
        _ORIGINAL_HEALTH = base_module.health
    # Explicit transition bridge: keep proven bot handlers, replace only semantic/runtime layers.
    base_module.MAX_PHOTO_BYTES = MAX_MEDIA_BYTES
    base_module.build_rich_message = build_rich_message
    base_module.publish_page = publish_page
    base_module.publish_page_async = publish_page_async
    base_module.api_publish = api_publish
    base_module.api_media = api_media
    base_module.serve_index = serve_index
    base_module.health = health
