"""Configuration boundary for the ground-up MDTXTRT runtime."""
from __future__ import annotations

from dataclasses import dataclass
import base64
import binascii
import os


@dataclass(frozen=True, slots=True)
class Settings:
    telegram_token: str
    database_path: str
    web_app_url: str
    telegraph_key: str = ""
    host: str = "0.0.0.0"
    port: int = 8080
    init_data_ttl_seconds: int = 3600

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.environ.get("TELEGRAM_TOKEN", "").strip()
        if not token:
            raise RuntimeError("TELEGRAM_TOKEN is required")
        return cls(
            telegram_token=token,
            database_path=os.environ.get("MDTXTRT_DATABASE", "mdtxtrt.sqlite3"),
            web_app_url=os.environ.get("WEB_APP_URL", "").strip(),
            telegraph_key=os.environ.get("MDTXTRT_TELEGRAPH_KEY", "").strip(),
            host=os.environ.get("HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", "8080")),
            init_data_ttl_seconds=int(os.environ.get("INIT_DATA_TTL_SECONDS", "3600")),
        )

    def telegraph_key_bytes(self) -> bytes:
        """Decode the externally supplied 256-bit key without persisting it."""
        if not self.telegraph_key:
            raise RuntimeError("MDTXTRT_TELEGRAPH_KEY is required for Telegraph publishing")
        raw = self.telegraph_key.encode("ascii")
        raw += b"=" * (-len(raw) % 4)
        try:
            key = base64.urlsafe_b64decode(raw)
        except (ValueError, binascii.Error, UnicodeError) as exc:
            raise RuntimeError("MDTXTRT_TELEGRAPH_KEY must be URL-safe base64") from exc
        if len(key) != 32:
            raise RuntimeError("MDTXTRT_TELEGRAPH_KEY must decode to exactly 32 bytes")
        return key
