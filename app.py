"""Active MDTXTRT entrypoint for the canonical Rich 10.3 runtime."""
from aiohttp import web
import main
import runtime_v2

runtime_v2.install(main)

if __name__ == "__main__":
    web.run_app(main.build_web_app(), host="0.0.0.0", port=main.PORT)
