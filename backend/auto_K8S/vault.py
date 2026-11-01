import base64
import hashlib
import logging
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

logger = logging.getLogger(__name__)

PREFIX = "enc:v1:"


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

    # Fallback to derivation from Django SECRET_KEY
    derived = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a secret string using Fernet, adding an enc:v1: prefix."""
    if not plaintext:
        return ""
    if plaintext.startswith(PREFIX):
        return plaintext
    fernet = _get_fernet()
    encrypted_bytes = fernet.encrypt(plaintext.encode("utf-8"))
    return f"{PREFIX}{encrypted_bytes.decode('ascii')}"


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a secret string. Plaintext values without prefix are returned as-is."""
    if not ciphertext:
        return ""
    if not ciphertext.startswith(PREFIX):
        return ciphertext
    token = ciphertext[len(PREFIX):]
    fernet = _get_fernet()
    try:
        decrypted_bytes = fernet.decrypt(token.encode("ascii"))
        return decrypted_bytes.decode("utf-8")
    except (InvalidToken, ValueError, TypeError) as exc:
        raise CredentialEncryptionError(
            "Failed to decrypt credential secret: key mismatch or corrupted secret."
        ) from exc


def is_encrypted(value: str) -> bool:
    return bool(value and value.startswith(PREFIX))
