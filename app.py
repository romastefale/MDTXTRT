"""Active MDTXTRT entrypoint for the canonical Rich 10.3 runtime."""
from aiohttp import web

from canonical import CanonicalDocument
import dm_command_ui
import drafts
import main
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

runtime_v2.install(main)
rich_media.install(main)
drafts.install(main)
preview_security.install(main)
rich_delivery.install(main)
rich_roundtrip.install(main)
rich_media_roundtrip.install(rich_roundtrip)
rich_integrity.install(main, rich_roundtrip)
rich_buttons.install(main, rich_roundtrip)
message_buttons.install(main)
dm_command_ui.install(main)
map_location.install(main)


def _canonical_markdown_export(source: str) -> str:
    """Exporta o documento canônico sem otimização destrutiva de Markdown."""
    return CanonicalDocument.from_markdown(source).markdown


# deliver_payload() resolve este nome no módulo main em tempo de execução.
# Assim o .md usa a mesma fonte canônica do Telegram/Telegraph, sem strip,
# remoção de escapes, compactação de linhas vazias ou alteração de espaços finais.
main.optimize_markdown = _canonical_markdown_export


def build_web_app() -> web.Application:
    app = main.build_web_app()
    app.router.add_post("/api/share-telegraph", runtime_v2.api_share_telegraph)
    app.router.add_post("/api/draft/load", drafts.api_draft_load)
    app.router.add_post("/api/draft/save", drafts.api_draft_save)
    app.router.add_post("/api/map/request", map_location.api_map_request)
    app.router.add_post("/api/map/status", map_location.api_map_status)
    app.router.add_post("/api/map/send-location", map_location.api_map_send_location)
    return app


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=main.PORT)
