from django.db import migrations, models


def deduplicate_installation_templates(apps, schema_editor):
    Installation = apps.get_model("auto_K8S", "Installation")
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")

    duplicate_groups = (
        InstallationTemplate.objects.values("system_type", "playbook_path")
        .annotate(template_count=models.Count("id"))
        .filter(template_count__gt=1)
    )

    for group in duplicate_groups:
        templates = list(
            InstallationTemplate.objects.filter(
                system_type=group["system_type"],
                playbook_path=group["playbook_path"],
            ).order_by("id")
        )
        canonical = templates[0]
        preferred = next(
            (item for item in templates if item.name == "k8s-single-node"),
            templates[-1],
        )
        duplicate_ids = [item.id for item in templates if item.id != canonical.id]

        Installation.objects.filter(template_id__in=duplicate_ids).update(
            template_id=canonical.id
        )
        InstallationTemplate.objects.filter(id__in=duplicate_ids).delete()

        if canonical.name != preferred.name:
            canonical.name = preferred.name
        canonical.deployment_type = preferred.deployment_type
        canonical.description = preferred.description
        canonical.save(update_fields=("name", "deployment_type", "description"))


class Migration(migrations.Migration):
    dependencies = [("auto_K8S", "0016_openshift_secret_bundle_and_template")]

    operations = [
        migrations.RunPython(
            deduplicate_installation_templates,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
