"""Explicit application composition with a closed dependency contract."""
from __future__ import annotations

from dataclasses import dataclass
from functools import partial
from typing import Any, Callable, MutableMapping

import dm_command_ui
import drafts
import map_location
import message_buttons
import preview_security
import rich_buttons
import rich_delivery
import rich_integrity
import rich_media
import rich_media_roundtrip
import rich_roundtrip
import runtime_v2
from runtime_ports import CoreRuntime


@dataclass(frozen=True)
class MessageService:
    reply_text: Callable
    send_rich_message: Callable
    mini_app_markup: Callable
    start: Callable
    help_cmd: Callable
    tgrich: Callable
    mdrich: Callable
    handle_document: Callable
    handle_webapp_data: Callable


@dataclass(frozen=True)
class MediaService:
    build_rich_message: Callable
    api_media: Callable
    serve_media: Callable


@dataclass(frozen=True)
class DraftService:
    api_stash: Callable
    api_load: Callable
    api_save: Callable
    dispatch_user_artifacts: Callable


@dataclass(frozen=True)
class TelegraphService:
    api_publish: Callable
    api_share: Callable


@dataclass(frozen=True)
class RoundtripService:
    rich_message_to_markdown: Callable


@dataclass(frozen=True)
class ApplicationServices:
    message_service: MessageService
    media_service: MediaService
    draft_service: DraftService
    telegraph_service: TelegraphService
    roundtrip_service: RoundtripService
    dispatcher_factory: Callable
    serve_index: Callable
    health: Callable
    map_request: Callable
    map_status: Callable
    map_send_location: Callable
    max_upload_bytes: int


@dataclass(frozen=True)
class CoreDependencies:
    """Exact legacy capabilities consumed by endpoint/handler adapters.

    Unlike the predecessor's ``_CoreDependencies``, this object has no dynamic
    fallback. A new dependency must be declared here and wired in ``_deps``.
    """

    MEDIA: MutableMapping[str, dict]
    STASH: MutableMapping[str, dict]
    STASH_TTL: int
    TOKEN: str
    log: Any
    ChatType: Any
    TelegramAPIError: type[Exception]
    init_data_from_request: Callable
    validate_init_data: Callable
    session_error: Callable
    purge_stash: Callable
    new_stash_code: Callable
    telegram_error_text: Callable
    build_rich_message: Callable
    reply_text: Callable
    mini_app_markup: Callable
    deliver_payload: Callable | None = None


def _deps(
    core: CoreRuntime,
    *,
    build_rich_message: Callable,
    reply_text: Callable,
    mini_app_markup: Callable,
    deliver_payload: Callable | None = None,
) -> CoreDependencies:
    return CoreDependencies(
        MEDIA=core.media,
        STASH=core.stash,
        STASH_TTL=core.stash_ttl,
        TOKEN=core.token,
        log=core.log,
        ChatType=core.chat_type,
        TelegramAPIError=core.telegram_api_error,
        init_data_from_request=core.init_data_from_request,
        validate_init_data=core.validate_init_data,
        session_error=core.session_error,
        purge_stash=core.purge_stash,
        new_stash_code=core.new_stash_code,
        telegram_error_text=core.telegram_error_text,
        build_rich_message=build_rich_message,
        reply_text=reply_text,
        mini_app_markup=mini_app_markup,
        deliver_payload=deliver_payload,
    )


class _RoundtripPipeline:
    """Projection pipeline whose delegation is explicit and instance-local."""

    _plain = staticmethod(rich_roundtrip._plain)
    _button_html = staticmethod(rich_roundtrip._button_html)

    def _text(self, value):
        return rich_integrity._inline_html(self, value)

    def _caption(self, value):
        return rich_integrity._caption_html(self, value)

    def _media_block(self, value):
        renderer = rich_media_roundtrip.decorate_block(self, rich_roundtrip._block)
        return renderer(value)

    def _block(self, value):
        return rich_integrity._block_html(self, value, self._media_block)

    def convert(self, rich):
        body = rich_roundtrip.render_with(self, rich)
        return rich_integrity.preserve_rtl(self, lambda _rich: body, rich)


def compose(
    core: CoreRuntime,
    *,
    markdown_export: Callable[[str], str],
) -> ApplicationServices:
    """Build the application from a closed set of runtime capabilities."""

    rich_builder = rich_media.create_build_rich_message(core.media)

    # Draft persistence wraps the Rich builder, but receives an explicit closed
    # capability object rather than the legacy module or a dynamic proxy.
    initial_deps = _deps(
        core,
        build_rich_message=rich_builder,
        reply_text=core.reply_text,
        mini_app_markup=lambda: None,
    )
    persistent_builder = partial(
        drafts.build_rich_message,
        initial_deps,
        rich_builder,
    )
    send_rich = rich_delivery.create_send_rich_message(persistent_builder)

    mini_app_markup, button_reply = message_buttons.create_message_ui(
        original_reply_text=core.reply_text,
        send_rich_message=send_rich,
        public_web_app_url=core.public_web_app_url,
        message_context=core.message_context,
        private_chat_type=core.chat_type.PRIVATE,
    )
    deps = _deps(
        core,
        build_rich_message=persistent_builder,
        reply_text=button_reply,
        mini_app_markup=mini_app_markup,
    )

    async def base_dispatch(bot, chat_id, title, content):
        body = (
            f"**{title}**\n\n{content}"
            if title and title != "Sem título"
            else content
        )
        await send_rich(bot, chat_id, body)

    dispatch = partial(drafts.dispatch_user_artifacts, base_dispatch)
    roundtrip = _RoundtripPipeline()

    async def deliver(bot, chat_id, action, title, content):
        if action == "mdrich":
            md_text = markdown_export(content)
            name = core.filename_from_markdown(md_text)
            if title and title != "Sem título":
                import re

                safe = re.sub(r'[\\/*?:"<>|]', "", title).strip()[:60]
                if safe:
                    name = safe
            await bot.send_document(
                chat_id=chat_id,
                document=core.buffered_input_file(
                    md_text.encode("utf-8"),
                    filename=f"{name}.md",
                ),
                caption=f"{name}.md",
            )
            return
        await dispatch(bot, chat_id, title, content)

    # Recursive command references are closed over local callables; no module
    # namespace is mutated and no dependency can be looked up dynamically.
    command_handlers = None

    core_tgrich = partial(
        core.tgrich,
        button_reply,
        send_rich,
        roundtrip.convert,
    )
    core_mdrich = partial(
        core.mdrich,
        button_reply,
        roundtrip.convert,
        markdown_export,
    )
    core_start = partial(
        core.start,
        button_reply,
        mini_app_markup,
        deliver,
    )
    core_help = partial(
        core.help_cmd,
        button_reply,
        mini_app_markup,
    )

    async def draft_start(message, bot, command):
        command_deps = _deps(
            core,
            build_rich_message=persistent_builder,
            reply_text=command_handlers["reply_text"],
            mini_app_markup=mini_app_markup,
            deliver_payload=deliver,
        )
        return await drafts.start(
            command_deps,
            core_start,
            message,
            bot,
            command,
        )

    command_handlers = dm_command_ui.create_command_handlers(
        previous_reply_text=button_reply,
        previous_start=draft_start,
        previous_help=core_help,
        previous_tgrich=core_tgrich,
        previous_mdrich=core_mdrich,
        mini_app_markup=mini_app_markup,
        private_chat_type=core.chat_type.PRIVATE,
    )

    base_media_api = partial(runtime_v2.api_media, deps)
    media_api = partial(drafts.api_media, deps, base_media_api)
    stash_api = partial(drafts.api_stash, deps, core.api_stash)
    document_handler = partial(
        core.handle_document,
        command_handlers["tgrich"],
        command_handlers["mdrich"],
    )
    webapp_handler = partial(
        core.handle_webapp_data,
        command_handlers["reply_text"],
        deliver,
        runtime_v2.publish_page_async,
    )

    message_service = MessageService(
        reply_text=command_handlers["reply_text"],
        send_rich_message=send_rich,
        mini_app_markup=mini_app_markup,
        start=command_handlers["start"],
        help_cmd=command_handlers["help_cmd"],
        tgrich=command_handlers["tgrich"],
        mdrich=command_handlers["mdrich"],
        handle_document=document_handler,
        handle_webapp_data=webapp_handler,
    )

    def dispatcher_factory():
        dispatcher = core.build_dispatcher(message_service)
        rich_buttons.register_handlers(dispatcher)
        dispatcher.message.register(
            partial(map_location.handle_location, deps),
            core.filters.location | core.filters.venue,
        )
        return dispatcher

    index = preview_security.decorate_serve_index(runtime_v2.serve_index)
    index = rich_buttons.decorate_serve_index(index)
    return ApplicationServices(
        message_service=message_service,
        media_service=MediaService(
            build_rich_message=persistent_builder,
            api_media=media_api,
            serve_media=partial(drafts.serve_media, deps),
        ),
        draft_service=DraftService(
            api_stash=stash_api,
            api_load=partial(drafts.api_draft_load, deps),
            api_save=partial(drafts.api_draft_save, deps),
            dispatch_user_artifacts=dispatch,
        ),
        telegraph_service=TelegraphService(
            api_publish=partial(runtime_v2.api_publish, deps),
            api_share=partial(runtime_v2.api_share_telegraph, deps),
        ),
        roundtrip_service=RoundtripService(roundtrip.convert),
        dispatcher_factory=dispatcher_factory,
        serve_index=index,
        health=partial(runtime_v2.health, core.health),
        map_request=partial(map_location.api_map_request, deps),
        map_status=partial(map_location.api_map_status, deps),
        map_send_location=partial(map_location.api_map_send_location, deps),
        max_upload_bytes=runtime_v2.MAX_MEDIA_BYTES,
    )
