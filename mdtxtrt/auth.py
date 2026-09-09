"""Telegram Web App initData validation boundary."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
from urllib.parse import parse_qsl


@dataclass(frozen=True, slots=True)
class TelegramIdentity:
    user_id: int
    user: dict
    auth_date: int


class AuthError(ValueError):
    pass


def validate_init_data(
    init_data: str,
    *,
    bot_token: str,
    ttl_seconds: int = 3600,
    now: datetime | None = None,
) -> TelegramIdentity:
    if not init_data:
        raise AuthError("missing_init_data")

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", "")
    if not received_hash:
        raise AuthError("missing_hash")

    data_check_string = "\n".join(f"{key}={pairs[key]}" for key in sorted(pairs))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_hash, received_hash):
        raise AuthError("invalid_hash")

    try:
        auth_date = int(pairs["auth_date"])
    except (KeyError, ValueError) as exc:
        raise AuthError("invalid_auth_date") from exc

    current = now or datetime.now(timezone.utc)
    age = int(current.timestamp()) - auth_date
    if age < 0 or age > ttl_seconds:
        raise AuthError("expired_init_data")

    try:
        user = json.loads(pairs["user"])
        user_id = int(user["id"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise AuthError("invalid_user") from exc

    return TelegramIdentity(user_id=user_id, user=user, auth_date=auth_date)
