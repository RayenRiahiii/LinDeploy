from django.db import migrations


def seed_k3s_multi_node_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.update_or_create(
        system_type="k3s",
        playbook_path="playbooks/k3s_multi_node.yml",
        defaults={
            "name": "k3s-multi-node",
            "system_type": "k3s",
            "deployment_type": "multi_node",
            "playbook_path": "playbooks/k3s_multi_node.yml",
            "description": (
                "Install one K3s cluster with selected server (control plane) "
                "and agent (worker) hosts."
            ),
        },
    )


def unseed_k3s_multi_node_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(
        system_type="k3s",
        playbook_path="playbooks/k3s_multi_node.yml",
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0025_seed_openshift_fast_reset_template"),
    ]

    operations = [
        migrations.RunPython(
            seed_k3s_multi_node_template,
            unseed_k3s_multi_node_template,
        ),
    ]
