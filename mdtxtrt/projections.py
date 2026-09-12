"""Deterministic projections from the canonical document to publication formats.

There is no tag detector or secondary routing decision here. A canonical tree is
walked once and the projection itself reports adaptations, unsupported content
and destination limits.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import html
import json
from typing import Any, Callable
from urllib.parse import quote

from mdtxtrt.domain import CanonicalDocument, CanonicalNode


@dataclass(slots=True)
class ProjectionReview:
    destination: str
    representation: str
    content: str
    adaptations: list[dict[str, str]] = field(default_factory=list)
    unsupported: list[dict[str, str]] = field(default_factory=list)
    blocking: list[str] = field(default_factory=list)
    metrics: dict[str, int] = field(default_factory=dict)

    @property
    def requires_confirmation(self) -> bool:
        return bool(self.adaptations or self.unsupported)

    @property
    def publishable(self) -> bool:
        return not self.blocking

    @property
    def fingerprint(self) -> str:
        payload = json.dumps(
            {
                "destination": self.destination,
                "representation": self.representation,
                "content": self.content,
                "adaptations": self.adaptations,
                "unsupported": self.unsupported,
                "blocking": self.blocking,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def public(self) -> dict[str, Any]:
        return {
            "destination": self.destination,
            "representation": self.representation,
            "content": self.content,
            "adaptations": list(self.adaptations),
            "unsupported": list(self.unsupported),
            "blocking": list(self.blocking),
            "metrics": dict(self.metrics),
            "requires_confirmation": self.requires_confirmation,
            "publishable": self.publishable,
            "fingerprint": self.fingerprint,
        }


def _esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def _attrs(pairs: list[tuple[str, Any]]) -> str:
    out: list[str] = []
    for key, value in pairs:
        if value is None or value is False or value == "":
            continue
        if value is True:
            out.append(key)
        else:
            out.append(f'{key}="{_esc(value)}"')
    return (" " + " ".join(out)) if out else ""


def _children(node: CanonicalNode, render: Callable[[CanonicalNode], str]) -> str:
    if node.children:
        return "".join(render(child) for child in node.children)
    return _esc(node.text or "")


def _plain(node: CanonicalNode) -> str:
    if node.children:
        return "".join(_plain(child) for child in node.children)
    return node.text or ""


def _node_depth(node: CanonicalNode, depth: int = 1) -> int:
    return max([depth, *(_node_depth(child, depth + 1) for child in node.children)])


def _node_count(node: CanonicalNode) -> int:
    return 1 + sum(_node_count(child) for child in node.children)


class _TelegramHTML:
    INLINE_WRAPPERS = {
        "bold": "strong",
        "italic": "em",
        "underline": "u",
        "strikethrough": "s",
        "spoiler": "tg-spoiler",
        "subscript": "sub",
        "superscript": "sup",
        "marked": "mark",
        "code": "code",
    }
    MEDIA_TAGS = {
        "photo": "img",
        "video": "video",
        "animation": "video",
        "audio": "audio",
        "voice_note": "audio",
        "document": "tg-document",
    }

    def __init__(self):
        self.adaptations: list[dict[str, str]] = []
        self.unsupported: list[dict[str, str]] = []
        self.media_count = 0
        self.max_table_columns = 0

    def issue(self, collection: list[dict[str, str]], node: CanonicalNode, message: str) -> None:
        collection.append({"node_id": node.id, "kind": node.kind, "message": message})

    def inline(self, node: CanonicalNode) -> str:
        if node.kind in {"text", "plain"}:
            return _esc(node.text or "")
        wrapper = self.INLINE_WRAPPERS.get(node.kind)
        if wrapper:
            return f"<{wrapper}>{_children(node, self.inline)}</{wrapper}>"
        if node.kind in {"url", "link"}:
            return f'<a href="{_esc(node.attrs.get("url", ""))}">{_children(node, self.inline)}</a>'
        if node.kind == "email":
            return f'<a href="mailto:{_esc(node.attrs.get("email", ""))}">{_children(node, self.inline)}</a>'
        if node.kind == "phone":
            return f'<a href="tel:{_esc(node.attrs.get("phone", ""))}">{_children(node, self.inline)}</a>'
        if node.kind == "text_mention":
            return f'<a href="tg://user?id={_esc(node.attrs.get("user_id", ""))}">{_children(node, self.inline)}</a>'
        if node.kind in {"anchor_link", "reference_link"}:
            return f'<a href="#{_esc(node.attrs.get("name", ""))}">{_children(node, self.inline)}</a>'
        if node.kind == "custom_emoji":
            return f'<tg-emoji emoji-id="{_esc(node.attrs.get("emoji_id", ""))}">{_children(node, self.inline)}</tg-emoji>'
        if node.kind == "datetime":
            return f'<tg-time{_attrs([("unix", node.attrs.get("unix")), ("format", node.attrs.get("format"))])}>{_children(node, self.inline)}</tg-time>'
        if node.kind in {"math_inline", "mathematical_expression"}:
            return f"<tg-math>{_esc(node.text or _plain(node))}</tg-math>"
        if node.kind == "button":
            kind = str(node.attrs.get("type", "url"))
            pairs = [
                ("type", kind), ("style", node.attrs.get("style")),
                ("url", node.attrs.get("url")), ("data", node.attrs.get("data")),
                ("query", node.attrs.get("query")), ("text", node.attrs.get("copy_text")),
                ("forward-text", node.attrs.get("forward_text")),
                ("request-write-access", node.attrs.get("request_write_access")),
                ("allow-user-chats", node.attrs.get("allow_user_chats")),
                ("allow-bot-chats", node.attrs.get("allow_bot_chats")),
                ("allow-group-chats", node.attrs.get("allow_group_chats")),
                ("allow-channel-chats", node.attrs.get("allow_channel_chats")),
            ]
            return f"<tg-button{_attrs(pairs)}>{_children(node, self.inline)}</tg-button>"
        if node.kind in {"mention", "hashtag", "cashtag", "bot_command", "bank_card"}:
            return _esc(node.text or _plain(node))
        self.issue(self.unsupported, node, "Tipo inline desconhecido; mostrado como texto literal na revisão.")
        return _esc(_plain(node) or node.text or f"[{node.kind}]")

    def media(self, node: CanonicalNode) -> str:
        self.media_count += 1
        tag = self.MEDIA_TAGS[node.kind]
        src = str(node.attrs.get("src") or "")
        caption = str(node.attrs.get("caption") or "")
        credit = str(node.attrs.get("credit") or "")
        spoiler = bool(node.attrs.get("spoiler"))
        media = f"<{tag}{_attrs([('src', src), ('tg-spoiler', spoiler)])}></{tag}>" if tag != "img" else f"<img{_attrs([('src', src), ('tg-spoiler', spoiler)])}/>"
        if not caption and not credit:
            return media
        cite = f"<cite>{_esc(credit)}</cite>" if credit else ""
        return f"<figure>{media}<figcaption>{_esc(caption)}{cite}</figcaption></figure>"

    def block(self, node: CanonicalNode) -> str:
        kind = node.kind
        body = _children(node, self.inline)
        if kind == "paragraph":
            return f"<p>{body}</p>"
        if kind == "heading":
            level = min(6, max(1, int(node.attrs.get("level", 1))))
            return f"<h{level}>{body}</h{level}>"
        if kind == "code_block":
            language = str(node.attrs.get("language") or "")
            text = _esc(node.text or _plain(node))
            return f'<pre><code class="language-{_esc(language)}">{text}</code></pre>' if language else f"<pre>{text}</pre>"
        if kind == "footer":
            return f"<footer>{body}</footer>"
        if kind == "divider":
            return "<hr/>"
        if kind in {"blockquote", "expandable_blockquote"}:
            citation = str(node.attrs.get("citation") or "")
            cite = f"<cite>{_esc(citation)}</cite>" if citation else ""
            return f"<blockquote{_attrs([('expandable', kind == 'expandable_blockquote')])}>{body}{cite}</blockquote>"
        if kind == "pullquote":
            citation = str(node.attrs.get("citation") or "")
            cite = f"<cite>{_esc(citation)}</cite>" if citation else ""
            return f"<aside>{body}{cite}</aside>"
        if kind == "anchor":
            return f'<a name="{_esc(node.attrs.get("name", ""))}"></a>'
        if kind == "reference":
            return f'<tg-reference name="{_esc(node.attrs.get("name", ""))}">{body}</tg-reference>'
        if kind == "math_block":
            return f"<tg-math-block>{_esc(node.text or _plain(node))}</tg-math-block>"
        if kind in {"map", "location", "venue"}:
            self.issue(self.adaptations, node, "Localização nativa não é emitida como mapa HTML.")
            name = str(node.attrs.get("name") or "Localização")
            coords = f"{node.attrs.get('lat', '')}, {node.attrs.get('long', '')}".strip(", ")
            return f"<p>{_esc(name)} — {_esc(coords)}</p>"
        if kind in self.MEDIA_TAGS:
            return self.media(node)
        if kind in {"collage", "slideshow"}:
            tag = "tg-collage" if kind == "collage" else "tg-slideshow"
            inner = "".join(self.media(child) for child in node.children if child.kind in self.MEDIA_TAGS)
            caption = str(node.attrs.get("caption") or "")
            if caption:
                inner += f"<figcaption>{_esc(caption)}</figcaption>"
            return f"<{tag}>{inner}</{tag}>"
        if kind == "details":
            summary = str(node.attrs.get("summary") or "Detalhes")
            inner = "".join(self.block(child) for child in node.children) if node.children else _esc(node.text or "")
            return f"<details{_attrs([('open', bool(node.attrs.get('open')))])}><summary>{_esc(summary)}</summary>{inner}</details>"
        if kind == "list":
            ordered = bool(node.attrs.get("ordered"))
            tag = "ol" if ordered else "ul"
            attrs = _attrs([("start", node.attrs.get("start")), ("type", node.attrs.get("style")), ("reversed", node.attrs.get("reversed"))]) if ordered else ""
            items: list[str] = []
            for child in node.children:
                if child.kind != "list_item":
                    self.issue(self.unsupported, child, "Filho de lista não é list_item.")
                    continue
                checkbox = ""
                if child.attrs.get("task"):
                    checkbox = f"<input type=\"checkbox\"{_attrs([('checked', bool(child.attrs.get('checked')))])}>"
                value = _attrs([("value", child.attrs.get("value")), ("type", child.attrs.get("style"))])
                items.append(f"<li{value}>{checkbox}{_children(child, self.inline)}</li>")
            return f"<{tag}{attrs}>{''.join(items)}</{tag}>"
        if kind == "table":
            table_attrs = _attrs([("bordered", node.attrs.get("bordered")), ("striped", node.attrs.get("striped")), ("compact", node.attrs.get("compact"))])
            caption = str(node.attrs.get("caption") or "")
            content = f"<caption>{_esc(caption)}</caption>" if caption else ""
            for row in node.children:
                cells = [cell for cell in row.children if cell.kind in {"table_cell", "table_header"}]
                self.max_table_columns = max(self.max_table_columns, len(cells))
                content += "<tr>"
                for cell in cells:
                    tag = "th" if cell.kind == "table_header" else "td"
                    attrs = _attrs([("colspan", cell.attrs.get("colspan")), ("rowspan", cell.attrs.get("rowspan")), ("align", cell.attrs.get("align")), ("valign", cell.attrs.get("valign"))])
                    content += f"<{tag}{attrs}>{_children(cell, self.inline)}</{tag}>"
                content += "</tr>"
            return f"<table{table_attrs}>{content}</table>"
        if kind == "button_row":
            return f"<tg-button-row{_attrs([('align', node.attrs.get('align'))])}>{''.join(self.inline(child) for child in node.children)}</tg-button-row>"
        if kind == "raw_markdown":
            self.issue(self.adaptations, node, "Markdown cru foi escapado como bloco preformatado; confirme a conversão antes de publicar.")
            return f"<pre>{_esc(node.text or '')}</pre>"
        self.issue(self.unsupported, node, "Bloco desconhecido; mostrado literalmente na revisão.")
        return f"<pre>{_esc(_plain(node) or node.text or f'[{kind}]')}</pre>"


def telegram_projection(document: CanonicalDocument) -> ProjectionReview:
    renderer = _TelegramHTML()
    content = "".join(renderer.block(block) for block in document.blocks)
    text_chars = sum(len(_plain(block)) for block in document.blocks)
    block_count = sum(_node_count(block) for block in document.blocks)
    max_depth = max((_node_depth(block) for block in document.blocks), default=0)
    blocking: list[str] = []
    if text_chars > 32768:
        blocking.append(f"Texto lógico excede 32768 caracteres UTF-8 ({text_chars}).")
    if block_count > 500:
        blocking.append(f"Documento excede 500 blocos/nós estruturais ({block_count}).")
    if max_depth > 16:
        blocking.append(f"Documento excede 16 níveis de aninhamento ({max_depth}).")
    if renderer.media_count > 50:
        blocking.append(f"Documento excede 50 anexos de mídia ({renderer.media_count}).")
    if renderer.max_table_columns > 20:
        blocking.append(f"Tabela excede 20 colunas ({renderer.max_table_columns}).")
    return ProjectionReview(
        destination="telegram",
        representation="html",
        content=content,
        adaptations=renderer.adaptations,
        unsupported=renderer.unsupported,
        blocking=blocking,
        metrics={
            "text_characters": text_chars,
            "nodes": block_count,
            "max_depth": max_depth,
            "media": renderer.media_count,
            "max_table_columns": renderer.max_table_columns,
        },
    )


class _TelegraphHTML:
    def __init__(self):
        self.adaptations: list[dict[str, str]] = []
        self.unsupported: list[dict[str, str]] = []

    def adapt(self, node: CanonicalNode, message: str) -> None:
        self.adaptations.append({"node_id": node.id, "kind": node.kind, "message": message})

    def inline(self, node: CanonicalNode) -> str:
        body = _children(node, self.inline)
        wrappers = {"bold":"strong","italic":"em","underline":"u","strikethrough":"s","code":"code"}
        if node.kind in {"text", "plain"}:
            return _esc(node.text or "")
        if node.kind in wrappers:
            tag = wrappers[node.kind]
            return f"<{tag}>{body}</{tag}>"
        if node.kind in {"url", "link"}:
            return f'<a href="{_esc(node.attrs.get("url", ""))}">{body}</a>'
        if node.kind == "email":
            return f'<a href="mailto:{_esc(node.attrs.get("email", ""))}">{body}</a>'
        if node.kind == "phone":
            return f'<a href="tel:{_esc(node.attrs.get("phone", ""))}">{body}</a>'
        if node.kind == "button" and node.attrs.get("url"):
            self.adapt(node, "Botão foi convertido em link para o Telegraph.")
            return f'<a href="{_esc(node.attrs.get("url"))}">{body}</a>'
        if node.kind in {"marked","spoiler","subscript","superscript","custom_emoji","datetime","math_inline","mathematical_expression","text_mention","anchor_link","reference_link","mention","hashtag","cashtag","bot_command","bank_card","button"}:
            self.adapt(node, f"{node.kind} não possui representação equivalente no Telegraph; conteúdo textual foi preservado.")
            return _esc(_plain(node) or node.text or "")
        self.adapt(node, f"Inline {node.kind} foi reduzido a texto no Telegraph.")
        return _esc(_plain(node) or node.text or "")

    def block(self, node: CanonicalNode) -> str:
        body = _children(node, self.inline)
        if node.kind == "paragraph":
            return f"<p>{body}</p>"
        if node.kind == "heading":
            level = int(node.attrs.get("level", 3))
            target = 3 if level <= 3 else 4
            if level != target:
                self.adapt(node, f"Heading H{level} foi projetado como H{target} no Telegraph.")
            return f"<h{target}>{body}</h{target}>"
        if node.kind == "code_block":
            return f"<pre>{_esc(node.text or _plain(node))}</pre>"
        if node.kind in {"blockquote", "expandable_blockquote", "pullquote"}:
            if node.kind != "blockquote":
                self.adapt(node, f"{node.kind} foi convertido em citação simples no Telegraph.")
            return f"<blockquote>{body}</blockquote>"
        if node.kind == "divider":
            return "<hr>"
        if node.kind == "footer":
            self.adapt(node, "Rodapé foi convertido em parágrafo no Telegraph.")
            return f"<p>{body}</p>"
        if node.kind == "list":
            tag = "ol" if node.attrs.get("ordered") else "ul"
            return f"<{tag}>" + "".join(f"<li>{_children(child, self.inline)}</li>" for child in node.children) + f"</{tag}>"
        if node.kind in {"photo", "video"}:
            src = _esc(node.attrs.get("src", ""))
            tag = "img" if node.kind == "photo" else "video"
            return f"<{tag} src=\"{src}\"></{tag}>" if tag == "video" else f"<img src=\"{src}\">"
        if node.kind in {"audio","voice_note","animation","document"}:
            src = str(node.attrs.get("src") or "")
            self.adapt(node, f"{node.kind} foi convertido em link no Telegraph.")
            label = _esc(node.attrs.get("caption") or node.kind)
            return f'<p><a href="{_esc(src)}">{label}</a></p>' if src else f"<p>{label}</p>"
        if node.kind in {"collage", "slideshow"}:
            self.adapt(node, f"{node.kind} foi expandido em sequência de mídia no Telegraph.")
            return "".join(self.block(child) for child in node.children)
        if node.kind == "details":
            self.adapt(node, "Detalhes foram expandidos no Telegraph.")
            summary = _esc(node.attrs.get("summary") or "Detalhes")
            inner = "".join(self.block(child) for child in node.children) if node.children else _esc(node.text or "")
            return f"<h4>{summary}</h4>{inner}"
        if node.kind == "table":
            self.adapt(node, "Tabela foi convertida em texto preformatado no Telegraph.")
            rows = []
            for row in node.children:
                rows.append(" | ".join(_plain(cell).strip() for cell in row.children))
            return f"<pre>{_esc(chr(10).join(rows))}</pre>"
        if node.kind in {"map", "location", "venue"}:
            self.adapt(node, "Mapa foi reduzido a nome/coordenadas no Telegraph; nenhum provedor externo foi presumido.")
            name = str(node.attrs.get("name") or "Localização")
            coords = f"{node.attrs.get('lat', '')}, {node.attrs.get('long', '')}".strip(", ")
            return f"<p>{_esc(name)} — {_esc(coords)}</p>"
        if node.kind == "math_block":
            self.adapt(node, "Fórmula em bloco foi preservada como texto preformatado no Telegraph.")
            return f"<pre>{_esc(node.text or _plain(node))}</pre>"
        if node.kind in {"anchor", "reference", "button_row"}:
            self.adapt(node, f"{node.kind} foi simplificado para conteúdo textual no Telegraph.")
            return f"<p>{body}</p>" if body else ""
        if node.kind == "raw_markdown":
            self.adapt(node, "Markdown cru foi preservado literalmente em bloco preformatado no Telegraph.")
            return f"<pre>{_esc(node.text or '')}</pre>"
        self.unsupported.append({"node_id": node.id, "kind": node.kind, "message": "Bloco desconhecido foi preservado literalmente."})
        return f"<pre>{_esc(_plain(node) or node.text or f'[{node.kind}]')}</pre>"


def telegraph_projection(document: CanonicalDocument) -> ProjectionReview:
    renderer = _TelegraphHTML()
    content = "".join(renderer.block(block) for block in document.blocks)
    return ProjectionReview(
        destination="telegraph",
        representation="html",
        content=content,
        adaptations=renderer.adaptations,
        unsupported=renderer.unsupported,
        metrics={"html_bytes": len(content.encode("utf-8"))},
    )
