from pathlib import PurePosixPath

from rest_framework import serializers

from .models import (
    Credential,
    Host,
    Installation,
    InstallationTarget,
    InstallationTemplate,
)


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
