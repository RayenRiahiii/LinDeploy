import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("auto_K8S", "0020_host_stable_id")]

    operations = [
        migrations.CreateModel(
            name="MirrorProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("profile_id", models.CharField(editable=False, max_length=255, unique=True)),
                ("platform", models.CharField(max_length=30)),
                ("exact_version", models.CharField(max_length=100)),
                ("architecture", models.CharField(max_length=30)),
                ("os_family", models.CharField(max_length=50)),
                ("os_release", models.CharField(max_length=50)),
                ("package_set", models.JSONField(default=list)),
                ("oci_images", models.JSONField(default=list)),
                ("artifacts", models.JSONField(default=list)),
                ("provenance", models.JSONField(default=dict)),
                ("manifest_sha256", models.CharField(max_length=64)),
                ("content_generation", models.CharField(max_length=64)),
                ("size_bytes", models.PositiveBigIntegerField(default=0)),
                ("verification_state", models.CharField(choices=[("pending", "Pending"), ("verifying", "Verifying"), ("ready", "Ready"), ("failed", "Failed"), ("invalidated", "Invalidated")], default="pending", max_length=20)),
                ("verification_error", models.TextField(blank=True)),
                ("pinned", models.BooleanField(default=True)),
                ("verified_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"ordering": ("platform", "-created_at")},
        ),
        migrations.CreateModel(
            name="MirrorPrewarmJob",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("job_id", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("dedupe_key", models.CharField(db_index=True, max_length=255)),
                ("requested_components", models.JSONField(default=list)),
                ("requested_profiles", models.JSONField(default=list)),
                ("state", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("verifying", "Verifying"), ("ready", "Ready"), ("failed", "Failed"), ("cancelled", "Cancelled")], default="queued", max_length=20)),
                ("celery_task_id", models.CharField(blank=True, max_length=255)),
                ("correlation_id", models.UUIDField(default=uuid.uuid4, editable=False)),
                ("owner_token", models.UUIDField(blank=True, editable=False, null=True)),
                ("lease_expires_at", models.DateTimeField(blank=True, null=True)),
                ("attempts", models.PositiveIntegerField(default=0)),
                ("progress", models.PositiveSmallIntegerField(default=0)),
                ("result", models.JSONField(blank=True, default=dict)),
                ("error", models.TextField(blank=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"ordering": ("-created_at",)},
        ),
        migrations.AddConstraint(
            model_name="mirrorprofile",
            constraint=models.UniqueConstraint(fields=("platform", "exact_version", "architecture", "os_family", "os_release"), name="uniq_mirror_release_profile"),
        ),
    ]
