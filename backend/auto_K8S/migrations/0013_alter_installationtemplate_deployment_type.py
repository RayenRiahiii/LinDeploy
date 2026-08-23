from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0012_mark_single_node_targets_as_bootstrap"),
    ]

    operations = [
        migrations.AlterField(
            model_name="installationtemplate",
            name="deployment_type",
            field=models.CharField(
                choices=[
                    ("prepare_node", "Prepare Node"),
                    ("single_node", "Single Node"),
                    ("multi_node", "Multi Node"),
                    ("cleanup", "Cleanup"),
                ],
                default="single_node",
                max_length=30,
            ),
        ),
    ]
