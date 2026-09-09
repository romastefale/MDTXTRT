"""Active MDTXTRT entrypoint for the canonical Rich 10.3 runtime."""
from aiohttp import web

import main
from canonical import CanonicalDocument
from runtime_contract import compose


def _canonical_markdown_export(source: str) -> str:
    """Exporta o documento canônico sem otimização destrutiva de Markdown."""
    return CanonicalDocument.from_markdown(source).markdown


SERVICES = compose(main, markdown_export=_canonical_markdown_export)


def build_web_app() -> web.Application:
    return main.build_web_app(SERVICES)


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=main.PORT)
