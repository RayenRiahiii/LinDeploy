from django.db import migrations


def seed_k3s_multi_node_cleanup_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.update_or_create(
        system_type="k3s",
        playbook_path="playbooks/k3s_multi_node_cleanup.yml",
        defaults={
            "name": "k3s-multi-node-cleanup",
            "system_type": "k3s",
            "deployment_type": "cleanup",
            "playbook_path": "playbooks/k3s_multi_node_cleanup.yml",
            "description": (
                "Safely decommission and clean up a multi-node K3s cluster across "
                "server (control plane) and agent (worker) hosts."
            ),
        },
    )


def unseed_k3s_multi_node_cleanup_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(
        system_type="k3s",
        playbook_path="playbooks/k3s_multi_node_cleanup.yml",
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0026_seed_k3s_multi_node_template"),
    ]

    operations = [
        migrations.RunPython(
            seed_k3s_multi_node_cleanup_template,
            unseed_k3s_multi_node_cleanup_template,
        ),
    ]
