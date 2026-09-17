from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0017_deduplicate_templates_and_add_constraint"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="installationtemplate",
            constraint=models.UniqueConstraint(
                fields=("system_type", "playbook_path"),
                name="uniq_template_system_playbook",
            ),
        ),
    ]
