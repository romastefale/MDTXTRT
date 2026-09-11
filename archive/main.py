"""Servidor aiohttp e Bot Telegram. Comandos: /start /help /tgrich /mdrich."""

import asyncio
import hashlib
import hmac
import html
import io
import json
import logging
import os
import re
import secrets
import time
from typing import Optional
from urllib.parse import parse_qsl, unquote

from aiohttp import web
from aiogram import Bot, Dispatcher, F
from aiogram.enums import ChatType, ParseMode
from aiogram.exceptions import (
    TelegramAPIError,
    TelegramNetworkError,
    TelegramRetryAfter,
    TelegramServerError,
)
from aiogram.filters import Command, CommandObject
from aiogram.types import (
    BotCommand,
    BufferedInputFile,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InputMediaPhoto,
    InputRichMessage,
    InputRichMessageMedia,
    MenuButtonWebApp,
    Message,
    ReplyParameters,
    WebAppInfo,
)
from aiogram.utils.web_app import safe_parse_webapp_init_data
from telegraph import Telegraph
from telegraph.exceptions import TelegraphException

TOKEN_RE = re.compile(r"bot\d+:[A-Za-z0-9_-]+")
SECRET_RE = re.compile(
    r"(TELEGRAM_TOKEN|BOT_TOKEN|access_token)=([^\s]+)"
)
MD_EXTS = {".md", ".markdown", ".mdown", ".txt"}
MD_MIMES = {"text/markdown", "text/x-markdown", "text/plain"}
MAX_DOC_BYTES = 1_048_576
MAX_PHOTO_BYTES = 10_485_760
PHOTO_MIMES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}
PHOTO_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MDV2_ESC = re.compile(r"\\([_*\[\]()~`>#+\-=|{}.!\\])")


def _scrub(text: str) -> str:
    text = TOKEN_RE.sub("bot***", text)
    return SECRET_RE.sub(r"\1=***", text)


class RedactSecrets(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = _scrub(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    k: _scrub(v) if isinstance(v, str) else v
                    for k, v in record.args.items()
                }
            else:
                record.args = tuple(
                    _scrub(a) if isinstance(a, str) else a for a in record.args
                )
        return True


_secret_filter = RedactSecrets()
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
for _handler in logging.getLogger().handlers:
    _handler.addFilter(_secret_filter)
logging.getLogger().addFilter(_secret_filter)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger("mdtxtrt")
log.addFilter(_secret_filter)


def _clean_token(raw: str) -> str:
    token = (raw or "").strip().strip('"').strip("'")
    if token.startswith("bot") and len(token) > 3 and token[3].isdigit():
        token = token[3:]
    return token


TOKEN = _clean_token(os.environ.get("TELEGRAM_TOKEN", ""))
WEB_APP_URL = os.environ.get("WEB_APP_URL", "").strip()
PORT = int(os.environ.get("PORT", "8080"))
INDEX_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
INIT_MAX_AGE = 48 * 3600
STASH: dict[str, dict] = {}
MEDIA: dict[str, dict] = {}
STASH_TTL = 10 * 60
CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"
POLLING_OPTIONS = {
    "polling_timeout": 10,
    "handle_as_tasks": False,
    "allowed_updates": None,
    "handle_signals": False,
    "close_bot_session": False,
}


def _hmac_hex(data_check_string: str) -> str:
    secret_key = hmac.new(b"WebAppData", TOKEN.encode("utf-8"), hashlib.sha256).digest()
    return hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def _checked_fields(pairs) -> Optional[dict]:
    fields: dict[str, str] = {}
    received_hash = ""
    for key, value in pairs:
        if key == "hash":
            received_hash = value
        elif key == "signature":
            continue
        else:
            fields[key] = value
    if not received_hash or not TOKEN:
        return None
    data_check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    if not hmac.compare_digest(_hmac_hex(data_check_string), received_hash):
        return None
    return fields


def _user_from_fields(fields: dict) -> Optional[dict]:
    raw = fields.get("user") or ""
    for candidate in (raw, unquote(raw)):
        if not candidate:
            continue
        try:
            obj = json.loads(candidate)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(obj, dict) and obj.get("id"):
            return obj
    return None


def validate_init_data(init_data: str) -> Optional[dict]:
    if not TOKEN:
        log.warning("sessão Telegram: TOKEN ausente")
        return None
    raw = (init_data or "").strip()
    if not raw:
        return None
    try:
        parsed = safe_parse_webapp_init_data(token=TOKEN, init_data=raw)
    except ValueError:
        log.warning("sessão Telegram: assinatura inválida")
        return None
    except Exception:
        log.exception("validate_init_data")
        return None
    user = parsed.user
    if not user:
        log.warning("sessão Telegram: utilizador ausente")
        return None
    auth_date = parsed.auth_date
    if auth_date and abs(time.time() - auth_date.timestamp()) > INIT_MAX_AGE:
        log.warning("sessão Telegram: expirada")
        return None
    return user.model_dump()


def init_data_from_request(data: dict, request: web.Request) -> str:
    raw = data.get("init_data") or data.get("initData") or ""
    if isinstance(raw, dict):
        raw = ""
    raw = str(raw or "").strip()
    if raw:
        return raw
    header = (request.headers.get("X-Telegram-Init-Data") or "").strip()
    if header:
        return header
    auth = request.headers.get("Authorization") or ""
    if auth.lower().startswith("tma "):
        return auth[4:].strip()
    return ""


def session_error(raw: str):
    if not raw:
        return web.json_response(
            {
                "ok": False,
                "error": "Abre o Mini App pelo botão no Telegram para enviar e publicar.",
            },
            status=401,
        )
    return web.json_response(
        {
            "ok": False,
            "error": "Sessão do Telegram inválida. Fecha e abre o Mini App pelo bot.",
        },
        status=401,
    )


def public_web_app_url(request: Optional[web.Request] = None) -> str:
    if WEB_APP_URL:
        return WEB_APP_URL.rstrip("/")
    domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if domain:
        return f"https://{domain}"
    if request:
        return str(request.url.origin())
    return ""


from convert import (
    entities_to_markdown,
    extract_rich_media,
    filename_from_markdown,
    is_markdown_document,
    markdown_for_rich_api,
    markdown_to_telegraph_html,
    optimize_markdown,
    rich_message_to_markdown,
    split_markdown_chunks,
)


def build_rich_message(content: str) -> InputRichMessage:
    md = markdown_for_rich_api(content)
    md, local_ids = extract_rich_media(md)
    media: list[InputRichMessageMedia] = []
    now = time.time()
    for mid in local_ids:
        item = MEDIA.get(mid)
        if not item or item.get("exp", 0) < now:
            continue
        media.append(
            InputRichMessageMedia(
                id=mid,
                media=InputMediaPhoto(
                    media=BufferedInputFile(
                        item["data"],
                        filename=media_filename(item, mid),
                    )
                ),
            )
        )
    return InputRichMessage(markdown=md, media=media or None)


def media_filename(item: dict, media_id: str) -> str:
    name = item.get("name") or media_id
    stem, suffix = os.path.splitext(name)
    expected = PHOTO_EXTENSIONS.get(item.get("mime") or "", ".jpg")
    if suffix.lower() == expected:
        return name
    return f"{stem or media_id}{expected}"


async def send_rich_message(
    bot: Bot,
    chat_id,
    content: str,
    reply_to_message_id=None,
    *,
    message_thread_id=None,
    direct_messages_topic_id=None,
    business_connection_id=None,
    ephemeral_message_parameters=None,
):
    rich = build_rich_message(content)
    chunks = split_markdown_chunks(rich.markdown or "")
    media = rich.media or []
    for idx, chunk in enumerate(chunks):
        reply = None
        if idx == 0 and reply_to_message_id:
            reply = ReplyParameters(message_id=reply_to_message_id)
        await bot.send_rich_message(
            chat_id=chat_id,
            rich_message=InputRichMessage(
                markdown=chunk,
                media=media if idx == 0 and media else None,
            ),
            reply_parameters=reply,
            message_thread_id=message_thread_id,
            direct_messages_topic_id=direct_messages_topic_id,
            business_connection_id=business_connection_id,
            ephemeral_message_parameters=ephemeral_message_parameters,
            request_timeout=60,
        )


def message_rich_payload(message):
    if message is None:
        return None
    return message.rich_message


def publish_page(title: str, content_md: str, path_hint: str = "") -> dict:
    title = (title or "Sem título").strip()[:256]
    hint = (path_hint or "").strip()
    api_title = hint[:256] if hint else title
    body = markdown_to_telegraph_html(content_md)
    if hint and hint != title:
        body = f"<p><strong>{html.escape(title)}</strong></p>" + body
    # Cada publicação usa uma conta anônima nova. O cliente e o token ficam
    # restritos a esta chamada e são descartados assim que a página é criada.
    telegraph = Telegraph()
    telegraph.create_account(short_name="MDTXTRT")
    page = telegraph.create_page(title=api_title, html_content=body)
    return {"url": page.get("url"), "path": page.get("path"), "title": api_title}


async def publish_page_async(title: str, content_md: str, path_hint: str = "") -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, publish_page, title, content_md, path_hint)


async def read_document_text(bot, document) -> str:
    size = getattr(document, "file_size", None) or 0
    if size > MAX_DOC_BYTES:
        raise ValueError("Arquivo acima de 1 MB.")
    buf = io.BytesIO()
    await bot.download(document, destination=buf, timeout=30)
    raw = buf.getvalue()
    if len(raw) > MAX_DOC_BYTES:
        raise ValueError("Arquivo acima de 1 MB.")
    if b"\x00" in raw[:2048]:
        raise ValueError("Arquivo binário. Envie .md, .markdown ou .txt.")
    return raw.decode("utf-8", errors="replace")


def _message_context(message: Message) -> dict:
    direct_topic = message.direct_messages_topic
    return {
        "business_connection_id": message.business_connection_id,
        "message_thread_id": message.message_thread_id,
        "direct_messages_topic_id": direct_topic.topic_id if direct_topic else None,
        "ephemeral_message_parameters": message.as_ephemeral_message_parameters(),
    }


def _default_reply_parameters(message: Message) -> Optional[ReplyParameters]:
    # python-telegram-bot replied by default in group chats, but not in private chats.
    if message.chat.type == ChatType.PRIVATE:
        return None
    return ReplyParameters(message_id=message.message_id)


async def reply_text(message: Message, bot: Bot, text: str, **kwargs):
    await bot.send_message(
        chat_id=message.chat.id,
        text=text,
        reply_parameters=_default_reply_parameters(message),
        **_message_context(message),
        **kwargs,
    )


async def reply_document(message: Message, bot: Bot, data: bytes, filename: str):
    await bot.send_document(
        chat_id=message.chat.id,
        document=BufferedInputFile(data, filename=filename),
        caption=filename,
        reply_parameters=_default_reply_parameters(message),
        **_message_context(message),
    )


def telegram_error_text(exc: TelegramAPIError) -> str:
    if isinstance(exc, TelegramRetryAfter):
        return f"Telegram pediu para aguardar {exc.retry_after} segundos."
    if isinstance(exc, TelegramNetworkError):
        return "Falha de rede ao contactar Telegram. Tenta novamente."
    return f"Telegram recusou sendRichMessage: {exc.message}"


async def dispatch_user_artifacts(bot, chat_id: int | str, title: str, content: str):
    body = content
    if title and title != "Sem título":
        body = f"**{title}**\n\n{content}"
    await send_rich_message(bot, chat_id, body)


def purge_stash() -> None:
    now = time.time()
    for key in [k for k, item in STASH.items() if item.get("exp", 0) < now]:
        STASH.pop(key, None)
    for key in [k for k, item in MEDIA.items() if item.get("exp", 0) < now]:
        MEDIA.pop(key, None)
    while len(STASH) > 200:
        oldest = min(STASH, key=lambda k: STASH[k].get("exp", 0))
        STASH.pop(oldest, None)
    while len(MEDIA) > 80:
        oldest = min(MEDIA, key=lambda k: MEDIA[k].get("exp", 0))
        MEDIA.pop(oldest, None)


def new_stash_code() -> str:
    purge_stash()
    for _ in range(12):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(10))
        if code not in STASH:
            return code
    return secrets.token_hex(5)


async def deliver_payload(bot, chat_id, action: str, title: str, content: str) -> None:
    if action == "mdrich":
        md_text = optimize_markdown(content)
        name = filename_from_markdown(md_text)
        if title and title != "Sem título":
            safe = re.sub(r'[\\/*?:"<>|]', "", title).strip()[:60]
            if safe:
                name = safe
        filename = f"{name}.md"
        await bot.send_document(
            chat_id=chat_id,
            document=BufferedInputFile(md_text.encode("utf-8"), filename=filename),
            caption=filename,
        )
        return
    await dispatch_user_artifacts(bot, chat_id, title, content)


def mini_app_markup():
    app_url = public_web_app_url()
    if not app_url:
        return None
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Abrir Mini App",
                    web_app=WebAppInfo(url=app_url),
                )
            ]
        ]
    )


async def start(message: Message, bot: Bot, command: CommandObject):
    arg = ((command.args or "").split()[0] if command.args else "").strip()
    if arg:
        kind = arg[0]
        code = arg[1:]
        item = STASH.pop(code, None)
        if item and item.get("exp", 0) >= time.time():
            action = "mdrich" if kind == "m" or item.get("action") == "mdrich" else "chat"
            try:
                await deliver_payload(
                    bot,
                    message.chat.id,
                    action,
                    item.get("title") or "Sem título",
                    item.get("content") or "",
                )
            except TelegramAPIError as exc:
                await reply_text(message, bot, telegram_error_text(exc))
            except ValueError as exc:
                await reply_text(
                    message,
                    bot,
                    str(exc),
                    reply_markup=mini_app_markup(),
                )
            return
        await reply_text(
            message,
            bot,
            "Este envio já foi usado ou expirou. Abre o Mini App e toca outra vez.",
            reply_markup=mini_app_markup(),
        )
        return
    text = (
        "<b>MDTXTRT</b>\n\n"
        "Converte Markdown em rich text do Telegram e exporta mensagens em .md.\n\n"
        "• Mini App — redigir, pré-visualizar, enviar ao chat e publicar no Telegraph\n"
        "• Arquivo .md anexado ou encaminhado — vira mensagem formatada (tgrich)\n"
        "• /tgrich — a mesma conversão, respondendo a um arquivo compatível\n"
        "• /mdrich — responde a uma mensagem e exporta .md otimizado\n"
        "• /help — comandos e a diferença entre chat e Mini App"
    )
    await reply_text(
        message,
        bot,
        text, reply_markup=mini_app_markup(), parse_mode=ParseMode.HTML
    )


HELP_TEXT = (
    "<b>MDTXTRT</b> — Markdown e Telegram\n\n"
    "<b>Comandos</b>\n"
    "/start — abre o Mini App e resume as funções\n"
    "/help — este texto\n"
    "/tgrich — Markdown para rich text do Telegram\n"
    "    responda a um .md (anexo ou encaminhado)\n"
    "    ou envie /tgrich seguido do texto\n"
    "    arquivos .md anexados já disparam isto sozinhos\n"
    "/mdrich — responda a uma mensagem para exportar .md compatível e otimizado\n\n"
    "<b>Chat vs Mini App</b>\n"
    "Mini App (botão de /start ou menu): redigir, pré-visualizar, formatar, "
    "enviar ao chat e publicar no Telegraph. Use quando for escrever.\n\n"
    "Comandos no chat: use quando o texto já está no Telegram — um arquivo, "
    "um encaminhamento ou uma mensagem para converter ou exportar.\n\n"
    "Formatos: .md .markdown .txt"
)


async def help_cmd(message: Message, bot: Bot):
    await reply_text(
        message,
        bot,
        HELP_TEXT, reply_markup=mini_app_markup(), parse_mode=ParseMode.HTML
    )


def _command_arg_text(message) -> str:
    text = (message.text or message.caption or "").strip()
    if not text:
        return ""
    parts = text.split(None, 1)
    if parts and parts[0].startswith("/"):
        return parts[1] if len(parts) > 1 else ""
    return text


async def source_for_tgrich(message, bot: Bot) -> str:
    if is_markdown_document(message.document):
        return await read_document_text(bot, message.document)
    target = message.reply_to_message
    if target:
        if is_markdown_document(target.document):
            return await read_document_text(bot, target.document)
        rm = message_rich_payload(target)
        if rm:
            md = rich_message_to_markdown(rm)
            if str(md).strip():
                return md
        raw = target.text or target.caption
        if raw:
            return raw
        if target.document:
            return await read_document_text(bot, target.document)
    arg = _command_arg_text(message)
    if arg:
        return arg
    raise ValueError(
        "Responda a um arquivo .md compatível, anexe um .md, ou envie /tgrich seguido do texto."
    )


async def source_for_mdrich(message, bot: Bot) -> str:
    target = message.reply_to_message
    if not target:
        if is_markdown_document(message.document):
            return optimize_markdown(await read_document_text(bot, message.document))
        raise ValueError("Responda a uma mensagem com /mdrich.")
    rm = message_rich_payload(target)
    if rm:
        md = rich_message_to_markdown(rm)
        if str(md).strip():
            return optimize_markdown(md)
    if target.document:
        text = await read_document_text(bot, target.document)
        if is_markdown_document(target.document):
            return optimize_markdown(text)
        caption = target.caption or ""
        if caption:
            cap_md = entities_to_markdown(caption, target.caption_entities or [])
            return optimize_markdown(cap_md + "\n\n" + text)
        return optimize_markdown(text)
    raw = target.text or target.caption or ""
    ents = target.entities or target.caption_entities or []
    if not raw:
        raise ValueError("A mensagem alvo não possui texto exportável.")
    return optimize_markdown(entities_to_markdown(raw, ents))


async def tgrich(message: Message, bot: Bot):
    try:
        source = await source_for_tgrich(message, bot)
        if not source.strip():
            await reply_text(message, bot, "Documento vazio.")
            return
        await send_rich_message(
            bot,
            message.chat.id,
            source,
            reply_to_message_id=message.message_id,
            **_message_context(message),
        )
    except TelegramAPIError as exc:
        await reply_text(message, bot, telegram_error_text(exc))
    except ValueError as exc:
        await reply_text(message, bot, str(exc))
    except Exception:
        log.exception("tgrich")
        await reply_text(message, bot, "Não foi possível converter o arquivo.")


async def mdrich(message: Message, bot: Bot):
    try:
        md_text = await source_for_mdrich(message, bot)
        if not md_text.strip():
            await reply_text(message, bot, "Nada para exportar.")
            return
        name = filename_from_markdown(md_text)
        await reply_document(message, bot, md_text.encode("utf-8"), f"{name}.md")
    except ValueError as exc:
        await reply_text(message, bot, str(exc))
    except Exception:
        log.exception("mdrich")
        await reply_text(message, bot, "Não foi possível exportar o .md.")


def _caption_command(message) -> str:
    caption = (message.caption or "").strip()
    if not caption.startswith("/"):
        return ""
    return caption.split()[0].split("@")[0].lower()


async def handle_document(message: Message, bot: Bot):
    if not message.document:
        return
    cmd = _caption_command(message)
    if cmd in {"/start", "/help"}:
        return
    if cmd == "/mdrich":
        await mdrich(message, bot)
        return
    if cmd == "/tgrich" or is_markdown_document(message.document):
        await tgrich(message, bot)


def _payload_from_webapp(raw: str) -> dict:
    data = json.loads(raw)
    if not isinstance(data, dict):
        return {"action": "markdown", "content": str(data), "title": "Sem título"}
    action = data.get("action") or data.get("type") or "markdown"
    return {
        "action": action,
        "title": data.get("title") or "Sem título",
        "path": data.get("path") or "",
        "content": data.get("content") or "",
    }


async def handle_webapp_data(message: Message, bot: Bot):
    try:
        payload = _payload_from_webapp(message.web_app_data.data)
        content = payload["content"]
        if not str(content).strip():
            await reply_text(message, bot, "Documento vazio.")
            return
        if payload["action"] in {"publish_telegraph", "telegraph"}:
            page = await publish_page_async(payload["title"], content, payload["path"])
            await reply_text(message, bot, f"Publicado: {page['url']}")
            return
        await deliver_payload(
            bot,
            message.chat.id,
            "mdrich" if payload["action"] == "mdrich" else "chat",
            payload["title"],
            content,
        )
    except TelegramAPIError as exc:
        await reply_text(message, bot, telegram_error_text(exc))
    except TelegraphException as exc:
        await reply_text(message, bot, f"Telegraph recusou o HTML: {exc}")
    except Exception as exc:
        log.exception("web_app_data")
        await reply_text(message, bot, f"Erro no processamento: {exc}")


async def serve_index(_request: web.Request):
    try:
        with open(INDEX_PATH, "r", encoding="utf-8") as fh:
            return web.Response(text=fh.read(), content_type="text/html", charset="utf-8")
    except FileNotFoundError:
        return web.Response(text="index.html ausente", status=404, content_type="text/plain")


async def health(_request: web.Request):
    return web.json_response(
        {
            "ok": True,
            "app": "mdtxtrt",
            "bot": bool(TOKEN),
            "web_app_url": public_web_app_url() or None,
            "telegraph_mode": "anonymous_per_publication",
        }
    )


async def api_send_chat(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    content = (data.get("content") or "").strip()
    if not content:
        return web.json_response({"ok": False, "error": "Documento vazio"}, status=400)
    raw = init_data_from_request(data, request)
    user = validate_init_data(raw)
    if not user or not user.get("id"):
        return session_error(raw)
    bot_app = request.app.get("bot")
    if not bot_app:
        return web.json_response({"ok": False, "error": "Bot não inicializado."}, status=503)
    try:
        await dispatch_user_artifacts(
            bot=bot_app.bot,
            chat_id=user["id"],
            title=data.get("title") or "Sem título",
            content=content,
        )
        return web.json_response({"ok": True})
    except TelegramAPIError as exc:
        detail = telegram_error_text(exc)
        log.error("api_send_chat recusou: %s", detail)
        return web.json_response(
            {"ok": False, "error": detail},
            status=502,
        )
    except Exception as exc:
        log.exception("api_send_chat")
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


async def api_publish(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    raw = init_data_from_request(data, request)
    user = validate_init_data(raw)
    if not user or not user.get("id"):
        return session_error(raw)
    content = (data.get("content") or "").strip()
    if not content:
        return web.json_response({"ok": False, "error": "Documento vazio"}, status=400)
    try:
        page = await publish_page_async(
            data.get("title") or "Sem título", content, data.get("path") or ""
        )
        return web.json_response({"ok": True, **page})
    except TelegraphException as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=502)
    except Exception as exc:
        log.exception("api_publish")
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


async def api_config(request: web.Request):
    username = request.app.get("bot_username") or ""
    return web.json_response(
        {
            "ok": True,
            "bot": username,
            "web_app_url": public_web_app_url() or None,
        }
    )


async def api_stash(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    content = (data.get("content") or "").strip()
    if not content:
        return web.json_response({"ok": False, "error": "Documento vazio"}, status=400)
    if len(content.encode("utf-8")) > MAX_DOC_BYTES:
        return web.json_response({"ok": False, "error": "Documento acima de 1 MB"}, status=413)
    action = (data.get("action") or "chat").strip().lower()
    if action not in {"chat", "mdrich", "tgrich", "markdown"}:
        action = "chat"
    if action in {"tgrich", "markdown"}:
        action = "chat"
    username = request.app.get("bot_username") or ""
    if not username:
        return web.json_response(
            {"ok": False, "error": "Bot ainda a arrancar. Toca outra vez dentro de instantes."},
            status=503,
        )
    code = new_stash_code()
    STASH[code] = {
        "action": action,
        "title": (data.get("title") or "Sem título").strip() or "Sem título",
        "content": content,
        "exp": time.time() + STASH_TTL,
    }
    prefix = "m" if action == "mdrich" else "c"
    start_param = f"{prefix}{code}"
    url = f"https://t.me/{username}?start={start_param}"
    return web.json_response(
        {"ok": True, "start": start_param, "url": url, "bot": username}
    )


async def api_media(request: web.Request):
    purge_stash()
    try:
        post = await request.post()
    except Exception:
        return web.json_response({"ok": False, "error": "Envio inválido"}, status=400)
    upload = post.get("file")
    if upload is None or not hasattr(upload, "file"):
        return web.json_response({"ok": False, "error": "Falta a fotografia"}, status=400)
    raw = upload.file.read()
    if not raw:
        return web.json_response({"ok": False, "error": "Ficheiro vazio"}, status=400)
    if len(raw) > MAX_PHOTO_BYTES:
        return web.json_response({"ok": False, "error": "Foto acima de 10 MB"}, status=413)
    mime = (getattr(upload, "content_type", None) or "").lower()
    name = (getattr(upload, "filename", None) or "foto.jpg").lower()
    if mime not in PHOTO_MIMES and not name.endswith(
        (".jpg", ".jpeg", ".png", ".webp", ".gif")
    ):
        return web.json_response(
            {"ok": False, "error": "Use JPEG, PNG, WebP ou GIF"},
            status=415,
        )
    if mime not in PHOTO_MIMES:
        mime = "image/jpeg"
    mid = new_stash_code()
    filename = getattr(upload, "filename", None) or f"{mid}.jpg"
    MEDIA[mid] = {
        "data": raw,
        "name": filename,
        "mime": mime,
        "exp": time.time() + STASH_TTL,
    }
    return web.json_response({"ok": True, "id": mid})


async def serve_media(request: web.Request):
    purge_stash()
    mid = (request.match_info.get("mid") or "").strip()
    item = MEDIA.get(mid)
    if not item or item.get("exp", 0) < time.time():
        return web.Response(text="Foto expirada", status=404)
    return web.Response(
        body=item["data"],
        content_type=item.get("mime") or "image/jpeg",
        headers={"Cache-Control": "private, max-age=60"},
    )


class BotRuntime:
    def __init__(self, bot: Bot, dispatcher: Dispatcher, polling_task: asyncio.Task):
        self.bot = bot
        self.dispatcher = dispatcher
        self.polling_task = polling_task


async def delete_webhook_with_retry(bot: Bot, sleep=asyncio.sleep) -> None:
    delay = 1.0
    while True:
        try:
            await bot.delete_webhook(drop_pending_updates=False, request_timeout=60)
            return
        except TelegramRetryAfter as exc:
            delay = max(float(exc.retry_after), 1.0)
            log.warning(
                "Telegram limitou o bootstrap; nova tentativa em %.1fs", delay
            )
            await sleep(delay)
        except (TelegramNetworkError, TelegramServerError) as exc:
            log.warning(
                "Falha transitória ao preparar polling; nova tentativa em %.1fs: %s",
                delay,
                exc,
            )
            await sleep(delay)
            delay = min(delay * 1.5, 30.0)


def _polling_finished(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        log.error(
            "Polling terminou inesperadamente",
            exc_info=(type(exc), exc, exc.__traceback__),
        )


def build_dispatcher() -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.message.register(start, Command("start"))
    dispatcher.message.register(help_cmd, Command("help"))
    dispatcher.message.register(tgrich, Command("tgrich"))
    dispatcher.message.register(mdrich, Command("mdrich"))
    dispatcher.message.register(handle_webapp_data, F.web_app_data)
    dispatcher.message.register(handle_document, F.document)
    return dispatcher


def bot_commands() -> list[BotCommand]:
    return [
        BotCommand(
            command="start",
            description="Abre o Mini App e resume as funções",
        ),
        BotCommand(
            command="help",
            description="Comandos e chat vs Mini App",
        ),
        BotCommand(
            command="tgrich",
            description="Markdown para rich text do Telegram",
        ),
        BotCommand(
            command="mdrich",
            description="Exporta a mensagem respondida em .md",
        ),
    ]


async def on_startup(app: web.Application):
    app["bot_username"] = ""
    if not TOKEN:
        log.warning("TELEGRAM_TOKEN ausente. Mini App no ar; bot desligado.")
        return
    bot = Bot(TOKEN)
    dispatcher = build_dispatcher()
    try:
        me = await bot.get_me(request_timeout=60)
    except Exception:
        await bot.session.close()
        raise
    app["bot_username"] = me.username or ""
    try:
        await bot.set_my_commands(bot_commands())
        app_url = public_web_app_url()
        if app_url:
            await bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="Editor", web_app=WebAppInfo(url=app_url)
                )
            )
    except Exception:
        log.exception("set_my_commands")
    await delete_webhook_with_retry(bot)

    polling_started = asyncio.Event()

    async def mark_polling_started(**_kwargs):
        polling_started.set()

    dispatcher.startup.register(mark_polling_started)
    polling_task = asyncio.create_task(
        dispatcher.start_polling(
            bot,
            **POLLING_OPTIONS,
        ),
        name="telegram-polling",
    )
    polling_task.add_done_callback(_polling_finished)
    await polling_started.wait()
    app["bot"] = BotRuntime(bot, dispatcher, polling_task)
    log.info("Bot em escuta @%s", app["bot_username"])


async def on_cleanup(app: web.Application):
    runtime = app.get("bot")
    if not runtime:
        return
    try:
        if not runtime.polling_task.done():
            await runtime.dispatcher.stop_polling()
        await runtime.polling_task
    finally:
        await runtime.bot.session.close()


def build_web_app() -> web.Application:
    app = web.Application(client_max_size=MAX_PHOTO_BYTES + 131072)
    app.router.add_get("/", serve_index)
    app.router.add_get("/health", health)
    app.router.add_get("/api/config", api_config)
    app.router.add_get("/media/{mid}", serve_media)
    app.router.add_post("/api/stash", api_stash)
    app.router.add_post("/api/media", api_media)
    app.router.add_post("/api/publish", api_publish)
    app.router.add_post("/api/send-chat", api_send_chat)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=PORT)
