from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="host",
            name="node_role",
            field=models.CharField(
                choices=[
                    ("standalone", "Standalone"),
                    ("control_plane", "Control Plane"),
                    ("worker", "Worker"),
                ],
                default="standalone",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="installationtemplate",
            name="deployment_type",
            field=models.CharField(
                choices=[
                    ("prepare_node", "Prepare Node"),
                    ("single_node", "Single Node"),
                ],
                default="single_node",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="installation",
            name="bottleneck_hints",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="installation",
            name="celery_task_id",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="installation",
            name="command",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="installation",
            name="connectivity",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="installation",
            name="inventory_content",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
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
                ],
                default="queued",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="installation",
            name="progress",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="installation",
            name="return_code",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="installation",
            name="stderr",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="installation",
            name="stdout",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="installation",
            name="summary_message",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="installation",
            name="task_profile",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="installation",
            name="timings",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="installationtarget",
            name="return_code",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="installationtarget",
            name="stderr",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="installationtarget",
            name="stdout",
            field=models.TextField(blank=True),
        ),
        migrations.AlterModelOptions(
            name="host",
            options={"ordering": ("name",)},
        ),
    ]
