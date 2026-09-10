"""Production entrypoint for the MDTXTRT ground-up architecture."""
from __future__ import annotations

from aiohttp import web

from mdtxtrt.assets import AssetService
from mdtxtrt.bot import TelegramRuntime
from mdtxtrt.config import Settings
from mdtxtrt.conversion_workflow import attach_conversion_routes
from mdtxtrt.credentials import CredentialCipher
from mdtxtrt.lifecycle import attach_lifecycle_routes
from mdtxtrt.pending_imports import PendingImportStore
from mdtxtrt.publishing import TelegramPublicationService, TelegraphPublicationService
from mdtxtrt.server import create_web_app
from mdtxtrt.services import DocumentService, ImportService
from mdtxtrt.storage import SQLiteRepository


def build_application(settings: Settings | None = None) -> web.Application:
    resolved = settings or Settings.from_env()
    repository = SQLiteRepository(resolved.database_path)
    repository.initialize()

    assets = AssetService(repository)
    assets.initialize()
    pending_imports = PendingImportStore(repository)
    pending_imports.initialize()
    documents = DocumentService(repository)
    imports = ImportService(repository, documents, pending_imports)
    telegram_publications = TelegramPublicationService(repository, assets)
    telegraph_publications = None
    if resolved.telegraph_key:
        telegraph_publications = TelegraphPublicationService(
            repository,
            CredentialCipher(resolved.telegraph_key_bytes()),
        )
    telegram_runtime = TelegramRuntime(resolved, imports, assets)

    app = create_web_app(
        resolved,
        documents,
        imports,
        repository,
        assets,
        telegram_publications,
        telegraph_publications,
        telegram_runtime,
    )
    attach_lifecycle_routes(app)
    attach_conversion_routes(app)
    return app


if __name__ == "__main__":
    settings = Settings.from_env()
    web.run_app(build_application(settings), host=settings.host, port=settings.port)
