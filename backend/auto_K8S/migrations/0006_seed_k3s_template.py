from django.db import migrations


def seed_k3s_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.get_or_create(
        name="k3s-single-node",
        defaults={
            "system_type": "k3s",
            "playbook_path": "playbooks/k3s_single_node.yml",
            "deployment_type": "single_node",
            "description": "Install a single-node K3s cluster on each selected target.",
        },
    )


def unseed_k3s_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(name="k3s-single-node").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("auto_K8S", "0005_installationtemplate_system_type"),
    ]

    operations = [
        migrations.RunPython(seed_k3s_template, unseed_k3s_template),
    ]
