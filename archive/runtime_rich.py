"""Serviços Rich sem instalação ou mutação de módulos."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import hmac
import html
import re
import time
from typing import Callable

from aiohttp import web
from aiogram.types import InputRichMessage, InputRichMessageMedia, ReplyParameters

from canonical import CanonicalDocument
import drafts
import rich_delivery
import rich_explicit
import rich_media
import rich_media_roundtrip
import rich_roundtrip

from runtime_foundation import MediaState

_RTL_MARKER = "<!--mdtxtrt:rtl-->"


class RichMessageBuilder:
    def __init__(self, media: MediaState):
        self._media = media

    def build(self, content: str) -> InputRichMessage:
        source = str(content or "")
        is_rtl = source == _RTL_MARKER or source.startswith(_RTL_MARKER + "\n")
        if is_rtl:
            source = source[len(_RTL_MARKER):].lstrip("\n")

        markdown, refs = CanonicalDocument.from_markdown(source).telegram_markdown()
        media: list[InputRichMessageMedia] = []
        media_ids: set[str] = set()

        for ref in refs:
            item = self._media.items.get(ref.media_id)
            if not item:
                raise ValueError(f"Mídia local {ref.media_id} indisponível.")
            media.append(
                InputRichMessageMedia(
                    id=ref.media_id,
                    media=rich_media._local_input_media(item),
                )
            )
            media_ids.add(ref.media_id)

        def restore_remote(match: re.Match) -> str:
            scheme, reference_id, encoded_file_id, marker = match.groups()
            from urllib.parse import unquote

            file_id = unquote(encoded_file_id)
            if not file_id:
                raise ValueError("Referência de mídia Telegram sem file_id.")
            kind = marker or scheme.lower()
            if scheme.lower() == "document":
                kind = "document"
            elif scheme.lower() == "photo":
                kind = "photo"
            elif scheme.lower() == "audio" and not marker:
                kind = "audio"
            elif scheme.lower() == "video" and not marker:
                kind = "video"
            if reference_id in media_ids:
                raise ValueError("Identificador de mídia duplicado no documento.")
            media.append(
                InputRichMessageMedia(
                    id=reference_id,
                    media=rich_media._input_media(kind, file_id),
                )
            )
            media_ids.add(reference_id)
            return f"tg://{scheme.lower()}?id={reference_id}"

        markdown = rich_media._REMOTE_RE.sub(restore_remote, markdown)
        referenced = {
            match.group(2) for match in rich_media._OFFICIAL_RE.finditer(markdown)
        }
        missing = referenced - media_ids
        if missing:
            raise ValueError(
                "O documento contém referência tg:// de mídia sem arquivo associado."
            )

        if rich_explicit.requires_explicit_blocks(markdown):
            blocks = rich_explicit.compile_semantic_blocks(
                markdown,
                {item.id: item.media for item in media},
            )
            return InputRichMessage(
                blocks=blocks,
                is_rtl=True if is_rtl else None,
                skip_entity_detection=True,
            )

        return InputRichMessage(
            markdown=markdown,
            media=media or None,
            is_rtl=True if is_rtl else None,
        )


class PersistentMediaService:
    def __init__(
        self,
        *,
        builder: RichMessageBuilder,
        media: MediaState,
        token: str,
        store,
        logger,
    ):
        self._builder = builder
        self._media = media
        self._token = str(token or "")
        self._store = store
        self._log = logger
        self._owner: ContextVar[int | None] = ContextVar(
            "mdtxtrt_runtime_media_owner", default=None
        )

    @contextmanager
    def owner(self, user_id):
        previous = self._owner.get()
        token = None
        if previous is None:
            try:
                token = self._owner.set(int(user_id))
            except (TypeError, ValueError):
                token = None
        try:
            yield
        finally:
            if token is not None:
                self._owner.reset(token)

    def _cookie_secret(self) -> bytes:
        return self._token.encode("utf-8")

    def _cookie_value(self, telegram_user_id: int) -> str:
        user_id = int(telegram_user_id)
        signature = hmac.new(
            self._cookie_secret(),
            f"media:{user_id}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"{user_id}.{signature}"

    def cookie_user(self, request: web.Request) -> int | None:
        raw = str(request.cookies.get(drafts.MEDIA_SESSION_COOKIE) or "")
        try:
            user_text, _signature = raw.split(".", 1)
            user_id = int(user_text)
        except (ValueError, TypeError):
            return None
        expected = self._cookie_value(user_id)
        if not expected or not hmac.compare_digest(expected, raw):
            return None
        return user_id

    def set_cookie(self, response: web.StreamResponse, telegram_user_id: int) -> None:
        if not self._cookie_secret():
            return
        response.set_cookie(
            drafts.MEDIA_SESSION_COOKIE,
            self._cookie_value(int(telegram_user_id)),
            max_age=48 * 3600,
            httponly=True,
            secure=True,
            samesite="Strict",
            path="/",
        )

    def rehydrate(self, content: str) -> None:
        refs = drafts.local_media_ids(content)
        if not refs:
            return
        owner_id = self._owner.get()
        if owner_id is None:
            raise ValueError("Mídia local sem usuário autenticado.")

        now = time.time()
        for media_id in refs:
            current = self._media.items.get(media_id)
            if (
                current
                and current.get("exp", 0) >= now
                and int(current.get("telegram_user_id") or 0) == int(owner_id)
            ):
                continue
            persisted = self._store.load_media(media_id, int(owner_id))
            if not persisted:
                raise ValueError(
                    f"Mídia local {media_id} indisponível para este usuário."
                )
            self._media.items[media_id] = persisted

    def build(self, content: str) -> InputRichMessage:
        self.rehydrate(content)
        return self._builder.build(content)

    async def serve(self, request: web.Request):
        user_id = self.cookie_user(request)
        if user_id is None:
            return web.Response(text="Mídia não autorizada", status=401)

        self._media.purge()
        media_id = (request.match_info.get("mid") or "").strip()
        current = self._media.items.get(media_id)
        if not (
            current
            and current.get("exp", 0) >= time.time()
            and int(current.get("telegram_user_id") or 0) == user_id
        ):
            persisted = self._store.load_media(media_id, user_id)
            if not persisted:
                return web.Response(text="Mídia indisponível", status=404)
            self._media.items[media_id] = persisted
            current = persisted

        return web.Response(
            body=current["data"],
            content_type=current.get("mime") or "application/octet-stream",
            headers={"Cache-Control": "private, max-age=60"},
        )


class RichSender:
    def __init__(self, build_message: Callable[[str], InputRichMessage]):
        self._build_message = build_message

    async def send(
        self,
        bot,
        chat_id,
        content: str,
        reply_to_message_id=None,
        *,
        message_thread_id=None,
        direct_messages_topic_id=None,
        business_connection_id=None,
        ephemeral_message_parameters=None,
    ):
        rich = self._build_message(content)
        media = rich.media or []
        if rich.blocks is not None:
            rich_delivery.validate_explicit_blocks(rich.blocks)
            reply = (
                ReplyParameters(message_id=reply_to_message_id)
                if reply_to_message_id
                else None
            )
            await bot.send_rich_message(
                chat_id=chat_id,
                rich_message=rich,
                reply_parameters=reply,
                message_thread_id=message_thread_id,
                direct_messages_topic_id=direct_messages_topic_id,
                business_connection_id=business_connection_id,
                ephemeral_message_parameters=ephemeral_message_parameters,
                request_timeout=60,
            )
            return

        chunks = rich_delivery.split_structural_chunks(rich.markdown or "")
        for index, chunk in enumerate(chunks):
            rich_delivery.validate_rich_structure(chunk)
            reply = (
                ReplyParameters(message_id=reply_to_message_id)
                if index == 0 and reply_to_message_id
                else None
            )
            chunk_media = rich_delivery.media_for_chunk(chunk, media)
            if len(chunk_media) > rich_delivery.RICH_MEDIA_LIMIT:
                raise ValueError(
                    "Chunk Rich excede o limite oficial de "
                    f"{rich_delivery.RICH_MEDIA_LIMIT} mídias."
                )
            await bot.send_rich_message(
                chat_id=chat_id,
                rich_message=InputRichMessage(
                    markdown=chunk,
                    media=chunk_media or None,
                    is_rtl=rich.is_rtl,
                ),
                reply_parameters=reply,
                message_thread_id=message_thread_id,
                direct_messages_topic_id=direct_messages_topic_id,
                business_connection_id=business_connection_id,
                ephemeral_message_parameters=ephemeral_message_parameters,
                request_timeout=60,
            )


class RoundtripService:
    _MEDIA_TYPES = {
        "photo", "video", "animation", "audio", "document", "voice_note"
    }

    @staticmethod
    def _plain(value):
        return rich_roundtrip._plain(value)

    @staticmethod
    def _attr(value) -> str:
        return html.escape(str(value or ""), quote=True)

    def _text(self, value) -> str:
        value = self._plain(value)
        if value is None:
            return ""
        if isinstance(value, str):
            return html.escape(value, quote=False)
        if isinstance(value, (int, float)):
            return html.escape(str(value), quote=False)
        if isinstance(value, list):
            return "".join(self._text(item) for item in value)
        if not isinstance(value, dict):
            return html.escape(str(value), quote=False)

        typ = str(value.get("type") or "")
        source = value.get("text") if "text" in value else value.get("texts")
        inner = self._text(source)
        wrappers = {
            "bold": "b",
            "italic": "i",
            "underline": "u",
            "ins": "u",
            "strikethrough": "s",
            "spoiler": "tg-spoiler",
            "code": "code",
            "marked": "mark",
            "subscript": "sub",
            "superscript": "sup",
        }
        if typ in {"", "plain", "text", "regular", "concat", "rich_text"}:
            return inner
        if typ in wrappers:
            tag = wrappers[typ]
            return f"<{tag}>{inner}</{tag}>"
        if typ == "mathematical_expression":
            expression = html.escape(
                str(value.get("expression") or ""), quote=False
            )
            return f"<tg-math>{expression}</tg-math>"
        if typ == "custom_emoji":
            emoji_id = str(value.get("custom_emoji_id") or "")
            alternative = html.escape(
                str(value.get("alternative_text") or ""), quote=False
            )
            if emoji_id:
                return (
                    f'<tg-emoji emoji-id="{self._attr(emoji_id)}">'
                    f"{alternative}</tg-emoji>"
                )
            return alternative
        if typ == "date_time":
            unix_time = value.get("unix_time")
            fmt = str(value.get("date_time_format") or "")
            if unix_time is None:
                return inner
            fmt_attr = f' format="{self._attr(fmt)}"' if fmt else ""
            return f'<tg-time unix="{int(unix_time)}"{fmt_attr}>{inner}</tg-time>'
        if typ in {"url", "text_link"}:
            url = value.get("url") or value.get("href") or ""
            return f'<a href="{self._attr(url)}">{inner}</a>' if url else inner
        if typ in {"email_address", "email"}:
            address = value.get("email_address") or value.get("email") or ""
            label = inner or html.escape(str(address), quote=False)
            return f'<a href="mailto:{self._attr(address)}">{label}</a>'
        if typ == "phone_number":
            number = value.get("phone_number") or ""
            label = inner or html.escape(str(number), quote=False)
            return f'<a href="tel:{self._attr(number)}">{label}</a>'
        if typ == "text_mention":
            user = value.get("user") or {}
            user_id = user.get("id") if isinstance(user, dict) else None
            user_id = user_id or value.get("user_id")
            return (
                f'<a href="tg://user?id={self._attr(user_id)}">{inner}</a>'
                if user_id
                else inner
            )
        semantic_fields = {
            "mention": "username",
            "hashtag": "hashtag",
            "cashtag": "cashtag",
            "bot_command": "bot_command",
            "bank_card_number": "bank_card_number",
        }
        if typ in semantic_fields:
            field = semantic_fields[typ]
            parameter = value.get(field)
            visible = inner or html.escape(str(parameter or ""), quote=False)
            if parameter in (None, ""):
                return visible
            return (
                f'<tg-entity type="{typ}" {field}="{self._attr(parameter)}">'
                f"{visible}</tg-entity>"
            )
        if typ == "anchor":
            name = value.get("name") or ""
            return f'<a name="{self._attr(name)}"></a>' if name else ""
        if typ == "anchor_link":
            return f'<a href="#{self._attr(value.get("anchor_name") or "")}">{inner}</a>'
        if typ == "reference":
            name = value.get("name") or ""
            return (
                f'<tg-reference name="{self._attr(name)}">{inner}</tg-reference>'
                if name
                else inner
            )
        if typ == "reference_link":
            name = value.get("reference_name") or ""
            return f'<a href="#{self._attr(name)}">{inner}</a>' if name else inner
        if typ == "button":
            return rich_roundtrip._button_html(value.get("button"))

        return inner or html.escape(
            str(
                value.get("value")
                or value.get("bank_card_number")
                or value.get("hashtag")
                or value.get("cashtag")
                or value.get("bot_command")
                or ""
            ),
            quote=False,
        )

    def _caption(self, value) -> tuple[str, str]:
        value = self._plain(value)
        if not isinstance(value, dict):
            return self._text(value), ""
        return self._text(value.get("text")), self._text(value.get("credit"))

    def _blocks(self, items) -> str:
        return "\n".join(
            piece for piece in (self._block(item) for item in (items or [])) if piece
        )

    def _list(self, block: dict) -> str:
        items = [self._plain(item) for item in (block.get("items") or [])]
        ordered = any(
            isinstance(item, dict)
            and (item.get("value") is not None or item.get("type") is not None)
            for item in items
        )
        tag = "ol" if ordered else "ul"
        rendered = []
        for item in items:
            if not isinstance(item, dict):
                rendered.append(f"<li>{html.escape(str(item), quote=False)}</li>")
                continue
            attrs = []
            if ordered and item.get("value") is not None:
                attrs.append(f'value="{int(item.get("value"))}"')
            if ordered and item.get("type") in {"a", "A", "i", "I", "1"}:
                attrs.append(f'type="{item.get("type")}"')
            attr_text = (" " + " ".join(attrs)) if attrs else ""
            checkbox = ""
            if item.get("has_checkbox"):
                checked = " checked" if item.get("is_checked") else ""
                checkbox = f'<input type="checkbox"{checked}>'
            rendered.append(
                f"<li{attr_text}>{checkbox}{self._blocks(item.get('blocks') or [])}</li>"
            )
        return f"<{tag}>" + "".join(rendered) + f"</{tag}>"

    def _table(self, block: dict) -> str:
        attrs = []
        if block.get("is_bordered"):
            attrs.append("bordered")
        if block.get("is_striped"):
            attrs.append("striped")
        if block.get("is_compact"):
            attrs.append("compact")
        opening = "<table" + ((" " + " ".join(attrs)) if attrs else "") + ">"
        parts = [opening]
        caption = self._text(block.get("caption"))
        if caption:
            parts.append(f"<caption>{caption}</caption>")
        for row in block.get("cells") or block.get("rows") or []:
            cells = row.get("cells") if isinstance(row, dict) else row
            rendered = []
            for cell in cells or []:
                cell = self._plain(cell)
                if not isinstance(cell, dict):
                    cell = {"text": cell}
                tag = "th" if cell.get("is_header") else "td"
                cell_attrs = []
                for name in ("colspan", "rowspan", "align", "valign"):
                    value = cell.get(name)
                    if value not in (None, "", 1):
                        cell_attrs.append(f'{name}="{self._attr(value)}"')
                attr_text = (" " + " ".join(cell_attrs)) if cell_attrs else ""
                rendered.append(
                    f"<{tag}{attr_text}>{self._text(cell.get('text'))}</{tag}>"
                )
            parts.append("<tr>" + "".join(rendered) + "</tr>")
        parts.append("</table>")
        return "\n".join(parts)

    def _media(self, block: dict) -> str:
        element = rich_media_roundtrip._element(block)
        caption, credit = self._caption(block.get("caption"))
        if not caption and not credit:
            return element
        cite = f"<cite>{credit}</cite>" if credit else ""
        return (
            f"<figure>{element}<figcaption>{caption}{cite}</figcaption></figure>"
        )

    def _plain_collection_caption(self, value) -> str:
        value = self._plain(value)
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, list):
            parts = [self._plain_collection_caption(item) for item in value]
            if any(part is None for part in parts):
                raise ValueError(
                    "Legenda Rich de mídia interna de collage/slideshow "
                    "não possui representação sem perda."
                )
            return "".join(parts)
        if not isinstance(value, dict):
            raise ValueError(
                "Legenda Rich de mídia interna de collage/slideshow "
                "não possui representação sem perda."
            )
        typ = str(value.get("type") or "")
        if typ not in {"", "plain", "text", "regular", "concat", "rich_text"}:
            raise ValueError(
                "Legenda Rich de mídia interna de collage/slideshow "
                "não possui representação sem perda."
            )
        source = value.get("text") if "text" in value else value.get("texts")
        return self._plain_collection_caption(source)

    def _collection(self, block: dict) -> str:
        tag = "tg-collage" if block.get("type") == "collage" else "tg-slideshow"
        parts = []
        for child in block.get("blocks") or []:
            child = self._plain(child)
            if isinstance(child, dict) and child.get("type") in self._MEDIA_TYPES:
                child_caption = child.get("caption")
                if isinstance(child_caption, dict):
                    credit = self._plain_collection_caption(
                        child_caption.get("credit")
                    )
                    if credit:
                        raise ValueError(
                            "Crédito de mídia interna de collage/slideshow "
                            "não possui representação sem perda."
                        )
                    caption_source = child_caption.get("text")
                else:
                    caption_source = child_caption
                caption = self._plain_collection_caption(caption_source)
                if caption:
                    file_id = rich_media_roundtrip._file_id(child)
                    if not file_id:
                        raise ValueError(
                            f"Bloco de mídia {child.get('type')} recebido "
                            "sem file_id reutilizável."
                        )
                    uri = rich_media.remote_uri(str(child.get("type")), file_id)
                    safe_caption = caption.replace("\\", "\\\\").replace('"', '\\"')
                    parts.append(f'![]({uri} "{safe_caption}")')
                else:
                    parts.append(rich_media_roundtrip._element(child))
            else:
                parts.append(self._block(child))
        caption, credit = self._caption(block.get("caption"))
        if caption or credit:
            cite = f"<cite>{credit}</cite>" if credit else ""
            parts.append(f"<figcaption>{caption}{cite}</figcaption>")
        return f"<{tag}>\n" + "\n".join(parts) + f"\n</{tag}>"

    def _block(self, value) -> str:
        block = self._plain(value)
        if block is None:
            return ""
        if isinstance(block, str):
            return f"<p>{html.escape(block, quote=False)}</p>"
        if not isinstance(block, dict):
            return f"<p>{html.escape(str(block), quote=False)}</p>"

        typ = str(block.get("type") or "")
        if typ in self._MEDIA_TYPES:
            return self._media(block)
        if typ in {"collage", "slideshow"}:
            return self._collection(block)
        if typ == "paragraph":
            return f"<p>{self._text(block.get('text'))}</p>"
        if typ in {"section_heading", "heading"}:
            level = max(
                1, min(int(block.get("size") or block.get("level") or 1), 6)
            )
            return f"<h{level}>{self._text(block.get('text'))}</h{level}>"
        if typ in {"preformatted", "pre"}:
            body = html.escape(str(block.get("text") or ""), quote=False)
            language = str(block.get("language") or "").strip()
            if language:
                return (
                    f'<pre><code class="language-{self._attr(language)}">'
                    f"{body}</code></pre>"
                )
            return f"<pre>{body}</pre>"
        if typ == "footer":
            return f"<footer>{self._text(block.get('text'))}</footer>"
        if typ in {"divider", "horizontal_rule"}:
            return "<hr/>"
        if typ == "mathematical_expression":
            expression = html.escape(
                str(block.get("expression") or ""), quote=False
            )
            return f"<tg-math-block>{expression}</tg-math-block>"
        if typ == "anchor":
            name = block.get("name") or ""
            return f'<a name="{self._attr(name)}"></a>' if name else ""
        if typ == "list":
            return self._list(block)
        if typ in {"block_quotation", "blockquote"}:
            body = self._blocks(block.get("blocks") or [])
            credit = self._text(block.get("credit"))
            cite = f"<cite>{credit}</cite>" if credit else ""
            return f"<blockquote>{body}{cite}</blockquote>"
        if typ in {"expandable_block_quotation", "expandable_blockquote"}:
            body = self._text(block.get("text"))
            credit = self._text(block.get("credit"))
            cite = f"<cite>{credit}</cite>" if credit else ""
            return f"<blockquote expandable>{body}{cite}</blockquote>"
        if typ in {"pull_quotation", "pullquote"}:
            body = self._text(block.get("text"))
            credit = self._text(block.get("credit"))
            cite = f"<cite>{credit}</cite>" if credit else ""
            return f"<aside>{body}{cite}</aside>"
        if typ == "details":
            summary = self._text(block.get("summary"))
            open_attr = " open" if block.get("is_open") else ""
            return (
                f"<details{open_attr}><summary>{summary}</summary>\n"
                f"{self._blocks(block.get('blocks') or [])}\n</details>"
            )
        if typ == "table":
            return self._table(block)
        if typ == "map":
            location = block.get("location") or {}
            lat = location.get("latitude")
            lon = location.get("longitude")
            if lat is None or lon is None:
                return rich_roundtrip._block(block)
            attrs = [f'lat="{self._attr(lat)}"', f'long="{self._attr(lon)}"']
            for name in ("zoom", "width", "height"):
                if block.get(name) is not None:
                    attrs.append(f'{name}="{self._attr(block.get(name))}"')
            map_html = "<tg-map " + " ".join(attrs) + "/>"
            caption, credit = self._caption(block.get("caption"))
            if not caption and not credit:
                return map_html
            cite = f"<cite>{credit}</cite>" if credit else ""
            return (
                f"<figure>{map_html}<figcaption>{caption}{cite}</figcaption></figure>"
            )
        if typ == "buttons":
            align = block.get("align")
            attr = f' align="{self._attr(align)}"' if align else ""
            buttons = "\n".join(
                rich_roundtrip._button_html(item)
                for item in block.get("buttons") or []
            )
            return f"<tg-button-row{attr}>\n{buttons}\n</tg-button-row>"
        if block.get("blocks"):
            return self._blocks(block.get("blocks"))
        return rich_roundtrip._block(block)

    def convert(self, rich) -> str:
        parsed = self._plain(rich)
        if not parsed:
            return ""
        if isinstance(parsed, str):
            body = parsed
        elif not isinstance(parsed, dict):
            body = str(parsed)
        elif parsed.get("markdown"):
            body = str(parsed["markdown"])
        elif parsed.get("blocks"):
            body = "\n\n".join(
                piece
                for piece in (self._block(item) for item in parsed["blocks"])
                if piece
            )
        elif parsed.get("html"):
            body = str(parsed["html"])
        else:
            body = self._text(parsed.get("text") or parsed)
        if isinstance(parsed, dict) and parsed.get("is_rtl"):
            return _RTL_MARKER + "\n" + body
        return body
