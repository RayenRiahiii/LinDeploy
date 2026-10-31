from django.db import migrations


def seed_k8s_multi_node_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.update_or_create(
        name="k8s-multi-node",
        defaults={
            "system_type": "kubernetes",
            "playbook_path": "playbooks/k8s_multi_node.yml",
            "deployment_type": "multi_node",
            "description": (
                "Install one kubeadm Kubernetes cluster with selected "
                "control-plane and worker hosts."
            ),
        },
    )


def unseed_k8s_multi_node_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(name="k8s-multi-node").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0013_alter_installationtemplate_deployment_type"),
    ]

    operations = [
        migrations.RunPython(
            seed_k8s_multi_node_template,
            unseed_k8s_multi_node_template,
        ),
    ]
