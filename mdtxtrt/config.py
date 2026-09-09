"""Configuration boundary for the ground-up MDTXTRT runtime."""
from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True, slots=True)
class Settings:
    telegram_token: str
    database_path: str
    web_app_url: str
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
            host=os.environ.get("HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", "8080")),
            init_data_ttl_seconds=int(os.environ.get("INIT_DATA_TTL_SECONDS", "3600")),
        )
