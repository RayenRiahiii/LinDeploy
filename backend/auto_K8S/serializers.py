from pathlib import PurePosixPath
import re

from rest_framework import serializers

from .models import (
    Credential,
    Host,
    Installation,
    InstallationTarget,
    InstallationTemplate,
)

OS_TYPE_CANONICAL_MAP = {
    "ubuntu2404": "ubuntu24.04",
    "ubuntu2204": "ubuntu22.04",
    "debian12": "debian12",
    "debian11": "debian11",
    "rockylinux9": "rocky9",
    "rocky9": "rocky9",
    "rockylinux8": "rocky8",
    "rocky8": "rocky8",
    "centosstream9": "centos9",
    "centos9": "centos9",
    "rhel9": "rhel9",
    "redhatenterprise linux9": "rhel9",
    "redhatenterpriselinux9": "rhel9",
    "rhel8": "rhel8",
    "redhatenterprise linux8": "rhel8",
    "redhatenterpriselinux8": "rhel8",
    "fedora": "fedora",
    "opensuseleap": "opensuse-leap",
    "sles15": "sles15",
    "suse linux enterprise server15": "sles15",
    "suselinuxenterpriseserver15": "sles15",
}


def normalize_os_type(value: str) -> str:
    cleaned = value.strip().lower()
    if not cleaned:
        return ""

    canonical_key = re.sub(r"[\s._-]+", "", cleaned)
    canonical = OS_TYPE_CANONICAL_MAP.get(canonical_key)
    if canonical:
        return canonical

    normalized = re.sub(r"[\s_]+", "-", cleaned)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")

    if len(normalized) > 50:
        raise serializers.ValidationError("OS type must be 50 characters or fewer.")

    if not re.fullmatch(r"[a-z0-9]+(?:[._-][a-z0-9]+)*", normalized):
        raise serializers.ValidationError(
            "OS type may contain only lowercase letters, digits, dots, underscores, and hyphens."
        )

    return normalized


def extract_host_failure_context(target: InstallationTarget) -> str:
    """Return only the Ansible failure block that belongs to this target."""
    host_marker = f"fatal: [{target.host.name}]"
    contexts = []

    for source in (target.stdout, target.stderr, target.output):
        if not source:
            continue

        start = source.find(host_marker)
        if start < 0:
            continue

        end_candidates = [
            position
            for marker in ("\nfatal: [", "\nPLAY RECAP", "\nTASKS RECAP", "\nPLAYBOOK RECAP")
            if (position := source.find(marker, start + len(host_marker))) >= 0
        ]
        end = min(end_candidates) if end_candidates else len(source)
        contexts.append(source[start:end])

    if not contexts:
        for source in (target.stderr, target.output, target.stdout):
            if source:
                contexts.append(source)

    return "\n".join(contexts)


def classify_installation_target_issue(target: InstallationTarget):
    if target.status != InstallationTarget.Status.FAILED:
        return None

    failure_context = extract_host_failure_context(target)
    issue_definition = None
    artifact_stop_marker = None

    if "K3s installation artifacts are still present" in failure_context:
        issue_definition = {
            "code": "k3s_conflict",
            "title": "K3s is already installed",
            "detail": (
                "Kubernetes was not installed on this target because an existing K3s "
                "installation owns conflicting cluster services and files."
            ),
            "recommended_action": (
                "Run the K3s cleanup workflow on this target, then retry the Kubernetes installation."
            ),
            "cleanup_system": InstallationTemplate.SystemType.K3S,
        }
        artifact_stop_marker = "No Kubernetes system changes"
    elif (
        "Kubernetes installation artifacts are still present" in failure_context
        or "K3s requires a clean target host. Conflicting artifacts were detected" in failure_context
    ):
        issue_definition = {
            "code": "kubernetes_conflict",
            "title": "Kubernetes is already installed",
            "detail": (
                "K3s was not installed on this target because an existing Kubernetes "
                "installation owns conflicting cluster services and files."
            ),
            "recommended_action": (
                "Run the Kubernetes cleanup workflow on this target, then retry the K3s installation."
            ),
            "cleanup_system": InstallationTemplate.SystemType.KUBERNETES,
        }
        artifact_stop_marker = "No K3s system changes"
    elif "Existing Kubernetes cluster identity does not match" in failure_context:
        issue_definition = {
            "code": "kubernetes_identity_conflict",
            "title": "Kubernetes names differ from the existing cluster",
            "detail": (
                "This target already belongs to a Kubernetes cluster created with "
                "different cluster or node names. Kubernetes cannot safely rename "
                "that identity in place."
            ),
            "recommended_action": (
                "Run Kubernetes Reset Cluster on the affected targets, then retry "
                "the installation with the new names."
            ),
            "cleanup_system": InstallationTemplate.SystemType.KUBERNETES,
        }
    elif (
        "is running without the requested discovery ISO" in failure_context
        or "The automation will not forcibly stop a running VM" in failure_context
        or "LinDeploy will not forcibly destroy a running VM" in failure_context
    ):
        issue_definition = {
            "code": "openshift_running_vm",
            "title": "OpenShift VM is running from installed disk",
            "detail": (
                "The target VM already exists and is running from its installed disk, "
                "but the OpenShift API did not report Ready. LinDeploy will not forcibly destroy "
                "or re-image a running VM without operator instruction."
            ),
            "recommended_action": (
                "Run the OpenShift SNO Cleanup workflow to reset the VM, or enable 'Force Reinstall' "
                "if you wish to wipe and re-deploy."
            ),
            "cleanup_system": InstallationTemplate.SystemType.OPENSHIFT_SNO,
        }
    elif (
        "Existing domain has no matching managed volume" in failure_context
        or "without a matching LinDeploy ownership marker" in failure_context
        or "does not match this workshop" in failure_context
        or "Refuse a domain without its expected volume" in failure_context
    ):
        issue_definition = {
            "code": "openshift_storage_conflict",
            "title": "Conflicting OpenShift VM or volume",
            "detail": (
                "A virtual machine or disk volume already exists with the same name on the KVM host, "
                "but lacks valid LinDeploy ownership markers."
            ),
            "recommended_action": (
                "Run OpenShift SNO Cleanup to safely remove orphaned resources, or inspect existing "
                "domains on the KVM host."
            ),
            "cleanup_system": InstallationTemplate.SystemType.OPENSHIFT_SNO,
        }
    elif (
        "Wait for Agent bootstrap completion timed out" in failure_context
        or "Wait for node registration timed out" in failure_context
    ):
        issue_definition = {
            "code": "openshift_bootstrap_timeout",
            "title": "OpenShift Agent bootstrap timed out",
            "detail": (
                "The Agent installer did not reach rendezvous completion within the expected timeout. "
                "This typically happens if the VM cannot pull from the mirror registry or ran out of RAM."
            ),
            "recommended_action": (
                "Inspect the VM console via 'virsh console <vm>' on the KVM host, then run OpenShift SNO Cleanup "
                "before retrying."
            ),
            "cleanup_system": InstallationTemplate.SystemType.OPENSHIFT_SNO,
        }

    if issue_definition is None:
        return None

    artifacts = []
    if artifact_stop_marker:
        artifact_match = re.search(
            rf"Detected artifacts:\s*(?P<artifacts>.+?)\.\s*{re.escape(artifact_stop_marker)}",
            failure_context,
            flags=re.DOTALL,
        )
        if artifact_match:
            artifacts = [
                item.strip()
                for item in re.sub(r"\s+", " ", artifact_match.group("artifacts")).split(",")
                if item.strip()
            ]

    return {**issue_definition, "artifacts": artifacts}


class CredentialSerializer(serializers.ModelSerializer):
    class Meta:
        model = Credential
        fields = "__all__"

    def validate_username(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Username cannot be empty.")
        return value

    def validate(self, attrs):
        auth_type = attrs.get("auth_type", getattr(self.instance, "auth_type", None))
        private_key = attrs.get("private_key", getattr(self.instance, "private_key", ""))
        password = attrs.get("password", getattr(self.instance, "password", ""))

        if auth_type == Credential.AuthType.SSH_KEY and not private_key.strip():
            raise serializers.ValidationError(
                {"private_key": "This field is required when auth_type is 'ssh_key'."}
            )

        if auth_type == Credential.AuthType.PASSWORD and not password.strip():
            raise serializers.ValidationError(
                {"password": "This field is required when auth_type is 'password'."}
            )

        if auth_type == Credential.AuthType.PASSWORD:
            attrs["private_key"] = ""

        if auth_type == Credential.AuthType.SSH_KEY:
            attrs["password"] = ""

        return attrs


class HostSerializer(serializers.ModelSerializer):
    credential_name = serializers.CharField(source="credential.name", read_only=True)
    credential_username = serializers.CharField(source="credential.username", read_only=True)

    class Meta:
        model = Host
        fields = "__all__"

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Host name cannot be empty.")
        return value

    def validate_hostname(self, value):
        return value.strip()

    def validate_os_type(self, value):
        return normalize_os_type(value)

    def validate_ssh_port(self, value):
        if value < 1 or value > 65535:
            raise serializers.ValidationError("SSH port must be between 1 and 65535.")
        return value

    def update(self, instance, validated_data):
        reset_detection_fields = False

        for field_name in ("ip_address", "ssh_port", "credential", "enabled", "hostname", "os_type"):
            if field_name not in validated_data:
                continue
            if validated_data[field_name] != getattr(instance, field_name):
                reset_detection_fields = True
                break

        instance = super().update(instance, validated_data)

        if reset_detection_fields:
            instance.baseline_state = Host.BaselineState.UNKNOWN
            instance.last_detection_at = None
            instance.baseline_facts = {}
            instance.save(
                update_fields=[
                    "baseline_state",
                    "last_detection_at",
                    "baseline_facts",
                    "updated_at",
                ]
            )

        return instance


class InstallationTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstallationTemplate
        fields = "__all__"

    def validate_playbook_path(self, value):
        normalized = PurePosixPath(value.strip())

        if not value.strip():
            raise serializers.ValidationError("Playbook path cannot be empty.")
        if normalized.is_absolute():
            raise serializers.ValidationError("Playbook path must be relative to the Ansible repo root.")
        if ".." in normalized.parts:
            raise serializers.ValidationError("Playbook path cannot traverse parent directories.")
        if normalized.suffix not in {".yml", ".yaml"}:
            raise serializers.ValidationError("Playbook path must point to a YAML playbook.")

        return normalized.as_posix()


class OpenShiftSecretBundleSerializer(serializers.Serializer):
    pull_secret = serializers.CharField(trim_whitespace=False, write_only=True)
    ssh_public_key = serializers.CharField(trim_whitespace=True, write_only=True)
    additional_trust_bundle = serializers.CharField(
        required=False, allow_blank=True, trim_whitespace=False, write_only=True
    )
    mirror_ca_bundle = serializers.CharField(
        required=False, allow_blank=True, trim_whitespace=False, write_only=True
    )
    mirror_username = serializers.CharField(
        required=False, allow_blank=True, trim_whitespace=True, write_only=True
    )
    mirror_password = serializers.CharField(
        required=False, allow_blank=True, trim_whitespace=False, write_only=True
    )

    def validate_pull_secret(self, value):
        import json

        try:
            payload = json.loads(value)
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError("Pull secret must be valid JSON.") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("auths"), dict):
            raise serializers.ValidationError("Pull secret must contain an auths object.")
        return value

    def validate_ssh_public_key(self, value):
        if "PRIVATE KEY" in value.upper():
            raise serializers.ValidationError("Private SSH keys are not accepted.")
        supported = re.compile(
            r"^(ssh-(?:rsa|ed25519)|ecdsa-sha2-nistp(?:256|384|521)|"
            r"sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)\s+"
        )
        if not supported.match(value):
            raise serializers.ValidationError("Unsupported SSH public-key format.")
        return value

    def validate(self, attrs):
        username = attrs.get("mirror_username", "").strip()
        password = attrs.get("mirror_password", "")
        if bool(username) != bool(password):
            raise serializers.ValidationError(
                {
                    "mirror_username": (
                        "Mirror registry username and password must be supplied together."
                    )
                }
            )
        return attrs


class OpenShiftRetrySerializer(serializers.Serializer):
    secret_reference = serializers.UUIDField()


class InstallationLaunchSerializer(serializers.Serializer):
    template_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    host_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        default=list,
    )
    deployment_mode = serializers.ChoiceField(
        choices=("auto", "manual", "prepared", "full"),
        default="auto",
    )
    system_type = serializers.ChoiceField(
        choices=InstallationTemplate.SystemType.choices,
        default=InstallationTemplate.SystemType.KUBERNETES,
    )
    topology = serializers.ChoiceField(
        choices=Installation.Topology.choices,
        default=Installation.Topology.SINGLE_NODE,
    )
    cluster_config = serializers.DictField(required=False, default=dict)
    host_overrides = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
    )
    control_plane_host_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        default=list,
    )
    worker_host_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        default=list,
    )
    bootstrap_host_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)

    @staticmethod
    def _validate_unique_ids(attrs, field_name):
        values = attrs.get(field_name, [])
        if len(values) != len(set(values)):
            raise serializers.ValidationError(
                {field_name: "Host identifiers must be unique."}
            )

    def validate(self, attrs):
        for field_name in ("host_ids", "control_plane_host_ids", "worker_host_ids"):
            self._validate_unique_ids(attrs, field_name)

        topology = attrs["topology"]
        host_ids = attrs["host_ids"]
        control_plane_ids = attrs["control_plane_host_ids"]
        worker_ids = attrs["worker_host_ids"]
        bootstrap_host_id = attrs.get("bootstrap_host_id")

        if topology == Installation.Topology.SINGLE_NODE:
            if not host_ids:
                raise serializers.ValidationError(
                    {"host_ids": "Select at least one host for single-node installation."}
                )
            if control_plane_ids or worker_ids or bootstrap_host_id is not None:
                raise serializers.ValidationError(
                    {
                        "topology": (
                            "Role groups and bootstrap_host_id are only accepted for "
                            "multi-node installations."
                        )
                    }
                )
            return attrs

        if not control_plane_ids:
            raise serializers.ValidationError(
                {"control_plane_host_ids": "Select at least one control-plane host."}
            )
        if not worker_ids:
            raise serializers.ValidationError(
                {"worker_host_ids": "Select at least one worker host."}
            )

        overlapping_ids = sorted(set(control_plane_ids) & set(worker_ids))
        if overlapping_ids:
            raise serializers.ValidationError(
                {
                    "worker_host_ids": (
                        "A host cannot be both control plane and worker. "
                        f"Conflicting host IDs: {overlapping_ids}."
                    )
                }
            )

        if bootstrap_host_id is None:
            raise serializers.ValidationError(
                {"bootstrap_host_id": "Select the control-plane host that initializes the cluster."}
            )
        if bootstrap_host_id not in control_plane_ids:
            raise serializers.ValidationError(
                {"bootstrap_host_id": "The bootstrap host must belong to the control-plane group."}
            )

        topology_host_ids = [*control_plane_ids, *worker_ids]
        if host_ids and set(host_ids) != set(topology_host_ids):
            raise serializers.ValidationError(
                {
                    "host_ids": (
                        "host_ids must contain exactly the selected control-plane and worker hosts."
                    )
                }
            )

        attrs["host_ids"] = topology_host_ids
        return attrs


class InstallationTargetSerializer(serializers.ModelSerializer):
    host_name = serializers.CharField(source="host.name", read_only=True)
    operator_issue = serializers.SerializerMethodField()

    def get_operator_issue(self, obj):
        return classify_installation_target_issue(obj)

    class Meta:
        model = InstallationTarget
        fields = "__all__"


class InstallationSerializer(serializers.ModelSerializer):
    template_name = serializers.CharField(source="template.name", read_only=True)
    template_system_type = serializers.CharField(source="template.system_type", read_only=True)
    deployment_type = serializers.CharField(source="template.deployment_type", read_only=True)
    duration_seconds = serializers.FloatField(read_only=True)
    targets = InstallationTargetSerializer(many=True, read_only=True)

    class Meta:
        model = Installation
        fields = "__all__"
