from celery import shared_task

from .services import execute_installation


@shared_task(bind=True)
def run_installation_task(self, installation_id):
    return execute_installation(installation_id, task=self)


@shared_task
def debug_task():
    print("debug task executed")
    return "ok"
