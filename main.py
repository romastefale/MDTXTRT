import html
import io
import json
import logging
import os
import re
from typing import Optional

from aiohttp import web
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters
from telegraph import Telegraph
from telegraph.exceptions import TelegraphException

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("mdtxtrt")

TOKEN = os.environ.get("TELEGRAM_TOKEN") or os.environ.get("BOT_TOKEN")
WEB_APP_URL = os.environ.get("WEB_APP_URL", "").strip()
PORT = int(os.environ.get("PORT", "8080"))
TELEGRAPH_TOKEN = os.environ.get("TELEGRAPH_ACCESS_TOKEN", "").strip()
AUTHOR_NAME = os.environ.get("TELEGRAPH_AUTHOR", "MDTXTRT")

INDEX_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")

_telegraph: Optional[Telegraph] = None


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
    if _telegraph is not None:
        return _telegraph
    client = Telegraph(access_token=TELEGRAPH_TOKEN or None)
    if not TELEGRAPH_TOKEN:
        acc = client.create_account(short_name="MDTXTRT", author_name=AUTHOR_NAME)
        log.warning(
            "Conta Telegraph criada nesta execucao. Grave TELEGRAPH_ACCESS_TOKEN=%s",
            acc.get("access_token", ""),
        )
    _telegraph = client
    return client


def markdown_to_telegraph_html(source: str) -> str:
    text = source.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("||", "")
    parts: list[str] = []
    i = 0
    lines = text.split("\n")
    n = len(lines)

    def flush_para(buf: list[str]) -> None:
        if not buf:
            return
        raw = " ".join(s.strip() for s in buf if s.strip())
        if raw:
            parts.append(f"<p>{inline(raw)}</p>")
        buf.clear()

    def inline(s: str) -> str:
        s = html.escape(s)
        s = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r'<img src="\2" alt="\1">', s)
        s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"__(.+?)__", r"<u>\1</u>", s)
        s = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", s)
        s = re.sub(r"_(.+?)_", r"<em>\1</em>", s)
        s = re.sub(r"~~(.+?)~~", r"<s>\1</s>", s)
        return s

    para: list[str] = []
    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_para(para)
            i += 1
            block: list[str] = []
            while i < n and not lines[i].strip().startswith("```"):
                block.append(html.escape(lines[i]))
                i += 1
            i += 1
            code = "\n".join(block)
            parts.append(f"<pre>{code}</pre>")
            continue

        if re.match(r"^---+$", stripped) or re.match(r"^\*\*\*+$", stripped):
            flush_para(para)
            parts.append("<hr>")
            i += 1
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            flush_para(para)
            level = min(len(heading.group(1)) + 2, 4)
            parts.append(f"<h{level}>{inline(heading.group(2))}</h{level}>")
            i += 1
            continue

        if stripped.startswith("> "):
            flush_para(para)
            quote: list[str] = []
            while i < n and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip().lstrip("> ").strip())
                i += 1
            parts.append(f"<blockquote>{inline(' '.join(quote))}</blockquote>")
            continue

        ul_match = re.match(r"^[-*+]\s+(.*)$", stripped)
        ol_match = re.match(r"^\d+\.\s+(.*)$", stripped)
        if ul_match or ol_match:
            flush_para(para)
            ordered = bool(ol_match)
            items: list[str] = []
            while i < n:
                raw = lines[i].strip()
                tm = re.match(r"^[-*+]\s+\[([ xX])\]\s+(.*)$", raw)
                um = re.match(r"^[-*+]\s+(.*)$", raw)
                om = re.match(r"^\d+\.\s+(.*)$", raw)
                if tm:
                    mark = "☑" if tm.group(1).lower() == "x" else "☐"
                    items.append(f"<li>{mark} {inline(tm.group(2))}</li>")
                    ordered = False
                elif um and not ordered:
                    items.append(f"<li>{inline(um.group(1))}</li>")
                elif om and ordered:
                    items.append(f"<li>{inline(om.group(1))}</li>")
                else:
                    break
                i += 1
            tag = "ol" if ordered else "ul"
            parts.append(f"<{tag}>{''.join(items)}</{tag}>")
            continue

        if not stripped:
            flush_para(para)
            i += 1
            continue

        para.append(stripped)
        i += 1

    flush_para(para)
    html_content = "".join(parts).strip()
    return html_content or "<p></p>"


def publish_page(title: str, content_md: str, path_hint: str = "") -> dict:
    title = (title or "Sem titulo").strip()[:256]
    hint = (path_hint or "").strip()
    api_title = hint[:256] if hint else title
    body = markdown_to_telegraph_html(content_md)
    if hint and hint != title:
        body = f"<p><strong>{html.escape(title)}</strong></p>" + body
    client = get_telegraph()
    page = client.create_page(
        title=api_title,
        html_content=body,
        author_name=AUTHOR_NAME,
    )
    return {
        "url": page.get("url"),
        "path": page.get("path"),
        "title": api_title,
    }


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    app_url = public_web_app_url()
    text = (
        "MDTXTRT - editor Markdown para Telegram Rich Messages e Telegraph.\n\n"
        "Abra o Mini App para escrever, pre-visualizar e publicar.\n"
        "/help lista os comandos."
    )
    markup = None
    if app_url:
        markup = InlineKeyboardMarkup(
            [[InlineKeyboardButton("Abrir editor", web_app=WebAppInfo(url=app_url))]]
        )
    await update.message.reply_text(text, reply_markup=markup)


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "/start - abre o Mini App\n"
        "/help - esta lista\n"
        "/tgrich <texto> - envia o texto com parse Markdown\n"
        "/mdrich - responda a uma mensagem para receber o .md nativo\n\n"
        "No Mini App: Publicar Telegraph ou Enviar para o bot."
    )


async def tgrich(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Uso: /tgrich *negrito* _italico_")
        return
    text = update.message.text.split(None, 1)[1]
    try:
        await update.message.reply_text(text, parse_mode="Markdown")
    except Exception as exc:
        await update.message.reply_text(f"Falha de sintaxe Markdown: {exc}")


async def mdrich(update: Update, context: ContextTypes.DEFAULT_TYPE):
    target = update.message.reply_to_message
    if not target:
        await update.message.reply_text("Responda a uma mensagem com /mdrich.")
        return
    md_text = target.text_markdown_v2 or target.caption_markdown_v2
    if not md_text:
        await update.message.reply_text("A mensagem alvo nao tem texto formatavel.")
        return
    buf = io.BytesIO(md_text.encode("utf-8"))
    buf.name = "exported.md"
    await update.message.reply_document(document=buf)


def _payload_from_webapp(raw: str) -> dict:
    data = json.loads(raw)
    if not isinstance(data, dict):
        return {"action": "markdown", "content": str(data), "title": "Sem titulo"}
    action = data.get("action") or data.get("type") or "markdown"
    return {
        "action": action,
        "title": data.get("title") or "Sem titulo",
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
            page = publish_page(payload["title"], content, payload["path"])
            await update.message.reply_text(f"Publicado: {page['url']}")
            return

        title = payload["title"]
        header = f"{title}\n\n" if title and title != "Sem titulo" else ""
        text = header + content
        if len(text) > 3900:
            buf = io.BytesIO(text.encode("utf-8"))
            buf.name = f"{title or 'documento'}.md"
            await update.message.reply_document(document=buf, caption=title)
        else:
            try:
                await update.message.reply_text(text, parse_mode="Markdown")
            except Exception:
                await update.message.reply_text(text)
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
        return web.Response(text="index.html ausente", status=404, content_type="text/plain", charset="utf-8")


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


async def api_publish(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON invalido"}, status=400)
    content = (data.get("content") or "").strip()
    if not content:
        return web.json_response({"ok": False, "error": "Documento vazio"}, status=400)
    try:
        page = publish_page(data.get("title") or "Sem titulo", content, data.get("path") or "")
        return web.json_response({"ok": True, **page})
    except TelegraphException as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=502)
    except Exception as exc:
        log.exception("api_publish")
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


async def on_startup(app: web.Application):
    if not TOKEN:
        log.warning("TELEGRAM_TOKEN ausente - Mini App sobe, bot fica desligado.")
        return
    application = Application.builder().token(TOKEN).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_cmd))
    application.add_handler(CommandHandler("tgrich", tgrich))
    application.add_handler(CommandHandler("mdrich", mdrich))
    application.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_webapp_data))
    await application.initialize()
    await application.start()
    await application.updater.start_polling(drop_pending_updates=True)
    app["bot"] = application
    log.info("Bot em polling.")


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
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=PORT)
