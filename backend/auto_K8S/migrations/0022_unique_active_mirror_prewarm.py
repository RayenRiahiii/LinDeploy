from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [("auto_K8S", "0021_mirror_profiles_and_jobs")]

    operations = [
        migrations.AddConstraint(
            model_name="mirrorprewarmjob",
            constraint=models.UniqueConstraint(
                fields=("dedupe_key",),
                condition=Q(state__in=("queued", "running", "verifying")),
                name="uniq_active_mirror_prewarm",
            ),
        )
    ]
