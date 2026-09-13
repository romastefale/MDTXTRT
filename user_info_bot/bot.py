"""Inline user-info. Consulta only."""

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
    InlineQuery,
    InlineQueryResultArticle,
    InlineQueryResultPhoto,
    InputTextMessageContent,
    Message,
)

from ages import estimate_created
from card import BRAND, html_card, perfil_button, rich_markdown
import mtproto

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("user_info")

TOKEN = (os.environ.get("USER_INFO_BOT_TOKEN") or os.environ.get("TELEGRAM_TOKEN") or "").strip()
UA = "Mozilla/5.0 (compatible; UserInfoBot/1.0)"
USERNAME_RE = re.compile(
    r"^(?:https?://)?(?:t\.me/|telegram\.me/)?@?([A-Za-z][A-Za-z0-9_]{3,31})$"
)
ID_RE = re.compile(r"^-?\d{5,20}$")
OG_TITLE = re.compile(r"property=[\"']og:title[\"']\s+content=[\"']([^\"']+)[\"']", re.I)
OG_DESC = re.compile(
    r"property=[\"']og:description[\"']\s+content=[\"']([^\"']+)[\"']", re.I
)
OG_IMAGE = re.compile(r"property=[\"']og:image[\"']\s+content=[\"']([^\"']+)[\"']", re.I)
OG_TITLE_REV = re.compile(r"content=[\"']([^\"']+)[\"']\s+property=[\"']og:title[\"']", re.I)
OG_DESC_REV = re.compile(
    r"content=[\"']([^\"']+)[\"']\s+property=[\"']og:description[\"']", re.I
)
OG_IMAGE_REV = re.compile(r"content=[\"']([^\"']+)[\"']\s+property=[\"']og:image[\"']", re.I)


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


async def bot_profile(bot: Bot, username: str | None, user_id: int | None) -> dict:
    data = {"id": user_id, "username": username, "name": "", "bio": "", "type": ""}
    target = user_id if user_id is not None else (f"@{username}" if username else None)
    if target is None:
        return data
    try:
        chat = await bot.get_chat(target)
    except Exception as exc:
        log.info("getChat falhou (%s): %s", target, exc)
        return data
    data["id"] = chat.id
    data["username"] = chat.username or username
    data["name"] = (
        " ".join(p for p in [chat.first_name, chat.last_name] if p) or chat.title or ""
    )
    data["bio"] = (chat.bio or chat.description or "").strip()
    data["type"] = str(chat.type or "")
    return data


def pick(*vals: str | None) -> str:
    for v in vals:
        if v:
            return v
    return ""


async def resolve(bot: Bot, raw: str) -> dict | None:
    username, user_id = parse_query(raw)
    if username is None and user_id is None:
        return None
    public = await fetch_public_page(username) if username else {}
    api = await bot_profile(bot, username, user_id)
    mt = await mtproto.resolve(username, user_id or api.get("id"))
    name = pick(mt.get("name"), api.get("name"), public.get("title"), username)
    if name.lower().startswith("telegram: "):
        name = name.split(":", 1)[-1].strip()
    uid = mt.get("id") or api.get("id") or user_id
    uname = pick(mt.get("username"), api.get("username"), username)
    profile = {
        "id": uid,
        "username": uname,
        "name": name,
        "bio": pick(mt.get("bio"), api.get("bio"), public.get("bio")),
        "photo": public.get("photo") or "",
        "created": estimate_created(uid if isinstance(uid, int) else None),
    }
    if not profile["name"] and not profile["username"] and profile["id"] is None:
        return None
    return profile


def article_content(p: dict):
    try:
        from aiogram.types import InputRichMessage

        return InputRichMessage(markdown=rich_markdown(p))
    except Exception:
        return InputTextMessageContent(
            message_text=html_card(p),
            parse_mode=ParseMode.HTML,
            disable_web_page_preview=True,
        )


async def on_start(message: Message):
    await message.answer(
        f"Consulta inline.\n\n<code>@{BRAND} @username</code>\n<code>@{BRAND} 123456789</code>"
    )


async def on_inline(inline_query: InlineQuery, bot: Bot):
    raw = (inline_query.query or "").strip()
    if not raw:
        await inline_query.answer(
            [
                InlineQueryResultArticle(
                    id="hint",
                    title="@username ou id",
                    input_message_content=InputTextMessageContent(
                        message_text="Digite @username ou o id."
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
                    input_message_content=InputTextMessageContent(
                        message_text=f"Nao achei: {raw}"
                    ),
                )
            ],
            cache_time=5,
            is_personal=True,
        )
        return
    title = profile.get("username") or profile.get("name") or str(profile.get("id"))
    markup = perfil_button(profile)
    content = article_content(profile)
    results = []
    if profile.get("photo"):
        results.append(
            InlineQueryResultPhoto(
                id="card-photo",
                photo_url=profile["photo"],
                thumbnail_url=profile["photo"],
                title=title,
                caption=html_card(profile),
                parse_mode=ParseMode.HTML,
                reply_markup=markup,
            )
        )
    results.append(
        InlineQueryResultArticle(
            id="card",
            title=title,
            description=profile.get("created") or "Perfil",
            input_message_content=content,
            reply_markup=markup,
            thumbnail_url=profile.get("photo") or None,
        )
    )
    await inline_query.answer(results, cache_time=20, is_personal=True)


async def main():
    if not TOKEN:
        sys.exit("Defina USER_INFO_BOT_TOKEN")
    await mtproto.start()
    bot = Bot(TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.message.register(on_start, CommandStart())
    dp.inline_query.register(on_inline)
    me = await bot.get_me()
    log.info("inline: @%s brand=@%s", me.username, BRAND)
    try:
        await dp.start_polling(bot, allowed_updates=["message", "inline_query"])
    finally:
        await mtproto.stop()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
