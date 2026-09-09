"""Isolamento dos adaptadores legados usados pelo processo de produção.

As extensões históricas recebem um alvo configurável.  Esse alvo é privado ao
builder: nenhum módulo-alvo é sobrescrito durante a composição. O resultado é
um contrato fechado, validado antes de ser entregue ao entrypoint. Os adaptadores
ainda usam mutação internamente; este módulo a contém, mas não afirma eliminá-la.
"""

from __future__ import annotations

from types import MappingProxyType, SimpleNamespace
from typing import Any, Mapping

import dm_command_ui
import drafts
import map_location
import message_buttons
import preview_security
import rich_buttons
import rich_delivery
import rich_integrity
import rich_media
import rich_media_roundtrip
import rich_roundtrip
import runtime_v2


# Estas são as únicas substituições que o núcleo aceita. Manter a lista aqui
# torna falhas de integração visíveis no arranque em vez de depender da ordem
# acidental de imports ou de atributos adicionados silenciosamente a ``main``.
RUNTIME_BINDINGS = (
    "MAX_PHOTO_BYTES",
    "api_media",
    "api_publish",
    "api_stash",
    "build_dispatcher",
    "build_rich_message",
    "dispatch_user_artifacts",
    "health",
    "help_cmd",
    "mdrich",
    "mini_app_markup",
    "optimize_markdown",
    "reply_text",
    "rich_message_to_markdown",
    "send_rich_message",
    "serve_index",
    "serve_media",
    "start",
    "tgrich",
)


class RuntimeContract:
    """Visão somente-leitura das dependências compostas da aplicação."""

    __slots__ = ("_values",)

    def __init__(self, values: Mapping[str, Any]) -> None:
        missing = [name for name in RUNTIME_BINDINGS if name not in values]
        if missing:
            raise RuntimeError(
                "Contrato de runtime incompleto: " + ", ".join(sorted(missing))
            )
        self._values = MappingProxyType(dict(values))

    def __getattr__(self, name: str) -> Any:
        try:
            return self._values[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def bindings(self) -> Mapping[str, Any]:
        return self._values


def compose(base_module, *, markdown_export) -> RuntimeContract:
    """Monta o runtime sem escrever em ``base_module`` ou nos módulos rich."""

    target = SimpleNamespace(**vars(base_module))
    target.optimize_markdown = markdown_export
    roundtrip = SimpleNamespace(**vars(rich_roundtrip))

    # A ordem é deliberada: cada adaptador recebe o contrato produzido pela
    # etapa anterior, mas altera somente os namespaces privados do builder.
    runtime_v2.install(target)
    rich_media.install(target)
    drafts.install(target)
    preview_security.install(target)
    rich_delivery.install(target)
    rich_roundtrip.install(target)
    roundtrip.rich_message_to_markdown = target.rich_message_to_markdown
    rich_media_roundtrip.install(roundtrip)
    rich_integrity.install(target, roundtrip)
    rich_buttons.install(target, roundtrip)
    message_buttons.install(target)
    dm_command_ui.install(target)
    map_location.install(target)

    return RuntimeContract({name: getattr(target, name) for name in RUNTIME_BINDINGS})
