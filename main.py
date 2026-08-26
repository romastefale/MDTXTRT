"""
Servidor aiohttp e Bot Telegram com suporte a Markdown, Telegraph e WebApp.
Versão corrigida: validação de initData, Telegraph não-bloqueante, fallback V2.
"""

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
    KeyboardButton,
    LinkPreviewOptions,
    ReplyKeyboardMarkup,
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


def _scrub(text: str) -> str:
    text = TOKEN_RE.sub("bot***", text)
    text = SECRET_RE.sub(r"\1=***", text)
    return text


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

TOKEN = os.environ.get("TELEGRAM_TOKEN", "tokendobot").strip()
WEB_APP_URL = os.environ.get("WEB_APP_URL", "https://mdmtrt.up.railway.app").strip()
PORT = int(os.environ.get("PORT", "8080"))
TELEGRAPH_TOKEN = os.environ.get("TELEGRAPH_ACCESS_TOKEN", "").strip()
AUTHOR_NAME = os.environ.get("TELEGRAPH_AUTHOR", "MDTXTRT")

INDEX_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")

_telegraph: Optional[Telegraph] = None


# ---------------------------------------------------------------------------
# CORREÇÃO 1: Validação de initData (HMAC-SHA256 conforme docs do Telegram)
# https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
# ---------------------------------------------------------------------------

def validate_init_data(init_data: str) -> Optional[dict]:
    """Valida initData do WebApp. Retorna o dict user ou None se inválido."""
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

        # initData validado: extrair usuário com segurança
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


def _create_telegraph_client() -> Telegraph:
    client = Telegraph(access_token=TELEGRAPH_TOKEN or None)
    if not TELEGRAPH_TOKEN:
        acc = client.create_account(short_name="MDTXTRT", author_name=AUTHOR_NAME)
        token = acc.get("access_token", "")
        if token:
            # CORREÇÃO 2: reconstrói o cliente em vez de tocar em atributo privado
            client = Telegraph(access_token=token)
        log.warning(
            "Conta Telegraph criada em runtime. Configure TELEGRAPH_ACCESS_TOKEN para persistencia."
        )
    return client


def get_telegraph() -> Telegraph:
    global _telegraph
    if _telegraph is None:
        _telegraph = _create_telegraph_client()
    return _telegraph


def markdown_to_telegraph_html(source: str) -> str:
    """Converte Markdown puro para HTML estruturado otimizado para a API do Telegraph."""
    text = source.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\|\|(.*?)\|\|", r"\1", text)
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
        s = re.sub(r"!\[([^\]]*)\]\(tg://emoji\?id=\d+\)", r"\1", s)
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

        if re.match(r"^(---+|\*\*\*+)", stripped):
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

        if (
            stripped.startswith("> ")
            or stripped.startswith("**> ")
            or stripped.startswith("**>")
            or stripped == ">"
        ):
            flush_para(para)
            quote: list[str] = []
            while i < n and (
                lines[i].strip().startswith(">") or lines[i].strip().startswith("**>")
            ):
                lq = lines[i].strip()
                if lq.startswith("**>"):
                    lq = lq[3:].lstrip(" ")
                elif lq.startswith(">"):
                    lq = lq[1:].lstrip(" ")
                lq = lq.rstrip("|").rstrip()
                quote.append(lq)
                i += 1
            parts.append(f"<blockquote>{inline(' '.join(quote))}</blockquote>")
            continue

        # Conversão otimizada de tabelas Markdown para tags nativas do Telegraph
        if stripped.startswith("|") and stripped.endswith("|"):
            flush_para(para)
            table_lines: list[str] = []
            while (
                i < n
                and lines[i].strip().startswith("|")
                and lines[i].strip().endswith("|")
            ):
                table_lines.append(lines[i].strip())
                i += 1
            if len(table_lines) >= 2 and re.match(r"^[|\s\-:]+$", table_lines[1]):
                headers = [c.strip() for c in table_lines[0].strip("|").split("|")]
                rows = [
                    [c.strip() for c in row.strip("|").split("|")]
                    for row in table_lines[2:]
                ]
                th_html = "".join(f"<th>{inline(h)}</th>" for h in headers)
                tr_html = "".join(
                    "<tr>" + "".join(f"<td>{inline(cell)}</td>" for cell in r) + "</tr>"
                    for r in rows
                )
                parts.append(
                    f"<table><thead><tr>{th_html}</tr></thead><tbody>{tr_html}</tbody></table>"
                )
            else:
                for tl in table_lines:
                    parts.append(f"<p>{inline(tl)}</p>")
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


def markdown_to_telegram_html(source: str) -> tuple[str, list[str]]:
    text = source.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    n = len(lines)
    parts: list[str] = []
    found_images: list[str] = []
    i = 0

    def inline_tg(s: str) -> str:
        code_spans: list[str] = []

        def save_code(m: re.Match) -> str:
            code_spans.append(html.escape(m.group(1)))
            return f"CODESPAN{len(code_spans)-1}XYZ"

        s = re.sub(r"`([^`]+)`", save_code, s)
        s = html.escape(s)

        def handle_img(m: re.Match) -> str:
            alt, url = m.group(1), m.group(2)
            if not url.startswith("tg://emoji"):
                found_images.append(url)
                display_text = f"🖼️ {alt}" if alt else "🖼️ Imagem"
                return f'<a href="{url}">{display_text}</a>'
            return m.group(0)

        s = re.sub(r"!\[([^\]]*)\]\((https?://[^)]+)\)", handle_img, s)
        s = re.sub(
            r"!\[([^\]]*)\]\(tg://emoji\?id=(\d+)\)",
            r'<tg-emoji emoji-id="\2">\1</tg-emoji>',
            s,
        )
        s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r"\|\|(.+?)\|\|", r"<tg-spoiler>\1</tg-spoiler>", s)
        s = re.sub(r"__(.+?)__", r"<u>\1</u>", s)
        s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
        s = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<b>\1</b>", s)
        s = re.sub(r"(?<!_)_(?!_)(.+?)(?<!_)_(?!_)", r"<i>\1</i>", s)
        s = re.sub(r"~~(.+?)~~", r"<s>\1</s>", s)

        for idx, c in enumerate(code_spans):
            s = s.replace(f"CODESPAN{idx}XYZ", f"<code>{c}</code>")
        return s

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            i += 1
            block: list[str] = []
            while i < n and not lines[i].strip().startswith("```"):
                block.append(html.escape(lines[i]))
                i += 1
            i += 1
            code = "\n".join(block)
            if lang:
                parts.append(
                    f'<pre><code class="language-{html.escape(lang)}">{code}</code></pre>'
                )
            else:
                parts.append(f"<pre>{code}</pre>")
            continue

        if stripped.startswith("**>") or (
            stripped.startswith(">") and stripped.endswith("||")
        ):
            quote: list[str] = []
            while i < n and (
                lines[i].strip().startswith("**>") or lines[i].strip().startswith(">")
            ):
                lq = lines[i].strip()
                if lq.startswith("**>"):
                    lq = lq[3:].lstrip(" ")
                elif lq.startswith(">"):
                    lq = lq[1:].lstrip(" ")
                lq = lq.rstrip("|").rstrip()
                quote.append(lq)
                i += 1
            q_text = "\n".join(inline_tg(q) for q in quote)
            parts.append(f"<blockquote expandable>{q_text}</blockquote>")
            continue

        if stripped.startswith(">"):
            quote = []
            while (
                i < n
                and lines[i].strip().startswith(">")
                and not lines[i].strip().startswith("**>")
            ):
                lq = lines[i].strip()[1:].lstrip(" ")
                quote.append(lq)
                i += 1
            q_text = "\n".join(inline_tg(q) for q in quote)
            parts.append(f"<blockquote>{q_text}</blockquote>")
            continue

        if re.match(r"^---+",stripped)orre.match(r"\*\*\*+", stripped) or re.match(r"^\*\*\*+",stripped)orre.match(r"\*\*\*+", stripped):
            parts.append("──────────────")
            i += 1
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            table_lines: list[str] = []
            while (
                i < n
                and lines[i].strip().startswith("|")
                and lines[i].strip().endswith("|")
            ):
                table_lines.append(lines[i].strip())
                i += 1
            if len(table_lines) >= 2 and re.match(r"^[|\s\-:]+$", table_lines[1]):
                headers = [c.strip() for c in table_lines[0].strip("|").split("|")]
                rows = [
                    [c.strip() for c in row.strip("|").split("|")]
                    for row in table_lines[2:]
                ]
                col_widths = [len(h) for h in headers]
                for row in rows:
                    for c_idx, cell in enumerate(row):
                        if c_idx < len(col_widths):
                            col_widths[c_idx] = max(col_widths[c_idx], len(cell))
                header_str = " | ".join(
                    h.ljust(col_widths[idx]) for idx, h in enumerate(headers)
                )
                sep_str = "-+-".join(
                    "-" * col_widths[idx] for idx in range(len(headers))
                )
                row_strs = [
                    " | ".join(
                        cell.ljust(col_widths[c_idx]) for c_idx, cell in enumerate(row)
                    )
                    for row in rows
                ]
                table_block = "\n".join([header_str, sep_str] + row_strs)
                parts.append(f"<pre>{html.escape(table_block)}</pre>")
            else:
                for tl in table_lines:
                    parts.append(inline_tg(tl))
            continue

        h_match = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if h_match:
            h_len = len(h_match.group(1))
            h_text = inline_tg(h_match.group(2))
            if h_len == 1:
                parts.append(f"<b>━━━ {h_text.upper()} ━━━</b>")
            elif h_len == 2:
                parts.append(f"<b>▶ {h_text}</b>")
            elif h_len == 3:
                parts.append(f"<b>◆ {h_text}</b>")
            elif h_len == 4:
                parts.append(f"<b>• <u>{h_text}</u></b>")
            elif h_len == 5:
                parts.append(f"<b><i>» {h_text}</i></b>")
            else:
                parts.append(f"<i>• {h_text}</i>")
            i += 1
            continue

        task_match = re.match(r"^[-*+]\s+\[([ xX])\]\s+(.*)$", stripped)
        if task_match:
            mark = "☑" if task_match.group(1).lower() == "x" else "☐"
            parts.append(f"{mark} {inline_tg(task_match.group(2))}")
            i += 1
            continue

        ul_match = re.match(r"^[-*+]\s+(.*)$", stripped)
        if ul_match:
            parts.append(f"• {inline_tg(ul_match.group(1))}")
            i += 1
            continue

        if not stripped:
            parts.append("")
        else:
            parts.append(inline_tg(line))
        i += 1

    return "\n".join(parts), found_images


def _escape_markdown_v2(text: str) -> str:
    """Escapa caracteres especiais exigidos pelo parser MarkdownV2."""
    return re.sub(r"([_*\[\]()~`>#+\-=|{}.!\\])", r"\\\1", text)


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


async def publish_page_async(title: str, content_md: str, path_hint: str = "") -> dict:
    # CORREÇÃO 3: Telegraph é síncrono (requests) — roda em executor
    # para não bloquear o event loop do aiohttp.
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, publish_page, title, content_md, path_hint
    )


async def dispatch_user_artifacts(bot, chat_id: int | str, title: str, content: str):
    safe_title = re.sub(r'[\\/*?:"<>|]', "", title).strip() if title else ""
    filename_base = (
        safe_title if safe_title and safe_title != "Sem titulo" else "documento"
    )

    header_html = (
        f"<b>{html.escape(title)}</b>\n\n"
        if title and title != "Sem titulo"
        else ""
    )
    header_plain = f"{title}\n\n" if title and title != "Sem titulo" else ""

    tg_html, images = markdown_to_telegram_html(content)
    full_tg_html = header_html + tg_html
    plain_text = header_plain + content

    preview_opts = (
        LinkPreviewOptions(
            is_disabled=False, url=images[0], prefer_large_media=True
        )
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
            # CORREÇÃO 4: fallback com MarkdownV2 escapado; sem parse_mode
            # como último recurso (o antigo MARKDOWN V1 é deprecado e falha
            # de forma imprevisível).
            try:
                await bot.send_message(
                    chat_id=chat_id,
                    text=_escape_markdown_v2(plain_text),
                    parse_mode=ParseMode.MARKDOWN_V2,
                )
            except Exception:
                await bot.send_message(chat_id=chat_id, text=plain_text)
    else:
        chunks = [
            plain_text[i : i + 4000] for i in range(0, len(plain_text), 4000)
        ]
        for chunk in chunks:
            await bot.send_message(chat_id=chat_id, text=chunk)

    # CORREÇÃO 5: os 3 arquivos anteriores (.md, .txt, copiar_conteudo.txt)
    # tinham conteúdo idêntico. Envia apenas o .md.
    buf_md = io.BytesIO(plain_text.encode("utf-8"))
    buf_md.name = f"{filename_base}.md"
    await bot.send_document(
        chat_id=chat_id,
        document=buf_md,
        caption=f"📄 {filename_base}.md",
    )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    app_url = public_web_app_url()
    text = (
        "🚀 <b>Bem-vindo ao MDTXTRT!</b>\n\n"
        "Abra o editor pelo teclado abaixo para redigir, pré-visualizar e despachar textos e anexos."
    )
    markup = None
    if app_url:
        markup = ReplyKeyboardMarkup(
            [[KeyboardButton("📝 Abrir Editor", web_app=WebAppInfo(url=app_url))]],
            resize_keyboard=True,
        )
    await update.message.reply_text(
        text, reply_markup=markup, parse_mode=ParseMode.HTML
    )


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "/start - Abre o Mini App com suporte a envio direto\n"
        "/help - Lista todos os recursos suportados\n"
        "/tgrich <texto> - Envia o texto formatado em Rich Text Telegram\n"
        "/mdrich - Responda a uma mensagem para exportar em .md"
    )


async def tgrich(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            "Uso: /tgrich *negrito* _italico_ __sublinhado__ ||spoiler||"
        )
        return
    text = update.message.text.split(None, 1)[1]
    tg_html, images = markdown_to_telegram_html(text)
    preview_opts = (
        LinkPreviewOptions(is_disabled=False, url=images[0]) if images else None
    )
    try:
        await update.message.reply_text(
            tg_html, parse_mode=ParseMode.HTML, link_preview_options=preview_opts
        )
    except Exception:
        try:
            await update.message.reply_text(
                _escape_markdown_v2(text), parse_mode=ParseMode.MARKDOWN_V2
            )
        except Exception as exc:
            await update.message.reply_text(f"Falha de sintaxe: {exc}")


async def mdrich(update: Update, context: ContextTypes.DEFAULT_TYPE):
    target = update.message.reply_to_message
    if not target:
        await update.message.reply_text("Responda a uma mensagem com /mdrich.")
        return
    md_text = target.text_markdown_v2 or target.caption_markdown_v2
    if not md_text:
        await update.message.reply_text(
            "A mensagem alvo não possui texto formatável."
        )
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
            return web.Response(
                text=fh.read(), content_type="text/html", charset="utf-8"
            )
    except FileNotFoundError:
        return web.Response(
            text="index.html ausente",
            status=404,
            content_type="text/plain",
            charset="utf-8",
        )


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


# ---------------------------------------------------------------------------
# CORREÇÃO 6: autenticação obrigatória nas rotas da API.
# O initData (assinado pelo Telegram) é validado no servidor e o user_id
# autorizado é extraído do payload validado — nunca confiado ao cliente.
# ---------------------------------------------------------------------------

async def api_send_chat(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)

    content = (data.get("content") or "").strip()
    if not content:
        return web.json_response(
            {"ok": False, "error": "Documento vazio"}, status=400
        )

    user = validate_init_data(data.get("init_data") or "")
    if not user or not user.get("id"):
        return web.json_response(
            {"ok": False, "error": "initData inválido ou ausente."}, status=401
        )
    user_id = user["id"]

    bot_app = request.app.get("bot")
    if not bot_app:
        return web.json_response(
            {"ok": False, "error": "Bot não inicializado."}, status=503
        )

    title = data.get("title") or "Sem titulo"

    try:
        await dispatch_user_artifacts(
            bot=bot_app.bot,
            chat_id=user_id,
            title=title,
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

    # Mesma autenticação da rota de envio: impede abuso anônimo da conta Telegraph.
    user = validate_init_data(data.get("init_data") or "")
    if not user or not user.get("id"):
        return web.json_response(
            {"ok": False, "error": "initData inválido ou ausente."}, status=401
        )

    content = (data.get("content") or "").strip()
    if not content:
        return web.json_response(
            {"ok": False, "error": "Documento vazio"}, status=400
        )
    try:
        page = await publish_page_async(
            data.get("title") or "Sem titulo", content, data.get("path") or ""
        )
        return web.json_response({"ok": True, **page})
    except TelegraphException as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=502)
    except Exception as exc:
        log.exception("api_publish")
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


async def on_startup(app: web.Application):
    if not TOKEN:
        log.warning("TELEGRAM_TOKEN ausente.")
        return
    application = Application.builder().token(TOKEN).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_cmd))
    application.add_handler(CommandHandler("tgrich", tgrich))
    application.add_handler(CommandHandler("mdrich", mdrich))
    application.add_handler(
        MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_webapp_data)
    )
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
    app.router.add_post("/api/send-chat", api_send_chat)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=PORT)
