"""Telegram Bot API 10.3 representation planning from one canonical document.

The canonical tree is the source of truth. HTML, Rich Markdown and typed Blocks
are publication representations, not independent parsing routes. A Blocks plan
is offered only when every represented node has a typed construction known to
this module; unsupported or structurally invalid nodes make that option
unavailable rather than being silently flattened.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
from typing import Any

from mdtxtrt.conversion import to_markdown
from mdtxtrt.domain import CanonicalDocument, CanonicalNode
from mdtxtrt.projections import ProjectionReview, telegram_projection


@dataclass(slots=True)
class RepresentationPlan:
    key: str
    label: str
    available: bool
    exact: bool
    preview: str
    adaptations: list[str] = field(default_factory=list)
    blocking: list[str] = field(default_factory=list)
    content: str | None = None
    blocks: list[dict[str, Any]] | None = None
    fingerprint_context: dict[str, Any] = field(default_factory=dict)

    @property
    def requires_confirmation(self) -> bool:
        return bool(self.adaptations)

    @property
    def fingerprint(self) -> str:
        payload = {
            "key": self.key,
            "available": self.available,
            "exact": self.exact,
            "content": self.content,
            "blocks": self.blocks,
            "adaptations": self.adaptations,
            "blocking": self.blocking,
            "context": self.fingerprint_context,
        }
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def public(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "available": self.available,
            "exact": self.exact,
            "preview": self.preview,
            "adaptations": list(self.adaptations),
            "blocking": list(self.blocking),
            "requires_confirmation": self.requires_confirmation,
            "fingerprint": self.fingerprint,
            "destination_context": dict(self.fingerprint_context),
        }


@dataclass(slots=True)
class TelegramRepresentationSet:
    recommended: str
    options: dict[str, RepresentationPlan]

    def public(self) -> dict[str, Any]:
        return {
            "recommended": self.recommended,
            "options": {key: value.public() for key, value in self.options.items()},
        }


def _plain(node: CanonicalNode) -> str:
    if node.children:
        return "".join(_plain(child) for child in node.children)
    return node.text or ""


def _rich_text(node: CanonicalNode, adaptations: list[str]) -> Any:
    if node.kind in {"text", "plain"}:
        return node.text or ""

    if node.children:
        values = [_rich_text(child, adaptations) for child in node.children]
        children: Any = values[0] if len(values) == 1 else values
    else:
        children = node.text or ""

    wrappers = {
        "bold": "bold",
        "italic": "italic",
        "underline": "underline",
        "strikethrough": "strikethrough",
        "spoiler": "spoiler",
        "subscript": "subscript",
        "superscript": "superscript",
        "marked": "marked",
        "code": "code",
    }
    if node.kind in wrappers:
        return {"type": wrappers[node.kind], "text": children}
    if node.kind in {"url", "link"}:
        return {"type": "url", "text": children, "url": str(node.attrs.get("url") or "")}
    if node.kind == "text_mention":
        adaptations.append(f"{node.id}: menção por ID representada como URL tg://user no modo Blocks")
        return {
            "type": "url",
            "text": children,
            "url": f"tg://user?id={node.attrs.get('user_id', '')}",
        }
    if node.kind == "custom_emoji":
        return {
            "type": "custom_emoji",
            "custom_emoji_id": str(node.attrs.get("emoji_id") or ""),
            "alternative_text": _plain(node),
        }
    if node.kind == "datetime":
        return {
            "type": "date_time",
            "text": children,
            "unix_time": int(node.attrs.get("unix") or 0),
            "date_time_format": str(node.attrs.get("format") or "wDT"),
        }
    if node.kind in {"math_inline", "mathematical_expression"}:
        return {"type": "mathematical_expression", "expression": node.text or _plain(node)}
    if node.kind == "anchor_link":
        return {
            "type": "anchor_link",
            "text": children,
            "anchor_name": str(node.attrs.get("name") or ""),
        }
    if node.kind == "reference_link":
        return {
            "type": "reference_link",
            "text": children,
            "reference_name": str(node.attrs.get("name") or ""),
        }
    if node.kind == "reference":
        return {
            "type": "reference",
            "text": children,
            "name": str(node.attrs.get("name") or ""),
        }
    raise ValueError(f"blocks_inline_unsupported:{node.kind}:{node.id}")


def _block_text(node: CanonicalNode, adaptations: list[str]) -> Any:
    if not node.children:
        return node.text or ""
    values = [_rich_text(child, adaptations) for child in node.children]
    return values[0] if len(values) == 1 else values


def _blocks_for_node(node: CanonicalNode, adaptations: list[str]) -> list[dict[str, Any]]:
    if node.kind == "paragraph":
        return [{"type": "paragraph", "text": _block_text(node, adaptations)}]
    if node.kind == "heading":
        return [{
            "type": "heading",
            "text": _block_text(node, adaptations),
            "size": min(6, max(1, int(node.attrs.get("level", 1)))),
        }]
    if node.kind == "code_block":
        result: dict[str, Any] = {"type": "pre", "text": node.text or _plain(node)}
        language = str(node.attrs.get("language") or "").strip()
        if language:
            result["language"] = language
        return [result]
    if node.kind == "footer":
        return [{"type": "footer", "text": _block_text(node, adaptations)}]
    if node.kind == "divider":
        return [{"type": "divider"}]
    if node.kind == "math_block":
        return [{"type": "mathematical_expression", "expression": node.text or _plain(node)}]
    if node.kind == "anchor":
        return [{"type": "anchor", "name": str(node.attrs.get("name") or "")}]
    if node.kind == "blockquote":
        paragraph = {"type": "paragraph", "text": _block_text(node, adaptations)}
        result = {"type": "blockquote", "blocks": [paragraph]}
        credit = str(node.attrs.get("citation") or "").strip()
        if credit:
            result["credit"] = credit
        return [result]
    if node.kind == "expandable_blockquote":
        result = {"type": "expandable_blockquote", "text": _block_text(node, adaptations)}
        credit = str(node.attrs.get("citation") or "").strip()
        if credit:
            result["credit"] = credit
        return [result]
    if node.kind == "pullquote":
        result = {"type": "pullquote", "text": _block_text(node, adaptations)}
        credit = str(node.attrs.get("citation") or "").strip()
        if credit:
            result["credit"] = credit
        return [result]
    if node.kind == "list":
        items: list[dict[str, Any]] = []
        for index, item in enumerate(node.children, start=int(node.attrs.get("start", 1))):
            if item.kind != "list_item":
                raise ValueError(f"blocks_list_child_unsupported:{item.kind}:{item.id}")
            content = {"type": "paragraph", "text": _block_text(item, adaptations)}
            entry: dict[str, Any] = {"blocks": [content]}
            if item.attrs.get("task"):
                entry["has_checkbox"] = True
                entry["is_checked"] = bool(item.attrs.get("checked"))
            if node.attrs.get("ordered"):
                entry["value"] = int(item.attrs.get("value") or index)
            items.append(entry)
        return [{"type": "list", "items": items}]
    if node.kind == "details":
        nested: list[dict[str, Any]] = []
        for child in node.children:
            nested.extend(_blocks_for_node(child, adaptations))
        result = {
            "type": "details",
            "summary": str(node.attrs.get("summary") or "Detalhes"),
            "blocks": nested,
        }
        if node.attrs.get("open"):
            result["is_open"] = True
        return [result]
    raise ValueError(f"blocks_block_unsupported:{node.kind}:{node.id}")


_RICH_TEXT_KEYS: dict[str, frozenset[str]] = {
    "bold": frozenset({"type", "text"}),
    "italic": frozenset({"type", "text"}),
    "underline": frozenset({"type", "text"}),
    "strikethrough": frozenset({"type", "text"}),
    "spoiler": frozenset({"type", "text"}),
    "subscript": frozenset({"type", "text"}),
    "superscript": frozenset({"type", "text"}),
    "marked": frozenset({"type", "text"}),
    "code": frozenset({"type", "text"}),
    "url": frozenset({"type", "text", "url"}),
    "custom_emoji": frozenset({"type", "custom_emoji_id", "alternative_text"}),
    "date_time": frozenset({"type", "text", "unix_time", "date_time_format"}),
    "mathematical_expression": frozenset({"type", "expression"}),
    "anchor_link": frozenset({"type", "text", "anchor_name"}),
    "reference_link": frozenset({"type", "text", "reference_name"}),
    "reference": frozenset({"type", "text", "name"}),
}
_BLOCK_KEYS: dict[str, frozenset[str]] = {
    "paragraph": frozenset({"type", "text"}),
    "heading": frozenset({"type", "text", "size"}),
    "pre": frozenset({"type", "text", "language"}),
    "footer": frozenset({"type", "text"}),
    "divider": frozenset({"type"}),
    "mathematical_expression": frozenset({"type", "expression"}),
    "anchor": frozenset({"type", "name"}),
    "blockquote": frozenset({"type", "blocks", "credit"}),
    "expandable_blockquote": frozenset({"type", "text", "credit"}),
    "pullquote": frozenset({"type", "text", "credit"}),
    "list": frozenset({"type", "items"}),
    "details": frozenset({"type", "summary", "blocks", "is_open"}),
}
_LIST_ITEM_KEYS = frozenset({"blocks", "has_checkbox", "is_checked", "value", "type"})


def _validate_rich_text(value: Any) -> None:
    if isinstance(value, str):
        return
    if isinstance(value, list):
        for child in value:
            _validate_rich_text(child)
        return
    if not isinstance(value, dict):
        raise ValueError("blocks_rich_text_invalid_shape")
    kind = str(value.get("type") or "")
    allowed = _RICH_TEXT_KEYS.get(kind)
    if allowed is None:
        raise ValueError(f"blocks_rich_text_type_unverified:{kind}")
    unexpected = set(value) - set(allowed)
    if unexpected:
        raise ValueError(f"blocks_rich_text_unexpected_fields:{kind}:{','.join(sorted(unexpected))}")
    if "text" in value:
        _validate_rich_text(value["text"])


def _validate_input_block(block: dict[str, Any]) -> None:
    kind = str(block.get("type") or "")
    allowed = _BLOCK_KEYS.get(kind)
    if allowed is None:
        raise ValueError(f"blocks_type_unverified:{kind}")
    unexpected = set(block) - set(allowed)
    if unexpected:
        raise ValueError(f"blocks_unexpected_fields:{kind}:{','.join(sorted(unexpected))}")
    if "text" in block:
        _validate_rich_text(block["text"])
    if "credit" in block:
        _validate_rich_text(block["credit"])
    if "summary" in block:
        _validate_rich_text(block["summary"])
    for nested in block.get("blocks", []):
        _validate_input_block(nested)
    if kind == "list":
        for item in block.get("items", []):
            if not isinstance(item, dict):
                raise ValueError("blocks_list_item_invalid_shape")
            unexpected_item = set(item) - set(_LIST_ITEM_KEYS)
            if unexpected_item:
                raise ValueError(
                    f"blocks_list_item_unexpected_fields:{','.join(sorted(unexpected_item))}"
                )
            for nested in item.get("blocks", []):
                _validate_input_block(nested)


def _blocks_plan(document: CanonicalDocument) -> RepresentationPlan:
    adaptations: list[str] = []
    blocks: list[dict[str, Any]] = []
    try:
        for block in document.blocks:
            blocks.extend(_blocks_for_node(block, adaptations))
        for block in blocks:
            _validate_input_block(block)
    except (ValueError, TypeError) as exc:
        return RepresentationPlan(
            key="blocks",
            label="Blocks tipados",
            available=False,
            exact=False,
            preview=json.dumps(blocks, ensure_ascii=False, indent=2),
            adaptations=adaptations,
            blocking=[str(exc)],
            blocks=None,
        )
    return RepresentationPlan(
        key="blocks",
        label="Blocks tipados",
        available=True,
        exact=not adaptations,
        preview=json.dumps(blocks, ensure_ascii=False, indent=2),
        adaptations=adaptations,
        blocks=blocks,
    )


def _markdown_safe_node(node: CanonicalNode) -> bool:
    safe_inline = {
        "text", "plain", "bold", "italic", "strikethrough", "marked", "spoiler", "code",
        "url", "link", "text_mention", "custom_emoji", "math_inline", "mathematical_expression",
    }
    safe_blocks = {
        "paragraph", "heading", "code_block", "divider", "list", "table", "blockquote",
    }
    if node.kind in safe_inline:
        return all(_markdown_safe_node(child) for child in node.children)
    if node.kind in safe_blocks:
        return all(_markdown_safe_node(child) for child in node.children)
    if node.kind == "list_item":
        return all(_markdown_safe_node(child) for child in node.children)
    if node.kind in {"table_row", "table_cell", "table_header"}:
        return all(_markdown_safe_node(child) for child in node.children)
    if node.kind in {"photo", "video", "animation", "audio", "voice_note", "document"}:
        src = str(node.attrs.get("src") or "")
        return src.startswith(("http://", "https://")) and not node.attrs.get("media_blob_id")
    return False


def _html_as_markdown_fallback(html_review: ProjectionReview) -> RepresentationPlan:
    adaptations = [
        "O campo Rich Markdown usa Rich HTML suportado como fallback porque o documento contém recursos sem sintaxe Markdown nativa exata."
    ]
    adaptations.extend(item.get("message", "") for item in html_review.adaptations if item.get("message"))
    return RepresentationPlan(
        key="markdown",
        label="Rich Markdown",
        available=html_review.publishable,
        exact=not html_review.unsupported and not html_review.blocking,
        preview=html_review.content,
        adaptations=adaptations,
        blocking=list(html_review.blocking),
        content=html_review.content,
    )


def plan_telegram_representations(
    document: CanonicalDocument,
    *,
    html_review: ProjectionReview | None = None,
    preferred: str | None = None,
    fingerprint_context: dict[str, Any] | None = None,
) -> TelegramRepresentationSet:
    html_result = html_review or telegram_projection(document)
    html_plan = RepresentationPlan(
        key="html",
        label="Rich HTML",
        available=html_result.publishable,
        exact=not html_result.unsupported and not html_result.adaptations and not html_result.blocking,
        preview=html_result.content,
        adaptations=[item.get("message", "") for item in html_result.adaptations if item.get("message")],
        blocking=list(html_result.blocking),
        content=html_result.content,
    )

    markdown_native = all(_markdown_safe_node(block) for block in document.blocks)
    if markdown_native:
        markdown = to_markdown(document)
        markdown_plan = RepresentationPlan(
            key="markdown",
            label="Rich Markdown",
            available=True,
            exact=True,
            preview=markdown,
            content=markdown,
        )
    else:
        markdown_plan = _html_as_markdown_fallback(html_result)

    blocks_plan = _blocks_plan(document)
    options = {"markdown": markdown_plan, "html": html_plan, "blocks": blocks_plan}
    for option in options.values():
        option.fingerprint_context = dict(fingerprint_context or {})

    preferred_key = str(preferred or "").strip().lower()
    if preferred_key in options and options[preferred_key].available:
        recommended = preferred_key
    elif markdown_plan.available and markdown_plan.exact and not markdown_plan.adaptations:
        recommended = "markdown"
    elif html_plan.available:
        recommended = "html"
    elif blocks_plan.available:
        recommended = "blocks"
    else:
        recommended = "html"
    return TelegramRepresentationSet(recommended=recommended, options=options)
