from django.db import migrations


def seed_openshift_cleanup_templates(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")

    # Update existing cleanup template description
    InstallationTemplate.objects.update_or_create(
        system_type="openshift_sno",
        playbook_path="playbooks/openshift_sno_cleanup.yml",
        defaults={
            "name": "openshift-sno-cleanup",
            "system_type": "openshift_sno",
            "deployment_type": "cleanup",
            "playbook_path": "playbooks/openshift_sno_cleanup.yml",
            "description": (
                "Remove the managed SNO virtual machine and volume while preserving "
                "the generated Agent ISO image for faster reinstallation."
            ),
        },
    )

    # Seed full uninstall cleanup template
    InstallationTemplate.objects.update_or_create(
        system_type="openshift_sno",
        playbook_path="playbooks/openshift_sno_full_uninstall.yml",
        defaults={
            "name": "openshift-sno-full-uninstall",
            "system_type": "openshift_sno",
            "deployment_type": "cleanup",
            "playbook_path": "playbooks/openshift_sno_full_uninstall.yml",
            "description": (
                "Remove the managed SNO virtual machine, volume, runtime ISO, and all "
                "cluster-specific installation assets without deleting mirror content."
            ),
        },
    )


def unseed_openshift_cleanup_templates(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(
        system_type="openshift_sno",
        playbook_path="playbooks/openshift_sno_full_uninstall.yml",
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0023_seed_k8s_single_node_templates"),
    ]

    operations = [
        migrations.RunPython(
            seed_openshift_cleanup_templates,
            unseed_openshift_cleanup_templates,
        ),
    ]

