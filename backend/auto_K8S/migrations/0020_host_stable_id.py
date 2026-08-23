import uuid

from django.db import migrations, models


def populate_host_stable_ids(apps, schema_editor):
    host_model = apps.get_model("auto_K8S", "Host")
    for host in host_model.objects.filter(stable_id__isnull=True).iterator():
        host.stable_id = uuid.uuid4()
        host.save(update_fields=["stable_id"])


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0019_seed_openshift_disconnected_templates"),
    ]

    operations = [
        migrations.AddField(
            model_name="host",
            name="stable_id",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.RunPython(populate_host_stable_ids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="host",
            name="stable_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
