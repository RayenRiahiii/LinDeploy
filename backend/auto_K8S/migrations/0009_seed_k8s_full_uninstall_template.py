from django.db import migrations


def seed_k8s_full_uninstall_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")

    InstallationTemplate.objects.update_or_create(
        name="k8s-cleanup",
        defaults={
            "system_type": "kubernetes",
            "playbook_path": "playbooks/k8s_cleanup.yml",
            "deployment_type": "cleanup",
            "description": "Reset cluster state and keep Kubernetes packages installed for a faster redeploy.",
        },
    )

    InstallationTemplate.objects.update_or_create(
        name="k8s-full-uninstall",
        defaults={
            "system_type": "kubernetes",
            "playbook_path": "playbooks/k8s_full_uninstall.yml",
            "deployment_type": "cleanup",
            "description": "Remove cluster state and uninstall Kubernetes packages from the selected host.",
        },
    )


def unseed_k8s_full_uninstall_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(name="k8s-full-uninstall").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0008_cleanup_templates"),
    ]

    operations = [
        migrations.RunPython(
            seed_k8s_full_uninstall_template,
            unseed_k8s_full_uninstall_template,
        ),
    ]
