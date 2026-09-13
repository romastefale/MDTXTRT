"""Card do print: H6 bot, H3 @user #id, H5 data, H6 bio, botao Perfil."""

from __future__ import annotations

import html
import os

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

BRAND = (os.environ.get("INFOCARD_BOT") or "infocardrobot").lstrip("@")


def handle_line(p: dict) -> str:
    uid = p.get("id")
    uname = (p.get("username") or "").lstrip("@")
    if uname and uid is not None:
        return f"@{uname} #{uid}"
    if uid is not None:
        return f"#{uid}"
    if uname:
        return f"@{uname}"
    return ""


def profile_url(p: dict) -> str:
    uname = (p.get("username") or "").lstrip("@")
    if uname:
        return f"https://t.me/{uname}"
    if p.get("id") is not None:
        return f"tg://user?id={p['id']}"
    return ""


def rich_markdown(p: dict) -> str:
    lines = [f"###### @{BRAND}", ""]
    handle = handle_line(p)
    if handle:
        lines.append(f"### {handle}")
        lines.append("")
    if p.get("created"):
        lines.append(f"##### {p['created']}")
        lines.append("")
    bio = (p.get("bio") or "").strip()
    if bio:
        safe = bio.replace("\n", " ").strip()[:400]
        lines.append(f'###### "{safe}"')
    return "\n".join(lines).strip() + "\n"


def html_card(p: dict) -> str:
    parts = [f"<i>@{html.escape(BRAND)}</i>"]
    handle = handle_line(p)
    if handle:
        parts.append(f"<b>{html.escape(handle)}</b>")
    if p.get("created"):
        parts.append(html.escape(p["created"]))
    bio = (p.get("bio") or "").strip()
    if bio:
        parts.append(f'<i>"{html.escape(bio[:400])}"</i>')
    return "\n\n".join(parts)


def perfil_button(p: dict) -> InlineKeyboardMarkup | None:
    url = profile_url(p)
    if not url:
        return None
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Perfil", url=url)]]
    )
