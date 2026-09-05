"""Propriedades de round-trip que não cabem na projeção textual simples."""
from __future__ import annotations

import html

_RTL_MARKER = "<!--mdtxtrt:rtl-->"
_ORIGINAL_BLOCK = None
_ORIGINAL_TEXT = None


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
            rendered.append(f"<li>{html.escape(str(item))}</li>")
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
        body = roundtrip_module._blocks(item.get("blocks") or [])
        rendered.append(f"<li{attr_text}>{checkbox}{body}</li>")
    return f"<{tag}>" + "".join(rendered) + f"</{tag}>"


def install(base_module, roundtrip_module) -> None:
    global _ORIGINAL_BLOCK, _ORIGINAL_TEXT
    if _ORIGINAL_BLOCK is None:
        _ORIGINAL_BLOCK = roundtrip_module._block
    if _ORIGINAL_TEXT is None:
        _ORIGINAL_TEXT = roundtrip_module._text

    def text(value) -> str:
        parsed = roundtrip_module._plain(value)
        if isinstance(parsed, dict):
            typ = str(parsed.get("type") or "")
            if typ == "custom_emoji":
                emoji_id = str(parsed.get("custom_emoji_id") or "")
                alternative = html.escape(
                    str(parsed.get("alternative_text") or ""), quote=False
                )
                if emoji_id:
                    return (
                        f'<tg-emoji emoji-id="{html.escape(emoji_id, quote=True)}">'
                        f"{alternative}</tg-emoji>"
                    )
                return alternative
            if typ == "date_time":
                unix_time = parsed.get("unix_time")
                fmt = str(parsed.get("date_time_format") or "")
                body = text(parsed.get("text"))
                if unix_time is not None:
                    format_attr = (
                        f' format="{html.escape(fmt, quote=True)}"' if fmt else ""
                    )
                    return (
                        f'<tg-time unix="{int(unix_time)}"{format_attr}>'
                        f"{body}</tg-time>"
                    )
                return body
        return _ORIGINAL_TEXT(parsed)

    def block(value) -> str:
        parsed = roundtrip_module._plain(value)
        if isinstance(parsed, dict) and parsed.get("type") == "list":
            return _list_block(roundtrip_module, parsed)
        return _ORIGINAL_BLOCK(parsed)

    roundtrip_module._text = text
    roundtrip_module._block = block
    original_reverse = roundtrip_module.rich_message_to_markdown

    def rich_message_to_markdown(rich) -> str:
        parsed = roundtrip_module._plain(rich)
        body = original_reverse(rich)
        if isinstance(parsed, dict) and parsed.get("is_rtl"):
            return _RTL_MARKER + "\n" + body
        return body

    base_module.rich_message_to_markdown = rich_message_to_markdown
