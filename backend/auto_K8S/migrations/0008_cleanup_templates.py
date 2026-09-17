from django.db import migrations, models


def seed_cleanup_templates(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")

    cleanup_templates = [
        {
            "name": "k8s-cleanup",
            "system_type": "kubernetes",
            "playbook_path": "playbooks/k8s_cleanup.yml",
            "deployment_type": "cleanup",
            "description": "Reset kubeadm Kubernetes state and remove common cluster artifacts from the selected target.",
        },
        {
            "name": "k3s-cleanup",
            "system_type": "k3s",
            "playbook_path": "playbooks/k3s_cleanup.yml",
            "deployment_type": "cleanup",
            "description": "Remove K3s services and cluster state from the selected target.",
        },
    ]

    for template in cleanup_templates:
        InstallationTemplate.objects.get_or_create(
            name=template["name"],
            defaults=template,
        )


def unseed_cleanup_templates(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(name__in=["k8s-cleanup", "k3s-cleanup"]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0007_installation_cluster_config_and_host_overrides"),
    ]

    operations = [
        migrations.AlterField(
            model_name="installationtemplate",
            name="deployment_type",
            field=models.CharField(
                choices=[
                    ("prepare_node", "Prepare Node"),
                    ("single_node", "Single Node"),
                    ("cleanup", "Cleanup"),
                ],
                default="single_node",
                max_length=30,
            ),
        ),
        migrations.RunPython(seed_cleanup_templates, unseed_cleanup_templates),
    ]
