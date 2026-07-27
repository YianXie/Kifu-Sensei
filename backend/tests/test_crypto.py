import base64
import hashlib

import pytest
from cryptography.fernet import Fernet, InvalidToken

from app.crypto import decrypt_secret, encrypt_secret


def test_roundtrip_returns_the_original_plaintext() -> None:
    secret = "sk-ant-api03-not-a-real-key"
    assert decrypt_secret(encrypt_secret(secret)) == secret


def test_ciphertext_does_not_contain_the_plaintext() -> None:
    """The database must never hold anything resembling the key."""
    secret = "sk-ant-api03-not-a-real-key"
    token = encrypt_secret(secret)
    assert secret not in token


def test_encryption_is_non_deterministic() -> None:
    """Fernet embeds a random IV, so equal keys must not produce equal ciphertext."""
    assert encrypt_secret("same-input") != encrypt_secret("same-input")


@pytest.mark.parametrize(
    "plaintext",
    ["", "a", "unicode — em dash ✓ 囲碁", "x" * 5000],
)
def test_roundtrip_handles_edge_case_payloads(plaintext: str) -> None:
    assert decrypt_secret(encrypt_secret(plaintext)) == plaintext


def test_decrypting_a_corrupt_token_raises() -> None:
    with pytest.raises(InvalidToken):
        decrypt_secret("not-a-fernet-token")


def test_decrypting_with_a_different_key_raises() -> None:
    """A dump encrypted under another ENCRYPTION_KEY must not be readable."""
    other_digest = hashlib.sha256(b"a-completely-different-key").digest()
    other = Fernet(base64.urlsafe_b64encode(other_digest))
    foreign_token = other.encrypt(b"secret").decode("utf-8")

    with pytest.raises(InvalidToken):
        decrypt_secret(foreign_token)


def test_arbitrary_passphrases_are_accepted_as_keys() -> None:
    """``ENCRYPTION_KEY`` is a passphrase, not a raw Fernet key.

    The test settings deliberately use a non-base64 value, so a working roundtrip
    here is the evidence that the SHA-256 derivation in ``_fernet`` is in play.
    """
    assert decrypt_secret(encrypt_secret("value")) == "value"
