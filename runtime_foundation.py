"""Contratos mínimos usados na composição do runtime."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from aiohttp import web


@dataclass(frozen=True)
class AuthService:
    init_data: Callable
    validate: Callable
    error_response: Callable

    def user(self, data, request: web.Request):
        raw = self.init_data(data, request)
        return raw, self.validate(raw)


@dataclass(frozen=True)
class MediaState:
    items: dict
    stash: dict
    ttl_seconds: int
    purge: Callable
    new_code: Callable
