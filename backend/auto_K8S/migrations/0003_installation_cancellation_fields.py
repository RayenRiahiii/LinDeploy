from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0002_installation_execution_fields_and_roles"),
    ]

    operations = [
        migrations.AddField(
            model_name="installation",
            name="cancel_requested",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="installation",
            name="runner_pid",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="installation",
            name="phase",
            field=models.CharField(
                choices=[
                    ("queued", "Queued"),
                    ("ssh_check", "SSH Check"),
                    ("running_playbook", "Running Playbook"),
                    ("finalizing", "Finalizing"),
                    ("completed", "Completed"),
                    ("failed", "Failed"),
                    ("cancelled", "Cancelled"),
                ],
                default="queued",
                max_length=30,
            ),
        ),
        migrations.AlterField(
            model_name="installation",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("running", "Running"),
                    ("success", "Success"),
                    ("failed", "Failed"),
                    ("cancelled", "Cancelled"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="installationtarget",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("running", "Running"),
                    ("success", "Success"),
                    ("failed", "Failed"),
                    ("cancelled", "Cancelled"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
    ]
