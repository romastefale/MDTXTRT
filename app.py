"""Active MDTXTRT entrypoint for the canonical Rich 10.3 runtime."""
from aiohttp import web

from canonical import CanonicalDocument
import main
import runtime_v2

runtime_v2.install(main)


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
    return app


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=main.PORT)
