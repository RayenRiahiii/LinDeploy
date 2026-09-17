from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0003_installation_cancellation_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="host",
            name="baseline_facts",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="host",
            name="baseline_state",
            field=models.CharField(
                choices=[
                    ("unknown", "Unknown"),
                    ("fresh", "Fresh"),
                    ("prepared", "Prepared"),
                    ("initialized", "Initialized"),
                ],
                default="unknown",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="host",
            name="last_detection_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
