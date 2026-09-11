"""Projeção reversa Rich 10.3 para Markdown editável sem perda silenciosa de estrutura."""
from __future__ import annotations

import html
from enum import Enum

from aiogram.types import TelegramObject
from aiogram.utils.serialization import deserialize_telegram_object_to_python

import convert


def _plain(value):
    if isinstance(value, Enum):
        return value.value
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, TelegramObject):
        return _plain(
            deserialize_telegram_object_to_python(
                value, include_api_method_name=False
            )
        )
    return value


def _attr(value) -> str:
    return html.escape(str(value or ""), quote=True)


def _button_html(value) -> str:
    button = _plain(value)
    if not isinstance(button, dict):
        return _text(button)
    label = _text(button.get("text")) or "botão"
    attrs: list[str] = []
    style = button.get("style")
    if style:
        attrs.append(f'style="{_attr(style)}"')

    if button.get("url") is not None:
        attrs[:0] = [f'type="url"', f'url="{_attr(button.get("url"))}"']
    elif button.get("callback_data") is not None:
        attrs[:0] = [f'type="callback_data"', f'data="{_attr(button.get("callback_data"))}"']
    elif button.get("web_app") is not None:
        web_app = button.get("web_app") or {}
        attrs[:0] = [f'type="web_app"', f'url="{_attr(web_app.get("url"))}"']
    elif button.get("login_url") is not None:
        login = button.get("login_url") or {}
        attrs[:0] = [f'type="login_url"', f'url="{_attr(login.get("url"))}"']
        if login.get("forward_text"):
            attrs.append(f'forward-text="{_attr(login.get("forward_text"))}"')
        if login.get("request_write_access"):
            attrs.append("request-write-access")
    elif button.get("switch_inline_query") is not None:
        attrs[:0] = [
            'type="switch_inline_query"',
            f'query="{_attr(button.get("switch_inline_query"))}"',
        ]
    elif button.get("switch_inline_query_current_chat") is not None:
        attrs[:0] = [
            'type="switch_inline_query_current_chat"',
            f'query="{_attr(button.get("switch_inline_query_current_chat"))}"',
        ]
    elif button.get("switch_inline_query_chosen_chat") is not None:
        chosen = button.get("switch_inline_query_chosen_chat") or {}
        attrs[:0] = [
            'type="switch_inline_query_chosen_chat"',
            f'query="{_attr(chosen.get("query") or "")}"',
        ]
        for field, html_name in (
            ("allow_user_chats", "allow-user-chats"),
            ("allow_bot_chats", "allow-bot-chats"),
            ("allow_group_chats", "allow-group-chats"),
            ("allow_channel_chats", "allow-channel-chats"),
        ):
            if chosen.get(field):
                attrs.append(html_name)
    elif button.get("copy_text") is not None:
        copy = button.get("copy_text") or {}
        attrs[:0] = ['type="copy_text"', f'text="{_attr(copy.get("text"))}"']
    elif button.get("disabled") is not None:
        attrs[:0] = ['type="disabled"']
    else:
        return label
    return f"<tg-button {' '.join(attrs)}>{label}</tg-button>"


def _text(node) -> str:
    node = _plain(node)
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, (int, float)):
        return str(node)
    if isinstance(node, list):
        return "".join(_text(item) for item in node)
    if not isinstance(node, dict):
        return str(node)

    typ = str(node.get("type") or "")
    inner = _text(node.get("text") if "text" in node else node.get("texts"))
    if typ in {"", "plain", "text", "regular", "concat", "rich_text"}:
        return inner
    if typ == "bold":
        return f"**{inner}**"
    if typ == "italic":
        return f"*{inner}*"
    if typ in {"underline", "ins"}:
        return f"<u>{inner}</u>"
    if typ == "strikethrough":
        return f"~~{inner}~~"
    if typ == "spoiler":
        return f"||{inner}||"
    if typ == "code":
        return f"`{inner}`"
    if typ == "marked":
        return f"=={inner}=="
    if typ == "subscript":
        return f"<sub>{inner}</sub>"
    if typ == "superscript":
        return f"<sup>{inner}</sup>"
    if typ == "mathematical_expression":
        expression = node.get("expression") or inner
        return f"${expression}$"
    if typ == "custom_emoji":
        emoji_id = node.get("custom_emoji_id") or ""
        return f"![{inner}](tg://emoji?id={emoji_id})" if emoji_id else inner
    if typ == "date_time":
        unix_time = node.get("unix_time")
        fmt = node.get("date_time_format") or ""
        if unix_time is not None:
            return f"![{inner}](tg://time?unix={int(unix_time)}&format={_attr(fmt)})"
        return inner
    if typ in {"url", "text_link"}:
        url = node.get("url") or node.get("href") or ""
        return f"[{inner}]({url})" if url else inner
    if typ in {"email_address", "email"}:
        address = node.get("email_address") or node.get("email") or inner
        return f"[{inner or address}](mailto:{address})"
    if typ == "phone_number":
        number = node.get("phone_number") or inner
        return f"[{inner or number}](tel:{number})"
    if typ in {"text_mention", "mention"}:
        user = node.get("user") or {}
        user_id = user.get("id") if isinstance(user, dict) else None
        user_id = user_id or node.get("user_id")
        return f"[{inner}](tg://user?id={user_id})" if user_id else inner
    if typ == "anchor":
        name = node.get("name") or ""
        return f'<a name="{_attr(name)}"></a>' if name else ""
    if typ == "anchor_link":
        name = node.get("anchor_name") or ""
        return f'<a href="#{_attr(name)}">{inner}</a>'
    if typ == "reference":
        name = node.get("name") or ""
        return f'<tg-reference name="{_attr(name)}">{inner}</tg-reference>' if name else inner
    if typ == "reference_link":
        name = node.get("reference_name") or ""
        return f'<a href="#{_attr(name)}">{inner}</a>' if name else inner
    if typ == "button":
        return _button_html(node.get("button"))
    return inner or str(node.get("value") or node.get("bank_card_number") or "")


def _caption(value) -> tuple[str, str]:
    value = _plain(value)
    if not isinstance(value, dict):
        return _text(value), ""
    return _text(value.get("text")), _text(value.get("credit"))


def _blocks(items) -> str:
    return "\n\n".join(piece for piece in (_block(item) for item in (items or [])) if piece)


def _table(block: dict) -> str:
    attrs = []
    if block.get("is_bordered"):
        attrs.append("bordered")
    if block.get("is_striped"):
        attrs.append("striped")
    if block.get("is_compact"):
        attrs.append("compact")
    opening = "<table" + ((" " + " ".join(attrs)) if attrs else "") + ">"
    parts = [opening]
    caption = _text(block.get("caption"))
    if caption:
        parts.append(f"<caption>{caption}</caption>")
    for row in block.get("cells") or block.get("rows") or []:
        cells = row.get("cells") if isinstance(row, dict) else row
        rendered = []
        for cell in cells or []:
            cell = _plain(cell)
            if not isinstance(cell, dict):
                cell = {"text": cell, "align": "left", "valign": "top"}
            tag = "th" if cell.get("is_header") else "td"
            cell_attrs = []
            for name in ("colspan", "rowspan", "align", "valign"):
                value = cell.get(name)
                if value not in (None, "", 1):
                    cell_attrs.append(f'{name}="{_attr(value)}"')
            attr_text = (" " + " ".join(cell_attrs)) if cell_attrs else ""
            rendered.append(f"<{tag}{attr_text}>{_text(cell.get('text'))}</{tag}>")
        parts.append("<tr>" + "".join(rendered) + "</tr>")
    parts.append("</table>")
    return "\n".join(parts)


def _block(value) -> str:
    block = _plain(value)
    if block is None:
        return ""
    if isinstance(block, str):
        return block
    if not isinstance(block, dict):
        return str(block)
    typ = str(block.get("type") or "")
    if typ == "paragraph":
        return _text(block.get("text"))
    if typ in {"section_heading", "heading"}:
        level = max(1, min(int(block.get("level") or block.get("size") or 1), 6))
        return f"{'#' * level} {_text(block.get('text'))}".rstrip()
    if typ in {"preformatted", "pre"}:
        language = block.get("language") or ""
        return f"```{language}\n{_text(block.get('text'))}\n```"
    if typ == "footer":
        return f"<footer>{_text(block.get('text'))}</footer>"
    if typ in {"divider", "horizontal_rule"}:
        return "---"
    if typ == "mathematical_expression":
        return f"<tg-math-block>{block.get('expression') or ''}</tg-math-block>"
    if typ == "anchor":
        name = block.get("name") or ""
        return f'<a name="{_attr(name)}"></a>' if name else ""
    if typ in {"block_quotation", "blockquote", "expandable_block_quotation", "expandable_blockquote"}:
        expandable = typ in {"expandable_block_quotation", "expandable_blockquote"}
        body = _blocks(block.get("blocks")) if block.get("blocks") else _text(block.get("text"))
        credit = _text(block.get("credit"))
        suffix = f"<cite>{credit}</cite>" if credit else ""
        attr = " expandable" if expandable else ""
        return f"<blockquote{attr}>{body}{suffix}</blockquote>"
    if typ in {"pull_quotation", "pullquote"}:
        body = _blocks(block.get("blocks")) if block.get("blocks") else _text(block.get("text"))
        credit = _text(block.get("credit"))
        suffix = f"<cite>{credit}</cite>" if credit else ""
        return f"<aside>{body}{suffix}</aside>"
    if typ == "details":
        summary = _text(block.get("summary"))
        open_attr = " open" if block.get("is_open") else ""
        return f"<details{open_attr}><summary>{summary}</summary>\n{_blocks(block.get('blocks'))}\n</details>"
    if typ == "table":
        return _table(block)
    if typ == "map":
        location = block.get("location") or {}
        lat = location.get("latitude")
        lon = location.get("longitude")
        if lat is None or lon is None:
            return convert.rich_block_to_md(block)
        attrs = [f'lat="{_attr(lat)}"', f'long="{_attr(lon)}"']
        for name in ("zoom", "width", "height"):
            if block.get(name) is not None:
                attrs.append(f'{name}="{_attr(block.get(name))}"')
        map_html = "<tg-map " + " ".join(attrs) + "/>"
        caption, credit = _caption(block.get("caption"))
        if not caption and not credit:
            return map_html
        cite = f"<cite>{credit}</cite>" if credit else ""
        return f"<figure>{map_html}<figcaption>{caption}{cite}</figcaption></figure>"
    if typ == "buttons":
        align = block.get("align")
        attr = f' align="{_attr(align)}"' if align else ""
        buttons = "\n".join(_button_html(item) for item in block.get("buttons") or [])
        return f"<tg-button-row{attr}>\n{buttons}\n</tg-button-row>"
    if typ in {"photo", "video", "animation", "audio", "document", "voice_note", "collage", "slideshow"}:
        return convert.rich_block_to_md(block)
    if block.get("blocks"):
        return _blocks(block.get("blocks"))
    return convert.rich_block_to_md(block)


def rich_message_to_markdown(rich) -> str:
    rich = _plain(rich)
    if not rich:
        return ""
    if isinstance(rich, str):
        return rich
    if not isinstance(rich, dict):
        return str(rich)
    if rich.get("markdown"):
        return str(rich["markdown"])
    if rich.get("blocks"):
        return _blocks(rich.get("blocks"))
    if rich.get("html"):
        return str(rich["html"])
    return _text(rich.get("text") or rich)


def install(base_module) -> None:
    base_module.rich_message_to_markdown = rich_message_to_markdown
