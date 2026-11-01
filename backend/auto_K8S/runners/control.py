from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps

cancel_check = ContextVar("runner_cancel_check", default=None)
secret_values = ContextVar("runner_secret_values", default=())


class ProcessStopUnconfirmed(RuntimeError):
    pass


@contextmanager
def cancellation_scope(check):
    token = cancel_check.set(check)
    try:
        yield
    finally:
        cancel_check.reset(token)


def controlled_installation(function):
    @wraps(function)
    def wrapped(installation_id, *args, **kwargs):
        from ..models import Installation, Credential
        secrets = []
        for credential in Credential.objects.filter(hosts__installation_targets__installation_id=installation_id).distinct():
            secrets.extend((credential.password, credential.become_password, credential.private_key))
        def requested():
            return Installation.objects.filter(pk=installation_id).filter(cancel_requested=True).exists()
        token = secret_values.set(tuple(secrets))
        try:
            with cancellation_scope(requested):
                return function(installation_id, *args, **kwargs)
        finally:
            secret_values.reset(token)
    return wrapped
