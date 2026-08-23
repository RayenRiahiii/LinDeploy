from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0014_seed_k8s_multi_node_template"),
    ]

    operations = [
        migrations.AddField(
            model_name="installationtarget",
            name="cluster_name",
            field=models.CharField(blank=True, max_length=253),
        ),
    ]
