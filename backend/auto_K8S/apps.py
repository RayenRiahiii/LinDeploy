from django.apps import AppConfig
from django.db.backends.signals import connection_created
from django.dispatch import receiver


@receiver(connection_created)
def configure_sqlite_pragmas(sender, connection, **kwargs):
    if connection.vendor == "sqlite":
        try:
            with connection.cursor() as cursor:
                cursor.execute("PRAGMA cache_size = -64000;")  # 64 MB page cache
                cursor.execute("PRAGMA mmap_size = 67108864;")  # 64 MB memory mapped I/O
                cursor.execute("PRAGMA temp_store = MEMORY;")
                cursor.execute("PRAGMA synchronous = NORMAL;")
        except Exception:
            pass


class AutoK8SConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "auto_K8S"
