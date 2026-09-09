"""Active MDTXTRT entrypoint with an explicit legacy boundary."""
from aiohttp import web

import main
from canonical import CanonicalDocument
from legacy_core_adapter import adapt_legacy_main
from runtime_contract import compose


def _canonical_markdown_export(source: str) -> str:
    """Export the canonical source without destructive Markdown optimization."""
    return CanonicalDocument.from_markdown(source).markdown


CORE = adapt_legacy_main(main)
SERVICES = compose(CORE, markdown_export=_canonical_markdown_export)


def build_web_app() -> web.Application:
    return CORE.build_web_app(SERVICES)


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=CORE.port)
