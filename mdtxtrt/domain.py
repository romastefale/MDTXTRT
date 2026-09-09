"""Structured canonical document model for the rebuilt runtime."""
from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any, Iterable
from uuid import uuid4

JSONScalar = str | int | float | bool | None
JSONValue = JSONScalar | list["JSONValue"] | dict[str, "JSONValue"]


def _json_copy(value: JSONValue) -> JSONValue:
    return json.loads(json.dumps(value, ensure_ascii=False))


@dataclass(frozen=True, slots=True)
class CanonicalNode:
    id: str
    kind: str
    text: str | None = None
    attrs: dict[str, JSONValue] = field(default_factory=dict)
    children: tuple["CanonicalNode", ...] = ()

    def __post_init__(self) -> None:
        if not self.id or not self.kind:
            raise ValueError("canonical node requires id and kind")
        object.__setattr__(self, "attrs", _json_copy(self.attrs))
        object.__setattr__(self, "children", tuple(self.children))

    @classmethod
    def create(
        cls,
        kind: str,
        *,
        text: str | None = None,
        attrs: dict[str, JSONValue] | None = None,
        children: Iterable["CanonicalNode"] = (),
    ) -> "CanonicalNode":
        return cls(str(uuid4()), kind, text, attrs or {}, tuple(children))

    def to_dict(self) -> dict[str, JSONValue]:
        return {
            "id": self.id,
            "kind": self.kind,
            "text": self.text,
            "attrs": _json_copy(self.attrs),
            "children": [child.to_dict() for child in self.children],
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "CanonicalNode":
        return cls(
            id=str(payload["id"]),
            kind=str(payload["kind"]),
            text=payload.get("text"),
            attrs=dict(payload.get("attrs") or {}),
            children=tuple(cls.from_dict(item) for item in payload.get("children", [])),
        )


@dataclass(frozen=True, slots=True)
class CanonicalDocument:
    id: str
    schema_version: int
    blocks: tuple[CanonicalNode, ...]
    metadata: dict[str, JSONValue] = field(default_factory=dict)

    CURRENT_SCHEMA_VERSION = 1

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("document id is required")
        if self.schema_version != self.CURRENT_SCHEMA_VERSION:
            raise ValueError(f"unsupported canonical schema {self.schema_version}")
        object.__setattr__(self, "blocks", tuple(self.blocks))
        object.__setattr__(self, "metadata", _json_copy(self.metadata))

    @classmethod
    def empty(cls) -> "CanonicalDocument":
        return cls(str(uuid4()), cls.CURRENT_SCHEMA_VERSION, (), {})

    def to_dict(self) -> dict[str, JSONValue]:
        return {
            "id": self.id,
            "schema_version": self.schema_version,
            "blocks": [block.to_dict() for block in self.blocks],
            "metadata": _json_copy(self.metadata),
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "CanonicalDocument":
        return cls(
            id=str(payload["id"]),
            schema_version=int(payload["schema_version"]),
            blocks=tuple(CanonicalNode.from_dict(item) for item in payload.get("blocks", [])),
            metadata=dict(payload.get("metadata") or {}),
        )

    @classmethod
    def from_json(cls, source: str) -> "CanonicalDocument":
        payload = json.loads(source)
        if not isinstance(payload, dict):
            raise ValueError("canonical document must be a JSON object")
        return cls.from_dict(payload)
