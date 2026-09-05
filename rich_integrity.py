"""Fidelidade estrutural do round-trip Rich 10.3 em HTML aceito pelo Rich Markdown."""
from __future__ import annotations

import html

_RTL_MARKER = "<!--mdtxtrt:rtl-->"
_ORIGINAL_BLOCK = None


def _attr(value) -> str:
    return html.escape(str(value or ""), quote=True)


def _plain_text(roundtrip_module, value) -> str:
    value = roundtrip_module._plain(value)
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "".join(_plain_text(roundtrip_module, item) for item in value)
    if not isinstance(value, dict):
        return str(value)
    typ = str(value.get("type") or "")
    if typ == "custom_emoji":
        return str(value.get("alternative_text") or "")
    if typ == "mathematical_expression":
        return str(value.get("expression") or "")
    if "text" in value:
        return _plain_text(roundtrip_module, value.get("text"))
    if "texts" in value:
        return _plain_text(roundtrip_module, value.get("texts"))
    return str(
        value.get("value")
        or value.get("bank_card_number")
        or value.get("mention")
        or value.get("hashtag")
        or value.get("cashtag")
        or value.get("bot_command")
        or ""
    )


def _inline_html(roundtrip_module, value) -> str:
    value = roundtrip_module._plain(value)
    if value is None:
        return ""
    if isinstance(value, str):
        return html.escape(value, quote=False)
    if isinstance(value, (int, float)):
        return html.escape(str(value), quote=False)
    if isinstance(value, list):
        return "".join(_inline_html(roundtrip_module, item) for item in value)
    if not isinstance(value, dict):
        return html.escape(str(value), quote=False)

    typ = str(value.get("type") or "")
    inner_source = value.get("text") if "text" in value else value.get("texts")
    inner = _inline_html(roundtrip_module, inner_source)

    if typ in {"", "plain", "text", "regular", "concat", "rich_text"}:
        return inner
    if typ == "bold":
        return f"<b>{inner}</b>"
    if typ == "italic":
        return f"<i>{inner}</i>"
    if typ in {"underline", "ins"}:
        return f"<u>{inner}</u>"
    if typ == "strikethrough":
        return f"<s>{inner}</s>"
    if typ == "spoiler":
        return f"<tg-spoiler>{inner}</tg-spoiler>"
    if typ == "code":
        return f"<code>{inner}</code>"
    if typ == "marked":
        return f"<mark>{inner}</mark>"
    if typ == "subscript":
        return f"<sub>{inner}</sub>"
    if typ == "superscript":
        return f"<sup>{inner}</sup>"
    if typ == "mathematical_expression":
        expression = html.escape(str(value.get("expression") or ""), quote=False)
        return f"<tg-math>{expression}</tg-math>"
    if typ == "custom_emoji":
        emoji_id = str(value.get("custom_emoji_id") or "")
        alternative = html.escape(str(value.get("alternative_text") or ""), quote=False)
        if emoji_id:
            return f'<tg-emoji emoji-id="{_attr(emoji_id)}">{alternative}</tg-emoji>'
        return alternative
    if typ == "date_time":
        unix_time = value.get("unix_time")
        fmt = str(value.get("date_time_format") or "")
        body = inner
        if unix_time is None:
            return body
        format_attr = f' format="{_attr(fmt)}"' if fmt else ""
        return f'<tg-time unix="{int(unix_time)}"{format_attr}>{body}</tg-time>'
    if typ in {"url", "text_link"}:
        url = value.get("url") or value.get("href") or ""
        return f'<a href="{_attr(url)}">{inner}</a>' if url else inner
    if typ in {"email_address", "email"}:
        address = value.get("email_address") or value.get("email") or _plain_text(roundtrip_module, value)
        label = inner or html.escape(str(address), quote=False)
        return f'<a href="mailto:{_attr(address)}">{label}</a>'
    if typ == "phone_number":
        number = value.get("phone_number") or _plain_text(roundtrip_module, value)
        label = inner or html.escape(str(number), quote=False)
        return f'<a href="tel:{_attr(number)}">{label}</a>'
    if typ in {"text_mention", "mention"}:
        user = value.get("user") or {}
        user_id = user.get("id") if isinstance(user, dict) else None
        user_id = user_id or value.get("user_id")
        if user_id and inner:
            return f'<a href="tg://user?id={_attr(user_id)}">{inner}</a>'
        return inner or html.escape(_plain_text(roundtrip_module, value), quote=False)
    if typ == "anchor":
        name = value.get("name") or ""
        return f'<a name="{_attr(name)}"></a>' if name else ""
    if typ == "anchor_link":
        name = value.get("anchor_name") or ""
        return f'<a href="#{_attr(name)}">{inner}</a>'
    if typ == "reference":
        name = value.get("name") or ""
        return f'<tg-reference name="{_attr(name)}">{inner}</tg-reference>' if name else inner
    if typ == "reference_link":
        name = value.get("reference_name") or ""
        return f'<a href="#{_attr(name)}">{inner}</a>' if name else inner
    if typ == "button":
        return roundtrip_module._button_html(value.get("button"))

    visible = inner or _plain_text(roundtrip_module, value)
    return html.escape(visible, quote=False) if not inner else inner


def _caption_html(roundtrip_module, value) -> tuple[str, str]:
    value = roundtrip_module._plain(value)
    if not isinstance(value, dict):
        return _inline_html(roundtrip_module, value), ""
    return (
        _inline_html(roundtrip_module, value.get("text")),
        _inline_html(roundtrip_module, value.get("credit")),
    )


def _blocks_html(roundtrip_module, items) -> str:
    return "\n".join(
        piece for piece in (_block_html(roundtrip_module, item) for item in (items or [])) if piece
    )


def _list_block(roundtrip_module, block: dict) -> str:
    items = [roundtrip_module._plain(item) for item in (block.get("items") or [])]
    ordered = any(
        isinstance(item, dict)
        and (item.get("value") is not None or item.get("type") is not None)
        for item in items
    )
    tag = "ol" if ordered else "ul"
    rendered: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            rendered.append(f"<li>{html.escape(str(item), quote=False)}</li>")
            continue
        attrs: list[str] = []
        if ordered and item.get("value") is not None:
            attrs.append(f'value="{int(item.get("value"))}"')
        if ordered and item.get("type") in {"a", "A", "i", "I", "1"}:
            attrs.append(f'type="{item.get("type")}"')
        attr_text = (" " + " ".join(attrs)) if attrs else ""
        checkbox = ""
        if item.get("has_checkbox"):
            checked = " checked" if item.get("is_checked") else ""
            checkbox = f'<input type="checkbox"{checked}>'
        body = _blocks_html(roundtrip_module, item.get("blocks") or [])
        rendered.append(f"<li{attr_text}>{checkbox}{body}</li>")
    return f"<{tag}>" + "".join(rendered) + f"</{tag}>"


def _table(roundtrip_module, block: dict) -> str:
    attrs = []
    if block.get("is_bordered"):
        attrs.append("bordered")
    if block.get("is_striped"):
        attrs.append("striped")
    if block.get("is_compact"):
        attrs.append("compact")
    opening = "<table" + ((" " + " ".join(attrs)) if attrs else "") + ">"
    parts = [opening]
    caption = _inline_html(roundtrip_module, block.get("caption"))
    if caption:
        parts.append(f"<caption>{caption}</caption>")
    for row in block.get("cells") or block.get("rows") or []:
        cells = row.get("cells") if isinstance(row, dict) else row
        rendered = []
        for cell in cells or []:
            cell = roundtrip_module._plain(cell)
            if not isinstance(cell, dict):
                cell = {"text": cell}
            tag = "th" if cell.get("is_header") else "td"
            cell_attrs = []
            for name in ("colspan", "rowspan", "align", "valign"):
                value = cell.get(name)
                if value not in (None, "", 1):
                    cell_attrs.append(f'{name}="{_attr(value)}"')
            attr_text = (" " + " ".join(cell_attrs)) if cell_attrs else ""
            rendered.append(
                f"<{tag}{attr_text}>{_inline_html(roundtrip_module, cell.get('text'))}</{tag}>"
            )
        parts.append("<tr>" + "".join(rendered) + "</tr>")
    parts.append("</table>")
    return "\n".join(parts)


def _block_html(roundtrip_module, value) -> str:
    block = roundtrip_module._plain(value)
    if block is None:
        return ""
    if isinstance(block, str):
        return f"<p>{html.escape(block, quote=False)}</p>"
    if not isinstance(block, dict):
        return f"<p>{html.escape(str(block), quote=False)}</p>"

    typ = str(block.get("type") or "")
    if typ == "paragraph":
        return f"<p>{_inline_html(roundtrip_module, block.get('text'))}</p>"
    if typ in {"section_heading", "heading"}:
        level = max(1, min(int(block.get("size") or block.get("level") or 1), 6))
        return f"<h{level}>{_inline_html(roundtrip_module, block.get('text'))}</h{level}>"
    if typ in {"preformatted", "pre"}:
        body = html.escape(_plain_text(roundtrip_module, block.get("text")), quote=False)
        language = str(block.get("language") or "").strip()
        if language:
            return f'<pre><code class="language-{_attr(language)}">{body}</code></pre>'
        return f"<pre>{body}</pre>"
    if typ == "footer":
        return f"<footer>{_inline_html(roundtrip_module, block.get('text'))}</footer>"
    if typ in {"divider", "horizontal_rule"}:
        return "<hr/>"
    if typ == "mathematical_expression":
        expression = html.escape(str(block.get("expression") or ""), quote=False)
        return f"<tg-math-block>{expression}</tg-math-block>"
    if typ == "anchor":
        name = block.get("name") or ""
        return f'<a name="{_attr(name)}"></a>' if name else ""
    if typ == "list":
        return _list_block(roundtrip_module, block)
    if typ in {"block_quotation", "blockquote"}:
        body = _blocks_html(roundtrip_module, block.get("blocks") or [])
        credit = _inline_html(roundtrip_module, block.get("credit"))
        cite = f"<cite>{credit}</cite>" if credit else ""
        return f"<blockquote>{body}{cite}</blockquote>"
    if typ in {"expandable_block_quotation", "expandable_blockquote"}:
        body = _inline_html(roundtrip_module, block.get("text"))
        credit = _inline_html(roundtrip_module, block.get("credit"))
        cite = f"<cite>{credit}</cite>" if credit else ""
        return f"<blockquote expandable>{body}{cite}</blockquote>"
    if typ in {"pull_quotation", "pullquote"}:
        body = _inline_html(roundtrip_module, block.get("text"))
        credit = _inline_html(roundtrip_module, block.get("credit"))
        cite = f"<cite>{credit}</cite>" if credit else ""
        return f"<aside>{body}{cite}</aside>"
    if typ == "details":
        summary = _inline_html(roundtrip_module, block.get("summary"))
        open_attr = " open" if block.get("is_open") else ""
        body = _blocks_html(roundtrip_module, block.get("blocks") or [])
        return f"<details{open_attr}><summary>{summary}</summary>\n{body}\n</details>"
    if typ == "table":
        return _table(roundtrip_module, block)
    if typ == "map":
        location = block.get("location") or {}
        lat = location.get("latitude")
        lon = location.get("longitude")
        if lat is None or lon is None:
            return _ORIGINAL_BLOCK(block)
        attrs = [f'lat="{_attr(lat)}"', f'long="{_attr(lon)}"']
        for name in ("zoom", "width", "height"):
            if block.get(name) is not None:
                attrs.append(f'{name}="{_attr(block.get(name))}"')
        map_html = "<tg-map " + " ".join(attrs) + "/>"
        caption, credit = _caption_html(roundtrip_module, block.get("caption"))
        if not caption and not credit:
            return map_html
        cite = f"<cite>{credit}</cite>" if credit else ""
        return f"<figure>{map_html}<figcaption>{caption}{cite}</figcaption></figure>"
    if typ == "buttons":
        align = block.get("align")
        attr = f' align="{_attr(align)}"' if align else ""
        buttons = "\n".join(
            roundtrip_module._button_html(item) for item in block.get("buttons") or []
        )
        return f"<tg-button-row{attr}>\n{buttons}\n</tg-button-row>"
    if typ in {
        "photo",
        "video",
        "animation",
        "audio",
        "document",
        "voice_note",
        "collage",
        "slideshow",
    }:
        return _ORIGINAL_BLOCK(block)
    if block.get("blocks"):
        return _blocks_html(roundtrip_module, block.get("blocks"))
    return _ORIGINAL_BLOCK(block)


def install(base_module, roundtrip_module) -> None:
    global _ORIGINAL_BLOCK
    if _ORIGINAL_BLOCK is None:
        _ORIGINAL_BLOCK = roundtrip_module._block

    roundtrip_module._text = lambda value: _inline_html(roundtrip_module, value)
    roundtrip_module._caption = lambda value: _caption_html(roundtrip_module, value)
    roundtrip_module._block = lambda value: _block_html(roundtrip_module, value)

    original_reverse = roundtrip_module.rich_message_to_markdown

    def rich_message_to_markdown(rich) -> str:
        parsed = roundtrip_module._plain(rich)
        body = original_reverse(rich)
        if isinstance(parsed, dict) and parsed.get("is_rtl"):
            return _RTL_MARKER + "\n" + body
        return body

    base_module.rich_message_to_markdown = rich_message_to_markdown
