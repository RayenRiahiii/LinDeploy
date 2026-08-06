from django.db import models


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
    private_key = models.TextField(blank=True)
    password = models.CharField(max_length=255, blank=True)
    become_password = models.CharField(max_length=255, blank=True)

    def __str__(self):
        return self.name


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

    def __str__(self):
        return self.name


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

    template = models.ForeignKey(
        InstallationTemplate,
        on_delete=models.CASCADE,
        related_name="installations",
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
    stdout = models.TextField(blank=True)
    stderr = models.TextField(blank=True)
    return_code = models.IntegerField(null=True, blank=True)
    output = models.TextField(blank=True)

    class Meta:
        unique_together = ("installation", "host")

    def __str__(self):
        return f"{self.installation} -> {self.host.name}"
