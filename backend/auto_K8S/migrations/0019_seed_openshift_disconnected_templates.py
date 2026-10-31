from django.db import migrations


TEMPLATES = (
    {
        "name": "openshift-mirror-prepare",
        "deployment_type": "prepare_node",
        "playbook_path": "playbooks/openshift_mirror_prepare.yml",
        "description": (
            "Install or reuse a local Quay mirror and synchronize an exact "
            "OpenShift release with oc-mirror v2."
        ),
    },
    {
        "name": "openshift-sno-disconnected",
        "deployment_type": "single_node",
        "playbook_path": "playbooks/openshift_sno_disconnected.yml",
        "description": (
            "Install Single Node OpenShift from a verified local mirror with "
            "the Agent-Based Installer."
        ),
    },
    {
        "name": "openshift-sno-cleanup",
        "deployment_type": "cleanup",
        "playbook_path": "playbooks/openshift_sno_cleanup.yml",
        "description": (
            "Remove the managed SNO virtual machine and installation artifacts "
            "without deleting mirror content."
        ),
    },
)


def seed_templates(apps, schema_editor):
    template_model = apps.get_model("auto_K8S", "InstallationTemplate")
    for definition in TEMPLATES:
        template_model.objects.update_or_create(
            system_type="openshift_sno",
            playbook_path=definition["playbook_path"],
            defaults=definition,
        )


def remove_templates(apps, schema_editor):
    template_model = apps.get_model("auto_K8S", "InstallationTemplate")
    template_model.objects.filter(
        system_type="openshift_sno",
        playbook_path__in=[item["playbook_path"] for item in TEMPLATES],
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("auto_K8S", "0018_add_template_system_playbook_constraint")]
    operations = [migrations.RunPython(seed_templates, remove_templates)]
