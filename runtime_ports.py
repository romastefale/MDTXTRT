"""Typed runtime ports for the explicit-composition architecture.

This module is deliberately independent from ``main``. The legacy module is
adapted once at the process boundary; application composition receives this
closed set of capabilities instead of an open-ended module proxy.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, MutableMapping


@dataclass(frozen=True)
class CoreRuntime:
    """Closed capability set consumed by the composed runtime.

    Values such as aiogram filters/classes are intentionally represented as
    external objects, but every dependency is named here. Adding a new core
    dependency therefore requires an explicit contract change.
    """

    media: MutableMapping[str, dict]
    stash: MutableMapping[str, dict]
    stash_ttl: int
    token: str
    log: Any
    chat_type: Any
    filters: Any
    telegram_api_error: type[Exception]
    buffered_input_file: type
    public_web_app_url: str

    reply_text: Callable
    message_context: Callable
    filename_from_markdown: Callable
    tgrich: Callable
    mdrich: Callable
    start: Callable
    help_cmd: Callable
    api_stash: Callable
    handle_document: Callable
    handle_webapp_data: Callable
    build_dispatcher: Callable
    build_web_app: Callable
    health: Callable
    purge_stash: Callable
    new_stash_code: Callable
    init_data_from_request: Callable
    validate_init_data: Callable
    session_error: Callable
    telegram_error_text: Callable
    port: int
