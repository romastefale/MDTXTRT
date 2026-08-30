"""Servidor aiohttp e Bot Telegram. Comandos: /start /helo /tgrich /mdrich."""

import asyncio
import hashlib
import hmac
import html
import io
import json
import logging
import os
import re
from typing import Optional

from aiohttp import web
from telegram import (
    BotCommand,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LinkPreviewOptions,
    MenuButtonWebApp,
    Update,
    WebAppInfo,
)
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)
from telegraph import Telegraph
from telegraph.exceptions import TelegraphException

TOKEN_RE = re.compile(r"bot\d+:[A-Za-z0-9_-]+")
SECRET_RE = re.compile(
    r"(TELEGRAM_TOKEN|BOT_TOKEN|TELEGRAPH_ACCESS_TOKEN|access_token)=([^\s]+)"
)
MD_EXTS = {".md", ".markdown", ".mdown", ".txt"}
MD_MIMES = {"text/markdown", "text/x-markdown", "text/plain"}
MAX_DOC_BYTES = 1_048_576
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
logging.getLogger("telegram.ext._updater").setLevel(logging.WARNING)
log = logging.getLogger("mdtxtrt")
log.addFilter(_secret_filter)

TOKEN = os.environ.get("TELEGRAM_TOKEN", "").strip()
WEB_APP_URL = os.environ.get("WEB_APP_URL", "https://mdmtrt.up.railway.app").strip()
PORT = int(os.environ.get("PORT", "8080"))
TELEGRAPH_TOKEN = os.environ.get("TELEGRAPH_ACCESS_TOKEN", "").strip()
AUTHOR_NAME = os.environ.get("TELEGRAPH_AUTHOR", "MDTXTRT")
INDEX_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
_telegraph: Optional[Telegraph] = None


def validate_init_data(init_data: str) -> Optional[dict]:
    if not init_data or not TOKEN:
        return None
    try:
        pairs = sorted(
            piece.split("=", 1) for piece in init_data.split("&") if "=" in piece
        )
        received_hash = ""
        data_check_pairs = []
        for key, value in pairs:
            if key == "hash":
                received_hash = value
            else:
                data_check_pairs.append(f"{key}={value}")
        if not received_hash:
            return None
        data_check_string = "\n".join(data_check_pairs)
        secret_key = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
        calc_hash = hmac.new(
            secret_key, data_check_string.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(calc_hash, received_hash):
            return None
        for key, value in pairs:
            if key == "user":
                return json.loads(value)
    except Exception:
        log.exception("validate_init_data")
    return None


def public_web_app_url(request: Optional[web.Request] = None) -> str:
    if WEB_APP_URL:
        return WEB_APP_URL.rstrip("/")
    domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if domain:
        return f"https://{domain}"
    if request:
        return str(request.url.origin())
    return ""


def get_telegraph() -> Telegraph:
    global _telegraph
    if _telegraph is None:
        client = Telegraph(access_token=TELEGRAPH_TOKEN or None)
        if not TELEGRAPH_TOKEN:
            acc = client.create_account(short_name="MDTXTRT", author_name=AUTHOR_NAME)
            token = acc.get("access_token", "")
            if token:
                client = Telegraph(access_token=token)
            log.warning(
                "Conta Telegraph criada em runtime. Configure TELEGRAPH_ACCESS_TOKEN."
            )
        _telegraph = client
    return _telegraph



from convert import (
    entities_to_markdown,
    filename_from_markdown,
    is_markdown_document,
    markdown_to_telegram_html,
    markdown_to_telegraph_html,
    optimize_markdown,
    split_html_chunks,
)


def _escape_markdown_v2(text: str) -> str:
    return re.sub(r"([_*\[\]()~`>#+\-=|{}.!\\])", r"\\\1", text)


def publish_page(title: str, content_md: str, path_hint: str = "") -> dict:
    title = (title or "Sem título").strip()[:256]
    hint = (path_hint or "").strip()
    api_title = hint[:256] if hint else title
    body = markdown_to_telegraph_html(content_md)
    if hint and hint != title:
        body = f"<p><strong>{html.escape(title)}</strong></p>" + body
    page = get_telegraph().create_page(
        title=api_title, html_content=body, author_name=AUTHOR_NAME
    )
    return {"url": page.get("url"), "path": page.get("path"), "title": api_title}


async def publish_page_async(title: str, content_md: str, path_hint: str = "") -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, publish_page, title, content_md, path_hint)


async def read_document_text(bot, document) -> str:
    size = getattr(document, "file_size", None) or 0
    if size > MAX_DOC_BYTES:
        raise ValueError("Arquivo acima de 1 MB.")
    file = await bot.get_file(document.file_id)
    buf = io.BytesIO()
    await file.download_to_memory(buf)
    raw = buf.getvalue()
    if len(raw) > MAX_DOC_BYTES:
        raise ValueError("Arquivo acima de 1 MB.")
    if b"\x00" in raw[:2048]:
        raise ValueError("Arquivo binário. Envie .md, .markdown ou .txt.")
    return raw.decode("utf-8", errors="replace")


async def send_tgrich_message(bot, chat_id, content: str, reply_to_message_id=None):
    tg_html, images = markdown_to_telegram_html(content)
    preview_opts = (
        LinkPreviewOptions(is_disabled=False, url=images[0], prefer_large_media=True)
        if images
        else None
    )
    for idx, chunk in enumerate(split_html_chunks(tg_html)):
        kwargs = {
            "chat_id": chat_id,
            "text": chunk,
            "parse_mode": ParseMode.HTML,
            "link_preview_options": preview_opts if idx == 0 else None,
        }
        if idx == 0 and reply_to_message_id:
            kwargs["reply_to_message_id"] = reply_to_message_id
        try:
            await bot.send_message(**kwargs)
        except Exception:
            try:
                await bot.send_message(
                    chat_id=chat_id,
                    text=_escape_markdown_v2(content if idx == 0 else chunk),
                    parse_mode=ParseMode.MARKDOWN_V2,
                )
            except Exception:
                await bot.send_message(
                    chat_id=chat_id, text=content if idx == 0 else chunk
                )


async def dispatch_user_artifacts(bot, chat_id: int | str, title: str, content: str):
    safe_title = re.sub(r'[\\/*?:"<>|]', "", title).strip() if title else ""
    filename_base = (
        safe_title if safe_title and safe_title != "Sem título" else "documento"
    )
    header_html = (
        f"<b>{html.escape(title)}</b>\n\n" if title and title != "Sem título" else ""
    )
    header_plain = f"{title}\n\n" if title and title != "Sem título" else ""
    tg_html, images = markdown_to_telegram_html(content)
    full_tg_html = header_html + tg_html
    plain_text = header_plain + content
    preview_opts = (
        LinkPreviewOptions(is_disabled=False, url=images[0], prefer_large_media=True)
        if images
        else None
    )
    if len(full_tg_html) <= 4096:
        try:
            await bot.send_message(
                chat_id=chat_id,
                text=full_tg_html,
                parse_mode=ParseMode.HTML,
                link_preview_options=preview_opts,
            )
        except Exception:
            try:
                await bot.send_message(
                    chat_id=chat_id,
                    text=_escape_markdown_v2(plain_text),
                    parse_mode=ParseMode.MARKDOWN_V2,
                )
            except Exception:
                await bot.send_message(chat_id=chat_id, text=plain_text)
    else:
        for chunk in split_html_chunks(plain_text, 4000):
            await bot.send_message(chat_id=chat_id, text=chunk)
    buf_md = io.BytesIO(optimize_markdown(plain_text).encode("utf-8"))
    buf_md.name = f"{filename_base}.md"
    await bot.send_document(chat_id=chat_id, document=buf_md, caption=f"{filename_base}.md")


def mini_app_markup():
    app_url = public_web_app_url()
    if not app_url:
        return None
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("Abrir Mini App", web_app=WebAppInfo(url=app_url))]]
    )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message:
        return
    text = (
        "<b>MDTXTRT</b>\n\n"
        "Converte Markdown em rich text do Telegram e exporta mensagens em .md.\n\n"
        "• Mini App — redigir, pré-visualizar, enviar ao chat e publicar no Telegraph\n"
        "• Arquivo .md anexado ou encaminhado — vira mensagem formatada (tgrich)\n"
        "• /tgrich — a mesma conversão, respondendo a um arquivo compatível\n"
        "• /mdrich — responde a uma mensagem e exporta .md otimizado\n"
        "• /helo — comandos e a diferença entre chat e Mini App"
    )
    await update.message.reply_text(
        text, reply_markup=mini_app_markup(), parse_mode=ParseMode.HTML
    )


HELO_TEXT = (
    "<b>MDTXTRT</b> — Markdown e Telegram\n\n"
    "<b>Comandos</b>\n"
    "/start — abre o Mini App e resume as funções\n"
    "/helo — este texto\n"
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


async def helo_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message:
        return
    await update.message.reply_text(
        HELO_TEXT, reply_markup=mini_app_markup(), parse_mode=ParseMode.HTML
    )


def _command_arg_text(message) -> str:
    text = (message.text or message.caption or "").strip()
    if not text:
        return ""
    parts = text.split(None, 1)
    if parts and parts[0].startswith("/"):
        return parts[1] if len(parts) > 1 else ""
    return text


async def source_for_tgrich(message, context) -> str:
    if is_markdown_document(message.document):
        return await read_document_text(context.bot, message.document)
    target = message.reply_to_message
    if target:
        if is_markdown_document(target.document):
            return await read_document_text(context.bot, target.document)
        raw = target.text or target.caption
        if raw:
            return raw
        if target.document:
            return await read_document_text(context.bot, target.document)
    arg = _command_arg_text(message)
    if arg:
        return arg
    raise ValueError(
        "Responda a um arquivo .md compatível, anexe um .md, ou envie /tgrich seguido do texto."
    )


async def source_for_mdrich(message, context) -> str:
    target = message.reply_to_message
    if not target:
        if is_markdown_document(message.document):
            return optimize_markdown(await read_document_text(context.bot, message.document))
        raise ValueError("Responda a uma mensagem com /mdrich.")
    if target.document:
        text = await read_document_text(context.bot, target.document)
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


async def tgrich(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.message
    if not message:
        return
    try:
        source = await source_for_tgrich(message, context)
        if not source.strip():
            await message.reply_text("Documento vazio.")
            return
        await send_tgrich_message(
            context.bot, message.chat_id, source, reply_to_message_id=message.message_id
        )
    except ValueError as exc:
        await message.reply_text(str(exc))
    except Exception:
        log.exception("tgrich")
        await message.reply_text("Não foi possível converter o arquivo.")


async def mdrich(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.message
    if not message:
        return
    try:
        md_text = await source_for_mdrich(message, context)
        if not md_text.strip():
            await message.reply_text("Nada para exportar.")
            return
        name = filename_from_markdown(md_text)
        buf = io.BytesIO(md_text.encode("utf-8"))
        buf.name = f"{name}.md"
        await message.reply_document(document=buf, caption=f"{name}.md")
    except ValueError as exc:
        await message.reply_text(str(exc))
    except Exception:
        log.exception("mdrich")
        await message.reply_text("Não foi possível exportar o .md.")


def _caption_command(message) -> str:
    caption = (message.caption or "").strip()
    if not caption.startswith("/"):
        return ""
    return caption.split()[0].split("@")[0].lower()


async def handle_document(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.message
    if not message or not message.document:
        return
    cmd = _caption_command(message)
    if cmd in {"/start", "/helo", "/help"}:
        return
    if cmd == "/mdrich":
        await mdrich(update, context)
        return
    if cmd == "/tgrich" or is_markdown_document(message.document):
        await tgrich(update, context)


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


async def handle_webapp_data(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        payload = _payload_from_webapp(update.message.web_app_data.data)
        content = payload["content"]
        if not str(content).strip():
            await update.message.reply_text("Documento vazio.")
            return
        if payload["action"] in {"publish_telegraph", "telegraph"}:
            page = await publish_page_async(payload["title"], content, payload["path"])
            await update.message.reply_text(f"Publicado: {page['url']}")
            return
        await dispatch_user_artifacts(
            bot=context.bot,
            chat_id=update.effective_chat.id,
            title=payload["title"],
            content=content,
        )
    except TelegraphException as exc:
        await update.message.reply_text(f"Telegraph recusou o HTML: {exc}")
    except Exception as exc:
        log.exception("web_app_data")
        await update.message.reply_text(f"Erro no processamento: {exc}")


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
            "telegraph_token": bool(TELEGRAPH_TOKEN),
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
    user = validate_init_data(data.get("init_data") or "")
    if not user or not user.get("id"):
        return web.json_response(
            {"ok": False, "error": "initData inválido ou ausente."}, status=401
        )
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
    except Exception as exc:
        log.exception("api_send_chat")
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


async def api_publish(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    user = validate_init_data(data.get("init_data") or "")
    if not user or not user.get("id"):
        return web.json_response(
            {"ok": False, "error": "initData inválido ou ausente."}, status=401
        )
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


async def on_startup(app: web.Application):
    if not TOKEN:
        log.warning("TELEGRAM_TOKEN ausente. Mini App no ar; bot desligado.")
        return
    application = Application.builder().token(TOKEN).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("helo", helo_cmd))
    application.add_handler(CommandHandler("help", helo_cmd))
    application.add_handler(CommandHandler("tgrich", tgrich))
    application.add_handler(CommandHandler("mdrich", mdrich))
    application.add_handler(
        MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_webapp_data)
    )
    application.add_handler(MessageHandler(filters.Document.ALL, handle_document))
    await application.initialize()
    await application.start()
    try:
        await application.bot.set_my_commands(
            [
                BotCommand("start", "Abre o Mini App e resume as funções"),
                BotCommand("helo", "Comandos e chat vs Mini App"),
                BotCommand("tgrich", "Markdown para rich text do Telegram"),
                BotCommand("mdrich", "Exporta a mensagem respondida em .md"),
            ]
        )
        app_url = public_web_app_url()
        if app_url:
            await application.bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="Editor", web_app=WebAppInfo(url=app_url)
                )
            )
    except Exception:
        log.exception("set_my_commands")
    await application.updater.start_polling(drop_pending_updates=True)
    app["bot"] = application
    log.info("Bot em escuta (polling).")


async def on_cleanup(app: web.Application):
    application = app.get("bot")
    if not application:
        return
    await application.updater.stop()
    await application.stop()
    await application.shutdown()


def build_web_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", serve_index)
    app.router.add_get("/health", health)
    app.router.add_post("/api/publish", api_publish)
    app.router.add_post("/api/send-chat", api_send_chat)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=PORT)
