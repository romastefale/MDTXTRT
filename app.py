"""Active MDTXTRT entrypoint for the canonical Rich 10.3 runtime."""
from aiohttp import web

import main
import drafts
import map_location
import runtime_v2
from canonical import CanonicalDocument
from runtime_contract import compose


def _canonical_markdown_export(source: str) -> str:
    """Exporta o documento canônico sem otimização destrutiva de Markdown."""
    return CanonicalDocument.from_markdown(source).markdown


# O exportador faz parte do contrato: o núcleo não é mais alterado por atribuição
# lateral durante a importação de módulos.
main.bind_runtime(compose(main, markdown_export=_canonical_markdown_export))


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
