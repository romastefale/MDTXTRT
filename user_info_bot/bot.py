"""Inline user-info: @bot @user ou @bot id. Perfil + foto publica."""

from __future__ import annotations

import html
import logging
import os
import re
import sys

import aiohttp
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart
from aiogram.types import (
    ChosenInlineResult,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InlineQuery,
    InlineQueryResultArticle,
    InlineQueryResultPhoto,
    InputTextMessageContent,
    Message,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("user_info")

TOKEN = (os.environ.get("USER_INFO_BOT_TOKEN") or os.environ.get("TELEGRAM_TOKEN") or "").strip()
UA = "Mozilla/5.0 (compatible; UserInfoBot/1.0)"
USERNAME_RE = re.compile(
    r"^(?:https?://)?(?:t\.me/|telegram\.me/)?@?([A-Za-z][A-Za-z0-9_]{3,31})$"
)
ID_RE = re.compile(r"^-?\d{5,20}$")
OG_TITLE = re.compile(
    r"property=[\"']og:title[\"']\s+content=[\"']([^\"']+)[\"']", re.I
)
OG_DESC = re.compile(
    r"property=[\"']og:description[\"']\s+content=[\"']([^\"']+)[\"']", re.I
)
OG_IMAGE = re.compile(
    r"property=[\"']og:image[\"']\s+content=[\"']([^\"']+)[\"']", re.I
)
OG_TITLE_REV = re.compile(
    r"content=[\"']([^\"']+)[\"']\s+property=[\"']og:title[\"']", re.I
)
OG_DESC_REV = re.compile(
    r"content=[\"']([^\"']+)[\"']\s+property=[\"']og:description[\"']", re.I
)
OG_IMAGE_REV = re.compile(
    r"content=[\"']([^\"']+)[\"']\s+property=[\"']og:image[\"']", re.I
)


def parse_query(raw: str) -> tuple[str | None, int | None]:
    q = (raw or "").strip()
    if not q:
        return None, None
    if ID_RE.fullmatch(q):
        return None, int(q)
    m = USERNAME_RE.fullmatch(q)
    if m:
        return m.group(1), None
    return None, None


async def fetch_public_page(username: str) -> dict:
    out = {"title": "", "bio": "", "photo": ""}
    headers = {"User-Agent": UA}
    urls = [f"https://t.me/{username}", f"https://t.me/s/{username}"]
    async with aiohttp.ClientSession(headers=headers) as session:
        for url in urls:
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status != 200:
                        continue
                    text = await resp.text(errors="ignore")
            except Exception:
                continue
            title = OG_TITLE.search(text) or OG_TITLE_REV.search(text)
            desc = OG_DESC.search(text) or OG_DESC_REV.search(text)
            image = OG_IMAGE.search(text) or OG_IMAGE_REV.search(text)
            if title:
                out["title"] = html.unescape(title.group(1)).strip()
            if desc:
                bio = html.unescape(desc.group(1)).strip()
                if bio and "Telegram" not in bio[:20]:
                    out["bio"] = bio
            if image:
                photo = html.unescape(image.group(1)).strip()
                if photo.startswith("http") and "t_logo" not in photo:
                    out["photo"] = photo
            if out["title"] or out["photo"]:
                break
    return out


async def api_profile(bot: Bot, username: str | None, user_id: int | None) -> dict:
    data = {
        "id": user_id,
        "username": username,
        "name": "",
        "bio": "",
        "type": "",
        "photo": "",
    }
    chat = None
    target = user_id if user_id is not None else (f"@{username}" if username else None)
    if target is not None:
        try:
            chat = await bot.get_chat(target)
        except Exception as exc:
            log.info("getChat falhou (%s): %s", target, exc)
    if chat:
        data["id"] = chat.id
        data["username"] = chat.username or username
        data["name"] = (
            " ".join(p for p in [chat.first_name, chat.last_name] if p) or chat.title or ""
        )
        data["bio"] = (chat.bio or chat.description or "").strip()
        data["type"] = chat.type
        file_id = None
        if chat.photo:
            file_id = chat.photo.big_file_id or chat.photo.small_file_id
        if not file_id and data["id"] and data["id"] > 0:
            try:
                photos = await bot.get_user_profile_photos(data["id"], limit=1)
                if photos.total_count and photos.photos:
                    file_id = photos.photos[0][-1].file_id
            except Exception as exc:
                log.info("getUserProfilePhotos falhou: %s", exc)
        if file_id:
            data["_file_id"] = file_id
    return data


def merge(api: dict, public: dict) -> dict:
    name = api.get("name") or public.get("title") or ""
    if name.lower().startswith("telegram: "):
        name = name.split(":", 1)[-1].strip()
    return {
        "id": api.get("id"),
        "username": api.get("username"),
        "name": name,
        "bio": api.get("bio") or public.get("bio") or "",
        "type": api.get("type") or "",
        "photo": public.get("photo") or "",
        "file_id": api.get("_file_id") or "",
    }


def profile_html(p: dict) -> str:
    uname = p.get("username") or ""
    name = html.escape(p.get("name") or uname or str(p.get("id") or "Perfil"))
    lines = [f"<b>{name}</b>"]
    if p.get("id") is not None:
        lines.append(f"ID: <code>{p['id']}</code>")
    if uname:
        lines.append(f"Username: @{html.escape(uname)}")
        lines.append(f"Link: https://t.me/{html.escape(uname)}")
    elif p.get("id") is not None:
        lines.append(f"Link: tg://user?id={p['id']}")
    if p.get("type"):
        lines.append(f"Tipo: {html.escape(str(p['type']))}")
    if p.get("bio"):
        lines.append("")
        lines.append(html.escape(p["bio"][:400]))
    if not p.get("photo") and not p.get("file_id"):
        lines.append("")
        lines.append("<i>Foto publica indisponivel.</i>")
    return "\n".join(lines)


def keyboard(p: dict) -> InlineKeyboardMarkup | None:
    uname = p.get("username") or ""
    if uname:
        return InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="Abrir perfil", url=f"https://t.me/{uname}")]
            ]
        )
    return None


async def resolve(bot: Bot, raw: str) -> dict | None:
    username, user_id = parse_query(raw)
    if username is None and user_id is None:
        return None
    public = (
        await fetch_public_page(username)
        if username
        else {"title": "", "bio": "", "photo": ""}
    )
    api = await api_profile(bot, username, user_id)
    profile = merge(api, public)
    if not profile["name"] and username:
        profile["name"] = username
    if profile["id"] is None and profile["username"] is None and not profile["photo"]:
        return None
    return profile


async def on_start(message: Message):
    await message.answer(
        "Inline.\n\n"
        "Em qualquer chat:\n"
        "\u2022 <code>@este_bot @username</code>\n"
        "\u2022 <code>@este_bot 123456789</code>\n\n"
        "Envia o perfil. Se a foto for publica, envia a foto tambem.",
        parse_mode=ParseMode.HTML,
    )


async def on_inline(inline_query: InlineQuery, bot: Bot):
    raw = (inline_query.query or "").strip()
    if not raw:
        await inline_query.answer(
            [
                InlineQueryResultArticle(
                    id="hint",
                    title="@username ou id",
                    description="Ex.: @durov ou 210987654",
                    input_message_content=InputTextMessageContent(
                        message_text="Digite @username ou o id depois do bot."
                    ),
                )
            ],
            cache_time=1,
            is_personal=True,
        )
        return

    profile = await resolve(bot, raw)
    if not profile:
        await inline_query.answer(
            [
                InlineQueryResultArticle(
                    id="miss",
                    title="Nao achei",
                    description="Username/id invalido ou perfil fechado.",
                    input_message_content=InputTextMessageContent(
                        message_text=f"Nao achei perfil publico para: {raw}"
                    ),
                )
            ],
            cache_time=5,
            is_personal=True,
        )
        return

    title = profile["name"] or profile.get("username") or str(profile.get("id"))
    text = profile_html(profile)
    bits = []
    if profile.get("username"):
        bits.append(f"@{profile['username']}")
    if profile.get("id") is not None:
        bits.append(f"ID {profile['id']}")
    results = [
        InlineQueryResultArticle(
            id="profile",
            title=title,
            description=" ".join(bits) or "Perfil publico",
            input_message_content=InputTextMessageContent(
                message_text=text,
                parse_mode=ParseMode.HTML,
                disable_web_page_preview=False,
            ),
            reply_markup=keyboard(profile),
            thumbnail_url=profile["photo"] or None,
        )
    ]
    if profile.get("photo"):
        results.append(
            InlineQueryResultPhoto(
                id="photo",
                photo_url=profile["photo"],
                thumbnail_url=profile["photo"],
                title=f"Foto de {title}",
                description="Foto de perfil publica",
                caption=text,
                parse_mode=ParseMode.HTML,
                reply_markup=keyboard(profile),
            )
        )
    await inline_query.answer(results, cache_time=20, is_personal=True)


async def on_chosen(chosen: ChosenInlineResult):
    log.info("enviado %s query=%s", chosen.result_id, chosen.query)


async def main():
    if not TOKEN:
        sys.exit("Defina USER_INFO_BOT_TOKEN")
    bot = Bot(TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.message.register(on_start, CommandStart())
    dp.inline_query.register(on_inline)
    dp.chosen_inline_result.register(on_chosen)
    me = await bot.get_me()
    log.info("inline pronto: @%s", me.username)
    await dp.start_polling(
        bot, allowed_updates=["message", "inline_query", "chosen_inline_result"]
    )


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
