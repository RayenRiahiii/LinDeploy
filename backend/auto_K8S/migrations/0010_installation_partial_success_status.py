from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0009_seed_k8s_full_uninstall_template"),
    ]

    operations = [
        migrations.AlterField(
            model_name="installation",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("running", "Running"),
                    ("success", "Success"),
                    ("partial_success", "Partial Success"),
                    ("failed", "Failed"),
                    ("cancelled", "Cancelled"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
    ]
