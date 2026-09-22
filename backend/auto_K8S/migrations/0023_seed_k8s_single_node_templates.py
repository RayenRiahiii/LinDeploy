from django.db import migrations


def seed_k8s_single_node_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.update_or_create(
        system_type="kubernetes",
        playbook_path="playbooks/k8s_single_node.yml",
        defaults={
            "name": "k8s-single-node",
            "system_type": "kubernetes",
            "deployment_type": "single_node",
            "playbook_path": "playbooks/k8s_single_node.yml",
            "description": (
                "Installs a single-node Kubernetes control plane with workload "
                "scheduling enabled."
            ),
        },
    )


def unseed_k8s_single_node_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(
        system_type="kubernetes",
        playbook_path="playbooks/k8s_single_node.yml",
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0022_unique_active_mirror_prewarm"),
    ]

    operations = [
        migrations.RunPython(
            seed_k8s_single_node_template,
            unseed_k8s_single_node_template,
        ),
    ]
