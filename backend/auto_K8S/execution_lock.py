from contextlib import contextmanager

from django.db import OperationalError, transaction
from django.db.models import F
from rest_framework.exceptions import APIException

from .models import ExecutionMutex, InstallationTarget


class HostsBusy(APIException):
    status_code = 409
    default_detail = "Selected hosts are reserved, or another execution update is in progress. Retry shortly."


@contextmanager
def execution_transaction():
    """Acquire a DB write lock BEFORE reading reservations, including on SQLite.

    PostgreSQL serializes on this row; SQLite serializes writers. Keep this
    transaction short and never perform SSH or broker IO while holding it.
    """
    try:
        with transaction.atomic():
            if ExecutionMutex.objects.filter(pk=1).update(generation=F("generation") + 1) != 1:
                raise RuntimeError("Execution mutex missing: apply database migrations.")
            yield
    except OperationalError as exc:
        if "locked" in str(exc).lower() or "deadlock" in str(exc).lower():
            raise HostsBusy() from exc
        raise


def ensure_hosts_available(host_ids):
    if InstallationTarget.objects.filter(
        host_id__in=host_ids, installation__status__in=("pending", "running")
    ).exists():
        raise HostsBusy()
