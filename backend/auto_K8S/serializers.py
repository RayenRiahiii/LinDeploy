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
