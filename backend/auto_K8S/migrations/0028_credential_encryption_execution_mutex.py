from django.db import migrations, models
import auto_K8S.fields


def seed_mutex(apps, schema_editor):
    apps.get_model("auto_K8S", "ExecutionMutex").objects.using(schema_editor.connection.alias).get_or_create(pk=1)


class Migration(migrations.Migration):
    dependencies = [("auto_K8S", "0027_seed_k3s_multi_node_cleanup_template")]
    operations = [
        migrations.AlterField(model_name="credential", name=name,
                              field=auto_K8S.fields.EncryptedSecretField(blank=True))
        for name in ("password", "become_password", "private_key")
    ] + [
        migrations.CreateModel(name="ExecutionMutex", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("generation", models.BigIntegerField(default=0)),
        ]),
        migrations.RunPython(seed_mutex, migrations.RunPython.noop),
    ]
