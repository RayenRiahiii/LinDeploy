from django.db import migrations


def seed_openshift_fast_reset_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")

    InstallationTemplate.objects.update_or_create(
        system_type="openshift_sno",
        playbook_path="playbooks/openshift_sno_reset.yml",
        defaults={
            "name": "openshift-sno-fast-reset",
            "system_type": "openshift_sno",
            "deployment_type": "cleanup",
            "playbook_path": "playbooks/openshift_sno_reset.yml",
            "description": (
                "Fast Reset — destroy the managed SNO VM and its disk in seconds, "
                "while preserving the storage pool definition, base RHCOS ISO cache, "
                "Quay mirror registry, ownership marker, and kubeconfig templates. "
                "Use this to quickly wipe and reinstall the cluster without re-downloading assets."
            ),
        },
    )


def unseed_openshift_fast_reset_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(
        system_type="openshift_sno",
        playbook_path="playbooks/openshift_sno_reset.yml",
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0024_seed_openshift_full_uninstall_template"),
    ]

    operations = [
        migrations.RunPython(
            seed_openshift_fast_reset_template,
            unseed_openshift_fast_reset_template,
        ),
    ]
