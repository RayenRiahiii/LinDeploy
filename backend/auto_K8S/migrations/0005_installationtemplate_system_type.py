from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("auto_K8S", "0004_host_baseline_state"),
    ]

    operations = [
        migrations.AddField(
            model_name="installationtemplate",
            name="system_type",
            field=models.CharField(
                choices=[
                    ("kubernetes", "Kubernetes"),
                    ("k3s", "K3s"),
                    ("openshift_sno", "OpenShift SNO"),
                ],
                default="kubernetes",
                max_length=30,
            ),
        ),
    ]
