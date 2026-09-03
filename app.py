"""Active MDTXTRT entrypoint for the canonical Rich 10.3 runtime."""
from aiohttp import web
import main
import runtime_v2

runtime_v2.install(main)


def build_web_app() -> web.Application:
    app = main.build_web_app()
    app.router.add_post("/api/share-telegraph", runtime_v2.api_share_telegraph)
    return app


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=main.PORT)
