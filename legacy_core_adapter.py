"""Single compatibility boundary from the legacy module to typed runtime ports."""
from __future__ import annotations

from runtime_ports import CoreRuntime


def adapt_legacy_main(main_module) -> CoreRuntime:
    """Snapshot the capabilities still supplied by ``main``.

    No composed service receives ``main_module`` itself. This adapter is the
    only place allowed to know legacy attribute names, making remaining
    migration debt explicit and searchable.
    """

    return CoreRuntime(
        media=main_module.MEDIA,
        stash=main_module.STASH,
        stash_ttl=main_module.STASH_TTL,
        token=main_module.TOKEN,
        log=main_module.log,
        chat_type=main_module.ChatType,
        filters=main_module.F,
        telegram_api_error=main_module.TelegramAPIError,
        buffered_input_file=main_module.BufferedInputFile,
        public_web_app_url=main_module.public_web_app_url,
        reply_text=main_module.reply_text,
        message_context=main_module._message_context,
        filename_from_markdown=main_module.filename_from_markdown,
        tgrich=main_module.tgrich,
        mdrich=main_module.mdrich,
        start=main_module.start,
        help_cmd=main_module.help_cmd,
        api_stash=main_module.api_stash,
        handle_document=main_module.handle_document,
        handle_webapp_data=main_module.handle_webapp_data,
        build_dispatcher=main_module.build_dispatcher,
        build_web_app=main_module.build_web_app,
        health=main_module.health,
        purge_stash=main_module.purge_stash,
        new_stash_code=main_module.new_stash_code,
        init_data_from_request=main_module.init_data_from_request,
        validate_init_data=main_module.validate_init_data,
        session_error=main_module.session_error,
        telegram_error_text=main_module.telegram_error_text,
        port=main_module.PORT,
    )
