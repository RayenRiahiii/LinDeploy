from celery import shared_task

from .mirror import run_automatic_mirror_prewarm
from .services import execute_installation


@shared_task(bind=True)
def run_installation_task(self, installation_id):
    return execute_installation(installation_id, task=self)


@shared_task
def debug_task():
    print("debug task executed")
    return "ok"


@shared_task(bind=True, name="auto_K8S.tasks.run_mirror_prewarm_task")
def run_mirror_prewarm_task(self, force=False):
    return run_automatic_mirror_prewarm(force=force)
