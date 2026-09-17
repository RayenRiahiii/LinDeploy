from django.db import migrations, models
import uuid


def register_openshift_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.update_or_create(
        name="openshift-sno-kvm",
        defaults={
            "system_type": "openshift_sno",
            "deployment_type": "single_node",
            "playbook_path": "playbooks/openshift_sno.yml",
            "description": "Provision a KVM VM and install Single Node OpenShift with Assisted Installer.",
        },
    )


def unregister_openshift_template(apps, schema_editor):
    InstallationTemplate = apps.get_model("auto_K8S", "InstallationTemplate")
    InstallationTemplate.objects.filter(name="openshift-sno-kvm").delete()


class Migration(migrations.Migration):
    dependencies = [("auto_K8S", "0015_installationtarget_cluster_name")]
    operations = [
        migrations.CreateModel(
            name="OpenShiftSecretBundle",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("reference", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("encrypted_payload", models.BinaryField()),
                ("expires_at", models.DateTimeField()),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"ordering": ("-created_at",)},
        ),
        migrations.RunPython(register_openshift_template, unregister_openshift_template),
    ]
