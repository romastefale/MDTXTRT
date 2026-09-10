"""Active MDTXTRT entrypoint with explicit runtime composition."""
from aiohttp import web

from main import PORT
from runtime_composition import build_web_app


if __name__ == "__main__":
    web.run_app(build_web_app(), host="0.0.0.0", port=PORT)
