"""Ground-up MDTXTRT entrypoint.

The legacy ``app.py`` remains preserved. This entrypoint composes only the new
``mdtxtrt`` package and never imports ``main``.
"""
from aiohttp import web

from mdtxtrt.config import Settings
from mdtxtrt.server import create_web_app
from mdtxtrt.services import DocumentService, ImportService
from mdtxtrt.storage import SQLiteRepository


def build(settings: Settings | None = None) -> web.Application:
    resolved = settings or Settings.from_env()
    repository = SQLiteRepository(resolved.database_path)
    repository.initialize()
    documents = DocumentService(repository)
    imports = ImportService(repository, documents)
    return create_web_app(resolved, documents, imports)


def run() -> None:
    settings = Settings.from_env()
    web.run_app(build(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    run()
