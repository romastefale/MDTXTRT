"""Encryption boundary for per-user external publishing credentials."""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_AAD = b"mdtxtrt:telegraph-token:v1"


class CredentialCipher:
    """AES-256-GCM envelope; the key is supplied by configuration only."""

    def __init__(self, key: bytes):
        if len(key) != 32:
            raise ValueError("credential cipher requires a 32-byte key")
        self._aes = AESGCM(key)

    def encrypt(self, value: str) -> str:
        if not value:
            raise ValueError("credential value is empty")
        nonce = os.urandom(12)
        ciphertext = self._aes.encrypt(nonce, value.encode("utf-8"), _AAD)
        return base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")

    def decrypt(self, envelope: str) -> str:
        try:
            raw = base64.urlsafe_b64decode(envelope.encode("ascii"))
        except Exception as exc:
            raise ValueError("invalid credential envelope") from exc
        if len(raw) < 29:
            raise ValueError("invalid credential envelope")
        plaintext = self._aes.decrypt(raw[:12], raw[12:], _AAD)
        return plaintext.decode("utf-8")
