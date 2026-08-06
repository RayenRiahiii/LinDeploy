from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0006_seed_k3s_template"),
    ]

    operations = [
        migrations.AddField(
            model_name="installation",
            name="cluster_config",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="installation",
            name="host_overrides",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
