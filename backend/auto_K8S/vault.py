import base64
import hashlib
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

PREFIX = "enc:v2:"
LEGACY_PREFIX = "enc:v1:"


class CredentialEncryptionError(Exception):
    pass


def _get_fernet():
    configured_key = getattr(settings, "LINDEPLOY_CREDENTIAL_KEY", "").strip()
    if configured_key:
        try:
            return Fernet(configured_key.encode("ascii"))
        except (TypeError, ValueError) as exc:
            raise CredentialEncryptionError(
                "LINDEPLOY_CREDENTIAL_KEY is not a valid Fernet key."
            ) from exc

    raise CredentialEncryptionError("Configure LINDEPLOY_CREDENTIAL_KEY before writing credentials.")


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a secret string using Fernet, adding an enc:v2: prefix."""
    if not plaintext:
        return ""
    fernet = _get_fernet()
    encrypted_bytes = fernet.encrypt(plaintext.encode("utf-8"))
    return f"{PREFIX}{encrypted_bytes.decode('ascii')}"


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a secret string. Plaintext values without prefix are returned as-is."""
    if not ciphertext:
        return ""
    if not is_encrypted(ciphertext):
        return ciphertext
    legacy = ciphertext.startswith(LEGACY_PREFIX)
    prefix = LEGACY_PREFIX if legacy else PREFIX
    keys = []
    if getattr(settings, "LINDEPLOY_CREDENTIAL_KEY", "").strip():
        keys.append(_get_fernet())
    if legacy:
        derived = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
        keys.append(Fernet(base64.urlsafe_b64encode(derived)))
    for fernet in keys:
        try:
            return fernet.decrypt(ciphertext[len(prefix):].encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError, TypeError, UnicodeError):
            continue
    raise CredentialEncryptionError("Failed to decrypt credential: missing key, key mismatch or corrupted data.")


def is_encrypted(value: str) -> bool:
    return bool(value and value.startswith((PREFIX, LEGACY_PREFIX)))
