import base64
import hashlib
import json
from datetime import timedelta

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import OpenShiftSecretBundle


class OpenShiftSecretError(ValueError):
    pass


def _fernet():
    configured_key = settings.OPENSHIFT_SECRET_ENCRYPTION_KEY.strip()
    if configured_key:
        try:
            return Fernet(configured_key.encode("ascii"))
        except (TypeError, ValueError) as exc:
            raise OpenShiftSecretError(
                "OPENSHIFT_SECRET_ENCRYPTION_KEY must be a valid Fernet key."
            ) from exc

    derived = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def create_secret_bundle(payload):
    OpenShiftSecretBundle.objects.filter(expires_at__lte=timezone.now()).delete()
    encrypted = _fernet().encrypt(
        json.dumps(dict(payload), separators=(",", ":")).encode("utf-8")
    )
    return OpenShiftSecretBundle.objects.create(
        encrypted_payload=encrypted,
        expires_at=timezone.now()
        + timedelta(seconds=settings.OPENSHIFT_SECRET_TTL_SECONDS),
    )


def validate_secret_reference(reference):
    try:
        bundle = OpenShiftSecretBundle.objects.get(reference=reference)
    except (OpenShiftSecretBundle.DoesNotExist, ValueError) as exc:
        raise OpenShiftSecretError("OpenShift secret reference is invalid.") from exc
    if bundle.consumed_at is not None:
        raise OpenShiftSecretError("OpenShift secret reference was already consumed.")
    if bundle.expires_at <= timezone.now():
        bundle.delete()
        raise OpenShiftSecretError("OpenShift secret reference has expired.")
    return bundle


@transaction.atomic
def consume_secret_bundle(reference):
    try:
        bundle = OpenShiftSecretBundle.objects.select_for_update().get(reference=reference)
    except (OpenShiftSecretBundle.DoesNotExist, ValueError) as exc:
        raise OpenShiftSecretError("OpenShift secret reference is invalid.") from exc
    if bundle.consumed_at is not None or bundle.expires_at <= timezone.now():
        raise OpenShiftSecretError("OpenShift secret reference is unavailable or expired.")
    try:
        payload = json.loads(_fernet().decrypt(bytes(bundle.encrypted_payload)))
    except (InvalidToken, ValueError, TypeError) as exc:
        raise OpenShiftSecretError("OpenShift secret bundle could not be decrypted.") from exc
    bundle.consumed_at = timezone.now()
    bundle.save(update_fields=["consumed_at", "updated_at"])
    return bundle, payload


def destroy_secret_bundle(bundle):
    if bundle is not None:
        OpenShiftSecretBundle.objects.filter(reference=bundle.reference).delete()
