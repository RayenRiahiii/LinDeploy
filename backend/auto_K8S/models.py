import uuid

from django.db import models
from django.db.models import Q
from .fields import EncryptedSecretField


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Credential(TimeStampedModel):
    class AuthType(models.TextChoices):
        SSH_KEY = "ssh_key", "SSH Key"
        PASSWORD = "password", "Password"

    name = models.CharField(max_length=100, unique=True)
    auth_type = models.CharField(max_length=20, choices=AuthType.choices)
    username = models.CharField(max_length=100)
    private_key = EncryptedSecretField(blank=True)
    password = EncryptedSecretField(blank=True)
    become_password = EncryptedSecretField(blank=True)

    def __str__(self):
        return self.name


class ExecutionMutex(models.Model):
    generation = models.BigIntegerField(default=0)


class Host(TimeStampedModel):
    class NodeRole(models.TextChoices):
        STANDALONE = "standalone", "Standalone"
        CONTROL_PLANE = "control_plane", "Control Plane"
        WORKER = "worker", "Worker"

    class BaselineState(models.TextChoices):
        UNKNOWN = "unknown", "Unknown"
        FRESH = "fresh", "Fresh"
        PREPARED = "prepared", "Prepared"
        INITIALIZED = "initialized", "Initialized"

    stable_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    name = models.CharField(max_length=100, unique=True)
    hostname = models.CharField(max_length=255, blank=True)
    ip_address = models.GenericIPAddressField(protocol="IPv4", unique=True)
    ssh_port = models.PositiveIntegerField(default=22)
    os_type = models.CharField(max_length=50, blank=True)
    node_role = models.CharField(
        max_length=20,
        choices=NodeRole.choices,
        default=NodeRole.STANDALONE,
    )
    baseline_state = models.CharField(
        max_length=20,
        choices=BaselineState.choices,
        default=BaselineState.UNKNOWN,
    )
    last_detection_at = models.DateTimeField(null=True, blank=True)
    baseline_facts = models.JSONField(default=dict, blank=True)
    enabled = models.BooleanField(default=True)
    credential = models.ForeignKey(
        Credential,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hosts",
    )

    class Meta:
        ordering = ("name",)

    def __str__(self):
        return self.name


class InstallationTemplate(TimeStampedModel):
    class SystemType(models.TextChoices):
        KUBERNETES = "kubernetes", "Kubernetes"
        K3S = "k3s", "K3s"
        OPENSHIFT_SNO = "openshift_sno", "OpenShift SNO"

    class DeploymentType(models.TextChoices):
        PREPARE_NODE = "prepare_node", "Prepare Node"
        SINGLE_NODE = "single_node", "Single Node"
        MULTI_NODE = "multi_node", "Multi Node"
        CLEANUP = "cleanup", "Cleanup"

    name = models.CharField(max_length=100, unique=True)
    system_type = models.CharField(
        max_length=30,
        choices=SystemType.choices,
        default=SystemType.KUBERNETES,
    )
    playbook_path = models.CharField(max_length=255)
    deployment_type = models.CharField(
        max_length=30,
        choices=DeploymentType.choices,
        default=DeploymentType.SINGLE_NODE,
    )
    description = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("system_type", "playbook_path"),
                name="uniq_template_system_playbook",
            )
        ]

    def __str__(self):
        return self.name


class OpenShiftSecretBundle(TimeStampedModel):
    reference = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    encrypted_payload = models.BinaryField()
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return f"OpenShift secret bundle {str(self.reference)[:8]}…"


class Installation(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        PARTIAL_SUCCESS = "partial_success", "Partial Success"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    class Phase(models.TextChoices):
        QUEUED = "queued", "Queued"
        SSH_CHECK = "ssh_check", "SSH Check"
        RUNNING_PLAYBOOK = "running_playbook", "Running Playbook"
        FINALIZING = "finalizing", "Finalizing"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    class Topology(models.TextChoices):
        SINGLE_NODE = "single_node", "Single Node"
        MULTI_NODE = "multi_node", "Multi Node"

    template = models.ForeignKey(
        InstallationTemplate,
        on_delete=models.CASCADE,
        related_name="installations",
    )
    topology = models.CharField(
        max_length=20,
        choices=Topology.choices,
        default=Topology.SINGLE_NODE,
    )
    cluster_name = models.CharField(max_length=253, blank=True)
    control_plane_endpoint = models.CharField(max_length=255, blank=True)
    bootstrap_host = models.ForeignKey(
        Host,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bootstrap_installations",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    phase = models.CharField(
        max_length=30,
        choices=Phase.choices,
        default=Phase.QUEUED,
    )
    progress = models.PositiveSmallIntegerField(default=0)
    celery_task_id = models.CharField(max_length=255, blank=True)
    cancel_requested = models.BooleanField(default=False)
    runner_pid = models.IntegerField(null=True, blank=True)
    command = models.TextField(blank=True)
    inventory_content = models.TextField(blank=True)
    stdout = models.TextField(blank=True)
    stderr = models.TextField(blank=True)
    summary_message = models.TextField(blank=True)
    cluster_config = models.JSONField(default=dict, blank=True)
    host_overrides = models.JSONField(default=list, blank=True)
    return_code = models.IntegerField(null=True, blank=True)
    timings = models.JSONField(default=dict, blank=True)
    task_profile = models.JSONField(default=list, blank=True)
    bottleneck_hints = models.JSONField(default=list, blank=True)
    connectivity = models.JSONField(default=list, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Installation #{self.pk} - {self.template.name}"

    @property
    def duration_seconds(self):
        if not self.started_at or not self.finished_at:
            return None

        return round((self.finished_at - self.started_at).total_seconds(), 3)


class InstallationTarget(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    class DesiredRole(models.TextChoices):
        CONTROL_PLANE = "control_plane", "Control Plane"
        WORKER = "worker", "Worker"

    class JoinStatus(models.TextChoices):
        NOT_APPLICABLE = "not_applicable", "Not Applicable"
        NOT_STARTED = "not_started", "Not Started"
        WAITING = "waiting", "Waiting"
        JOINING = "joining", "Joining"
        JOINED = "joined", "Joined"
        FAILED = "failed", "Failed"

    installation = models.ForeignKey(
        Installation,
        on_delete=models.CASCADE,
        related_name="targets",
    )
    host = models.ForeignKey(
        Host,
        on_delete=models.CASCADE,
        related_name="installation_targets",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    desired_role = models.CharField(
        max_length=20,
        choices=DesiredRole.choices,
        default=DesiredRole.CONTROL_PLANE,
    )
    is_bootstrap = models.BooleanField(default=True)
    join_status = models.CharField(
        max_length=20,
        choices=JoinStatus.choices,
        default=JoinStatus.NOT_APPLICABLE,
    )
    node_name = models.CharField(max_length=253, blank=True)
    cluster_name = models.CharField(max_length=253, blank=True)
    stdout = models.TextField(blank=True)
    stderr = models.TextField(blank=True)
    return_code = models.IntegerField(null=True, blank=True)
    output = models.TextField(blank=True)

    class Meta:
        unique_together = ("installation", "host")

    def __str__(self):
        return f"{self.installation} -> {self.host.name}"


class MirrorProfile(TimeStampedModel):
    class VerificationState(models.TextChoices):
        PENDING = "pending", "Pending"
        VERIFYING = "verifying", "Verifying"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"
        INVALIDATED = "invalidated", "Invalidated"

    profile_id = models.CharField(max_length=255, unique=True, editable=False)
    platform = models.CharField(max_length=30)
    exact_version = models.CharField(max_length=100)
    architecture = models.CharField(max_length=30)
    os_family = models.CharField(max_length=50)
    os_release = models.CharField(max_length=50)
    package_set = models.JSONField(default=list)
    oci_images = models.JSONField(default=list)
    artifacts = models.JSONField(default=list)
    provenance = models.JSONField(default=dict)
    manifest_sha256 = models.CharField(max_length=64)
    content_generation = models.CharField(max_length=64)
    size_bytes = models.PositiveBigIntegerField(default=0)
    verification_state = models.CharField(
        max_length=20,
        choices=VerificationState.choices,
        default=VerificationState.PENDING,
    )
    verification_error = models.TextField(blank=True)
    pinned = models.BooleanField(default=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("platform", "-created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("platform", "exact_version", "architecture", "os_family", "os_release"),
                name="uniq_mirror_release_profile",
            )
        ]

    def __str__(self):
        return self.profile_id


class MirrorPrewarmJob(TimeStampedModel):
    class State(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        VERIFYING = "verifying", "Verifying"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    job_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    dedupe_key = models.CharField(max_length=255, db_index=True)
    requested_components = models.JSONField(default=list)
    requested_profiles = models.JSONField(default=list)
    state = models.CharField(max_length=20, choices=State.choices, default=State.QUEUED)
    celery_task_id = models.CharField(max_length=255, blank=True)
    correlation_id = models.UUIDField(default=uuid.uuid4, editable=False)
    owner_token = models.UUIDField(null=True, blank=True, editable=False)
    lease_expires_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    progress = models.PositiveSmallIntegerField(default=0)
    result = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("dedupe_key",),
                condition=Q(state__in=("queued", "running", "verifying")),
                name="uniq_active_mirror_prewarm",
            )
        ]

    def __str__(self):
        return f"Mirror prewarm {self.job_id} ({self.state})"
