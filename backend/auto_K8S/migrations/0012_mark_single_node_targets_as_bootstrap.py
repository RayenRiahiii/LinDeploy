from django.db import migrations


def mark_single_node_targets_as_bootstrap(apps, schema_editor):
    InstallationTarget = apps.get_model("auto_K8S", "InstallationTarget")
    InstallationTarget.objects.update(is_bootstrap=False)
    InstallationTarget.objects.filter(
        installation__template__deployment_type="single_node",
    ).update(is_bootstrap=True)


def unmark_single_node_targets_as_bootstrap(apps, schema_editor):
    InstallationTarget = apps.get_model("auto_K8S", "InstallationTarget")
    InstallationTarget.objects.update(is_bootstrap=False)


class Migration(migrations.Migration):
    dependencies = [
        ("auto_K8S", "0011_installation_bootstrap_host_and_more"),
    ]

    operations = [
        migrations.RunPython(
            mark_single_node_targets_as_bootstrap,
            unmark_single_node_targets_as_bootstrap,
        ),
    ]
