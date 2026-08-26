"""Symmetric encryption helpers for secrets stored at rest.

User secrets such as AI provider API keys (Claude or OpenAI-compatible) are encrypted
with :class:`cryptography.fernet.Fernet` before they ever touch the database. Only the
ciphertext is persisted, so a database dump (or anyone with read access to it) reveals
nothing usable. Decryption is only possible with the application's ``ENCRYPTION_KEY``,
which lives outside the database.

The configured ``ENCRYPTION_KEY`` is treated as a passphrase: we derive a 32-byte Fernet key
from its SHA-256 digest so any string works, while a freshly generated Fernet key is equally
valid.
"""

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


@lru_cache
def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.encryption_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str) -> str:
    """Encrypt ``plaintext`` and return a urlsafe-base64 Fernet token (text)."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> str:
    """Decrypt a Fernet token produced by :func:`encrypt_secret`.

    Raises :class:`cryptography.fernet.InvalidToken` if the token is corrupt or was
    encrypted with a different key.
    """
    return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")


__all__ = ["encrypt_secret", "decrypt_secret", "InvalidToken"]
