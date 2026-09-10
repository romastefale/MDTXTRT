"""Explicit conversion review routes; no conversion mutates a draft implicitly."""
from __future__ import annotations

from typing import Any

from aiohttp import web

from mdtxtrt.auth import validate_init_data
from mdtxtrt.config import Settings
from mdtxtrt.conversion import from_markdown, to_markdown, to_text
from mdtxtrt.domain import CanonicalDocument, CanonicalNode


def _identity(request: web.Request):
    settings: Settings = request.app["settings"]
    return validate_init_data(
        request.headers.get("X-Telegram-Init-Data", ""),
        bot_token=settings.telegram_token,
        ttl_seconds=settings.init_data_ttl_seconds,
    )


def _collect_raw(nodes: tuple[CanonicalNode, ...]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def walk(node: CanonicalNode) -> None:
        if node.kind == "raw_markdown":
            out.append({"node_id": node.id, "reason": node.attrs.get("reason"), "text": node.text or ""})
        for child in node.children:
            walk(child)

    for node in nodes:
        walk(node)
    return out


def _review(source: str) -> dict[str, Any]:
    document = from_markdown(source)
    residual = _collect_raw(document.blocks)
    rendered = to_markdown(document)
    return {
        "original": source,
        "converted_document": document.to_dict(),
        "converted_markdown": rendered,
        "converted_text": to_text(document),
        "residual_raw_markdown": residual,
        "has_residual_raw_markdown": bool(residual),
        "lossless_visual_conversion": not residual,
        "roundtrip_markdown_equal": rendered.strip() == source.strip(),
    }


def _node_ids(document: CanonicalDocument) -> set[str]:
    ids: set[str] = set()
    def walk(node: CanonicalNode) -> None:
        ids.add(node.id)
        for child in node.children:
            walk(child)
    for block in document.blocks:
        walk(block)
    return ids


async def review_raw_markdown(request: web.Request) -> web.Response:
    _identity(request)
    payload = await request.json()
    source = str(payload.get("source") or "")
    return web.json_response({"ok": True, "review": _review(source)})


async def review_edited_conversion(request: web.Request) -> web.Response:
    """Re-evaluate a user-edited converted representation before output/apply-back."""
    _identity(request)
    payload = await request.json()
    original = str(payload.get("original") or "")
    edited = str(payload.get("converted_markdown") or "")
    original_review = _review(original)
    edited_review = _review(edited)

    original_doc = CanonicalDocument.from_dict(original_review["converted_document"])
    edited_doc = CanonicalDocument.from_dict(edited_review["converted_document"])
    original_ids = _node_ids(original_doc)
    edited_ids = _node_ids(edited_doc)

    changes: list[dict[str, Any]] = []
    if edited.strip() != str(original_review["converted_markdown"]).strip():
        changes.append({
            "kind": "converted_content_edited",
            "message": "O conteúdo convertido foi editado pelo usuário após a conversão inicial.",
        })
    if edited_review["has_residual_raw_markdown"]:
        changes.append({
            "kind": "residual_raw_markdown",
            "message": "A versão editada ainda contém trechos preservados como Markdown cru.",
        })
    if len(edited_ids) < len(original_ids):
        changes.append({
            "kind": "structure_reduced",
            "message": "A versão editada contém menos nós estruturais que a conversão inicial; confirme antes de substituir o documento principal.",
        })

    return web.json_response({
        "ok": True,
        "review": {
            **edited_review,
            "source_original": original,
            "initial_converted_markdown": original_review["converted_markdown"],
            "apply_back_changes": changes,
            "requires_apply_back_confirmation": bool(changes),
        },
    })


async def review_canonical_output(request: web.Request) -> web.Response:
    """Review an explicit canonical override without saving it to the draft."""
    _identity(request)
    payload = await request.json()
    document = CanonicalDocument.from_dict(dict(payload.get("document") or {}))
    residual = _collect_raw(document.blocks)
    return web.json_response({
        "ok": True,
        "review": {
            "converted_document": document.to_dict(),
            "converted_markdown": to_markdown(document),
            "converted_text": to_text(document),
            "residual_raw_markdown": residual,
            "has_residual_raw_markdown": bool(residual),
        },
    })


def attach_conversion_routes(app: web.Application) -> None:
    app.router.add_post("/api/conversion/raw-markdown/review", review_raw_markdown)
    app.router.add_post("/api/conversion/raw-markdown/review-edited", review_edited_conversion)
    app.router.add_post("/api/conversion/canonical/review", review_canonical_output)
