import json
import tempfile
import threading
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from unittest.mock import Mock, patch
from pathlib import Path

User = get_user_model()


def make_authenticated_client(username="test_api_user"):
    user, _ = User.objects.get_or_create(username=username, defaults={"email": f"{username}@example.com"})
    client = APIClient()
    client.force_authenticate(user=user)
    return client

from .models import Credential, Host, Installation, InstallationTarget, InstallationTemplate, MirrorProfile
from .runners.linux_runner import LinuxRunner
from .serializers import (
    CredentialSerializer,
    HostSerializer,
    InstallationSerializer,
    InstallationTemplateSerializer,
)
from .services import (
    append_live_output_line,
    apply_playbook_results,
    build_extra_vars_file,
    build_inventory_file,
    classify_baseline_facts,
    compute_live_playbook_progress,
    parse_connectivity_output,
    parse_listed_task_count,
    parse_listed_task_work_count,
    parse_play_recap,
    normalize_host_overrides,
    read_live_output_lines,
    read_live_output_chunk,
    reset_live_output,
    select_installation_template,
)


class LiveExecutionProgressTests(TestCase):
    def test_counts_only_listed_ansible_tasks(self):
        output = """
playbook: playbooks/k8s_single_node.yml

  play #1 (selected_hosts): Install Kubernetes Single Node TAGS: []
    tasks:
      Probe conflicting K3s installation artifacts TAGS: []
      common : Install base packages TAGS: []
      containerd : Enable and start containerd TAGS: []
"""

        self.assertEqual(parse_listed_task_count(output), 3)

    def test_progress_uses_completed_task_ratio(self):
        self.assertEqual(compute_live_playbook_progress(0, 100), 35)
        self.assertEqual(compute_live_playbook_progress(50, 100), 63)
        self.assertEqual(compute_live_playbook_progress(100, 100), 91)

    def test_weights_free_strategy_tasks_by_matching_host_count(self):
        output = """
  play #1 (localhost): Validate inventory TAGS: []
    tasks:
      Validate groups TAGS: []
  play #2 (selected_hosts): Prepare nodes TAGS: []
    tasks:
      Install packages TAGS: []
      Configure runtime TAGS: []
  play #3 (workers): Join workers TAGS: []
    tasks:
      Join cluster TAGS: []
"""

        self.assertEqual(
            parse_listed_task_work_count(
                output,
                free_strategy_group_sizes={"selected_hosts": 3, "workers": 2},
            ),
            9,
        )

    def test_live_output_is_durable_and_limited(self):
        import threading

        with tempfile.TemporaryDirectory() as directory:
            with override_settings(BASE_DIR=Path(directory)):
                output_path = reset_live_output(42)
                output_lock = threading.Lock()
                for index in range(5):
                    append_live_output_line(
                        output_path,
                        output_lock,
                        channel="stderr" if index == 4 else "stdout",
                        line=f"line {index}",
                        timestamp=f"2026-08-16T12:00:0{index}+00:00",
                    )

                output = read_live_output_lines(42, limit=3)

        self.assertEqual([item["line"] for item in output], ["line 2", "line 3", "line 4"])
        self.assertEqual(output[-1]["channel"], "stderr")

    def test_read_live_output_chunk_supports_offset_and_limits(self):
        import threading

        with tempfile.TemporaryDirectory() as temp_dir:
            with override_settings(BASE_DIR=Path(temp_dir)):
                output_path = reset_live_output(99)
                output_lock = threading.Lock()
                for index in range(10):
                    append_live_output_line(
                        output_path,
                        output_lock,
                        channel="stdout",
                        line=f"chunk line {index}",
                        timestamp=f"2026-08-16T12:00:0{index}+00:00",
                    )

                chunk1 = read_live_output_chunk(99, offset=0, limit=4)
                self.assertEqual(len(chunk1["lines"]), 4)
                self.assertEqual(chunk1["next_offset"], 4)
                self.assertEqual(chunk1["total_lines"], 10)
                self.assertEqual(chunk1["lines"][0]["line"], "chunk line 0")
                self.assertEqual(chunk1["lines"][3]["line"], "chunk line 3")

                chunk2 = read_live_output_chunk(99, offset=chunk1["next_offset"], limit=4)
                self.assertEqual(len(chunk2["lines"]), 4)
                self.assertEqual(chunk2["next_offset"], 8)
                self.assertEqual(chunk2["lines"][0]["line"], "chunk line 4")

                chunk3 = read_live_output_chunk(99, offset=chunk2["next_offset"], limit=4)
                self.assertEqual(len(chunk3["lines"]), 2)
                self.assertEqual(chunk3["next_offset"], 10)
                self.assertEqual(chunk3["lines"][0]["line"], "chunk line 8")
                self.assertEqual(chunk3["lines"][1]["line"], "chunk line 9")

                empty_chunk = read_live_output_chunk(99, offset=10, limit=4)
                self.assertEqual(len(empty_chunk["lines"]), 0)
                self.assertEqual(empty_chunk["next_offset"], 10)


class MirrorApiTests(TestCase):
    def setUp(self):
        self.client = make_authenticated_client("mirror_test_user")

    @override_settings(LINDEPLOY_MIRROR_ENABLED=False)
    def test_mirror_status_reports_disabled_state(self):
        response = self.client.get("/api/mirror/")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["enabled"])
        self.assertIn("kubernetes", response.data["components"])
        self.assertIn("k3s", response.data["components"])

    @override_settings(LINDEPLOY_MIRROR_ENABLED=False)
    def test_mirror_prewarm_rejects_disabled_mirror(self):
        response = self.client.post("/api/mirror/prewarm/", {"force": False}, format="json")

        self.assertEqual(response.status_code, 409)
        self.assertIn("disabled", response.data["message"].lower())

    @override_settings(LINDEPLOY_MIRROR_ENABLED=True)
    @patch("auto_K8S.views.run_mirror_prewarm_task.delay")
    @patch("auto_K8S.views.queue_mirror_prewarm")
    def test_mirror_prewarm_is_queued_asynchronously(self, queue_prewarm, delay):
        from .models import MirrorPrewarmJob

        job = MirrorPrewarmJob.objects.create(
            dedupe_key="test-profile", requested_components=["kubernetes", "k3s"]
        )
        queue_prewarm.return_value = (job, True)
        delay.return_value = Mock(id="prewarm-task-1")

        response = self.client.post("/api/mirror/prewarm/", {"force": True}, format="json")

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data["task_id"], "prewarm-task-1")
        self.assertEqual(response.data["job_id"], str(job.job_id))
        queue_prewarm.assert_called_once_with(force=True)
        delay.assert_called_once_with(job_id=str(job.job_id), force=True)

    @override_settings(LINDEPLOY_MIRROR_ENABLED=True)
    @patch("auto_K8S.views.run_mirror_prewarm_task.delay")
    def test_duplicate_mirror_prewarm_returns_existing_job(self, delay):
        from .models import MirrorPrewarmJob

        existing = MirrorPrewarmJob.objects.create(
            dedupe_key="stable-kubernetes-k3s-amd64",
            requested_components=["kubernetes", "k3s"],
            celery_task_id="already-running",
        )
        response = self.client.post("/api/mirror/prewarm/", {"force": False}, format="json")

        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.data["deduplicated"])
        self.assertEqual(response.data["job_id"], str(existing.job_id))
        delay.assert_not_called()

    @patch("auto_K8S.mirror.get_mirror_state_path")
    def test_mirror_state_recovers_final_mapping_from_legacy_output_array(self, get_state_path):
        from .mirror import read_mirror_state

        legacy_state = {
            "components": {
                "kubernetes": [
                    "progress output",
                    {"status": "ready", "active_version": "v1.36.3"},
                ],
                "k3s": [
                    "progress output",
                    {"status": "ready", "active_version": "v1.36.3+k3s1"},
                ],
            }
        }
        get_state_path.return_value.is_file.return_value = True
        get_state_path.return_value.read_text.return_value = json.dumps(legacy_state)

        state = read_mirror_state()

        self.assertEqual(state["components"]["kubernetes"]["status"], "ready")
        self.assertEqual(state["components"]["k3s"]["active_version"], "v1.36.3+k3s1")


class TopologyInventoryTests(TestCase):
    def setUp(self):
        self.credential = Credential.objects.create(
            name="inventory-credential",
            auth_type=Credential.AuthType.PASSWORD,
            username="automation",
            password="test-password",
            become_password="test-become-password",
        )
        self.control_plane = Host.objects.create(
            name="control-01",
            ip_address="192.0.2.10",
            credential=self.credential,
        )
        self.worker = Host.objects.create(
            name="worker-01",
            ip_address="192.0.2.20",
            credential=self.credential,
        )
        self.host_overrides = [
            {
                "host_id": self.control_plane.id,
                "host_name": self.control_plane.name,
                "node_name": "production-control-01",
                "node_role": "control_plane",
                "advertise_address": "192.0.2.10",
            },
            {
                "host_id": self.worker.id,
                "host_name": self.worker.name,
                "node_name": "production-worker-01",
                "node_role": "worker",
                "advertise_address": "192.0.2.20",
            },
        ]

    def test_single_node_inventory_keeps_flat_selected_hosts_group(self):
        inventory_path = build_inventory_file(
            [self.control_plane],
            host_overrides=[self.host_overrides[0]],
        )
        inventory = inventory_path.read_text(encoding="utf-8")

        self.assertIn("    selected_hosts:\n      hosts:\n", inventory)
        self.assertNotIn("        control_plane:", inventory)
        self.assertNotIn("lindeploy_desired_role", inventory)
        self.assertIn("lindeploy_node_name: production-control-01", inventory)
        self.assertIn("lindeploy_cluster_name: kubernetes-production-control-01", inventory)

    def test_multi_node_inventory_groups_hosts_and_marks_bootstrap(self):
        inventory_path = build_inventory_file(
            [self.control_plane, self.worker],
            host_overrides=self.host_overrides,
            topology=Installation.Topology.MULTI_NODE,
            bootstrap_host_id=self.control_plane.id,
        )
        inventory = inventory_path.read_text(encoding="utf-8")

        self.assertIn("        control_plane:\n          hosts:\n", inventory)
        self.assertIn("        workers:\n          hosts:\n", inventory)
        self.assertIn("        bootstrap:\n          hosts:\n", inventory)
        self.assertIn("            control-01: {}", inventory)
        self.assertIn("lindeploy_is_bootstrap: true", inventory)
        self.assertIn("lindeploy_desired_role: control_plane", inventory)
        self.assertIn("lindeploy_desired_role: worker", inventory)
        self.assertIn("lindeploy_node_name: production-worker-01", inventory)

    def test_multi_node_inventory_rejects_missing_bootstrap(self):
        with self.assertRaisesMessage(ValueError, "reachable bootstrap host"):
            build_inventory_file(
                [self.control_plane, self.worker],
                host_overrides=self.host_overrides,
                topology=Installation.Topology.MULTI_NODE,
                bootstrap_host_id=99999,
            )

    def test_multi_node_extra_vars_expose_role_groups_and_bootstrap(self):
        extra_vars_path = build_extra_vars_file(
            cluster_config={
                "cluster_name": "production",
                "control_plane_endpoint": "192.0.2.10:6443",
            },
            host_overrides=self.host_overrides,
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            topology=Installation.Topology.MULTI_NODE,
            bootstrap_host_id=self.control_plane.id,
        )
        payload = json.loads(extra_vars_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["deployment_topology"], "multi_node")
        self.assertEqual(payload["bootstrap_host_name"], "control-01")
        self.assertEqual(payload["bootstrap_node_name"], "production-control-01")
        self.assertEqual(payload["primary_host_name"], "control-01")
        self.assertEqual(len(payload["control_plane_hosts"]), 1)
        self.assertEqual(len(payload["worker_hosts"]), 1)

    @override_settings(
        LINDEPLOY_MIRROR_ENABLED=True,
        LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP=False,
        LINDEPLOY_REGISTRY_MIRRORS={
            "registry.k8s.io": "https://mirror.internal:5001",
            "quay.io": "https://mirror.internal:5002",
        },
        LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE="",
        LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED=True,
        LINDEPLOY_PACKAGE_MIRROR_BASE_URL="https://mirror.internal:8443/cache",
        LINDEPLOY_K3S_INSTALL_SCRIPT_URL="https://mirror.internal/cache/get.k3s.io",
        LINDEPLOY_K3S_CHANNEL_URL="https://mirror.internal/cache/k3s-channel",
        LINDEPLOY_K3S_ARTIFACT_URL="https://mirror.internal/cache/k3s-artifacts",
        LINDEPLOY_CALICO_MANIFEST_URL="",
        LINDEPLOY_CONTAINERD_RPM_BASEURL="",
        LINDEPLOY_CONTAINERD_RPM_GPGKEY="",
        LINDEPLOY_CONTAINERD_APT_REPO_URL="",
        LINDEPLOY_CONTAINERD_APT_KEY_URL="",
        LINDEPLOY_KUBERNETES_RPM_BASEURL="",
        LINDEPLOY_KUBERNETES_RPM_GPGKEY="",
        LINDEPLOY_KUBERNETES_APT_REPO_URL="",
        LINDEPLOY_KUBERNETES_APT_KEY_URL="",
    )
    def test_extra_vars_inject_global_mirror_configuration(self):
        extra_vars_path = build_extra_vars_file(
            system_type=InstallationTemplate.SystemType.K3S,
        )
        payload = json.loads(extra_vars_path.read_text(encoding="utf-8"))

        self.assertTrue(payload["lindeploy_mirror_enabled"])
        self.assertEqual(
            payload["lindeploy_registry_mirrors"]["registry.k8s.io"],
            "https://mirror.internal:5001",
        )
        self.assertEqual(
            payload["k3s_install_artifact_url"],
            "https://mirror.internal/cache/k3s-artifacts",
        )
        self.assertTrue(payload["lindeploy_system_package_cache_enabled"])
        self.assertEqual(
            payload["lindeploy_package_mirror_base_url"],
            "https://mirror.internal:8443/cache",
        )
        self.assertNotIn("kubeadm_kubernetes_version", payload)

    @override_settings(
        LINDEPLOY_MIRROR_ENABLED=True,
        LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP=False,
        LINDEPLOY_REGISTRY_MIRRORS={
            "registry.k8s.io": "https://mirror.internal:5001",
        },
        LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE="",
        LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED=False,
        LINDEPLOY_K3S_INSTALL_SCRIPT_URL="",
        LINDEPLOY_K3S_CHANNEL_URL="",
        LINDEPLOY_K3S_ARTIFACT_URL="",
        LINDEPLOY_CALICO_MANIFEST_URL="",
        LINDEPLOY_CONTAINERD_RPM_BASEURL="",
        LINDEPLOY_CONTAINERD_RPM_GPGKEY="",
        LINDEPLOY_CONTAINERD_APT_REPO_URL="",
        LINDEPLOY_CONTAINERD_APT_KEY_URL="",
        LINDEPLOY_KUBERNETES_RPM_BASEURL="",
        LINDEPLOY_KUBERNETES_RPM_GPGKEY="",
        LINDEPLOY_KUBERNETES_APT_REPO_URL="",
        LINDEPLOY_KUBERNETES_APT_KEY_URL="",
        LINDEPLOY_KUBERNETES_PROFILE_ID="kubernetes-v1.36.4-amd64-all-supported",
    )
    def test_kubernetes_uses_verified_prewarmed_control_plane_version(self):
        MirrorProfile.objects.create(
            profile_id="kubernetes-v1.36.4-amd64-all-supported",
            platform="kubernetes", exact_version="v1.36.4", architecture="amd64",
            os_family="supported", os_release="pinned-by-manifest",
            manifest_sha256="a" * 64, content_generation="a" * 64,
            verification_state=MirrorProfile.VerificationState.READY,
        )

        extra_vars_path = build_extra_vars_file(
            system_type=InstallationTemplate.SystemType.KUBERNETES,
        )
        payload = json.loads(extra_vars_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["kubeadm_kubernetes_version"], "v1.36.4")

    @override_settings(
        LINDEPLOY_MIRROR_ENABLED=True,
        LINDEPLOY_MIRROR_CACHE_REQUIRED=True,
        LINDEPLOY_KUBERNETES_PROFILE_ID="kubernetes-v9.9.9-amd64-all-supported",
        LINDEPLOY_REGISTRY_MIRRORS={"registry.k8s.io": "https://mirror.internal:5001"},
        LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP=False,
        LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE="",
        LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED=False,
        LINDEPLOY_K3S_INSTALL_SCRIPT_URL="",
        LINDEPLOY_K3S_CHANNEL_URL="",
        LINDEPLOY_K3S_ARTIFACT_URL="",
        LINDEPLOY_CALICO_MANIFEST_URL="",
        LINDEPLOY_CONTAINERD_RPM_BASEURL="",
        LINDEPLOY_CONTAINERD_RPM_GPGKEY="",
        LINDEPLOY_CONTAINERD_APT_REPO_URL="",
        LINDEPLOY_CONTAINERD_APT_KEY_URL="",
        LINDEPLOY_KUBERNETES_RPM_BASEURL="",
        LINDEPLOY_KUBERNETES_RPM_GPGKEY="",
        LINDEPLOY_KUBERNETES_APT_REPO_URL="",
        LINDEPLOY_KUBERNETES_APT_KEY_URL="",
    )
    def test_cache_required_refuses_missing_exact_profile(self):
        with self.assertRaisesMessage(ValueError, "is not ready"):
            build_extra_vars_file(system_type=InstallationTemplate.SystemType.KUBERNETES)

    @override_settings(
        LINDEPLOY_MIRROR_ENABLED=True,
        LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP=False,
        LINDEPLOY_REGISTRY_MIRRORS={
            "registry.k8s.io": "https://mirror.internal:5001",
        },
        LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE="",
        LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED=True,
        LINDEPLOY_PACKAGE_MIRROR_BASE_URL="http://mirror.internal:8080/cache",
    )
    def test_extra_vars_reject_insecure_system_package_cache(self):
        with self.assertRaisesMessage(
            ValueError,
            "requires an HTTPS LINDEPLOY_PACKAGE_MIRROR_BASE_URL",
        ):
            build_extra_vars_file()

    @override_settings(
        LINDEPLOY_MIRROR_ENABLED=True,
        LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP=False,
        LINDEPLOY_REGISTRY_MIRRORS={},
    )
    def test_extra_vars_reject_enabled_mirror_without_registry_endpoints(self):
        with self.assertRaisesMessage(ValueError, "requires at least one registry"):
            build_extra_vars_file()

    def test_node_names_are_normalized_as_kubernetes_dns_labels(self):
        self.control_plane.hostname = "Control Plane 01.example.local"
        self.control_plane.save(update_fields=["hostname"])

        normalized = normalize_host_overrides(
            [self.control_plane],
            [{"host_id": self.control_plane.id, "node_name": "Control_Plane 01"}],
            InstallationTemplate.SystemType.KUBERNETES,
        )

        self.assertEqual(normalized[0]["node_name"], "control-plane-01")

    def test_node_name_defaults_to_normalized_hostname(self):
        self.control_plane.hostname = "CP-01.EXAMPLE.LOCAL"
        self.control_plane.save(update_fields=["hostname"])

        normalized = normalize_host_overrides(
            [self.control_plane],
            system_type=InstallationTemplate.SystemType.KUBERNETES,
        )

        self.assertEqual(normalized[0]["node_name"], "cp-01-example-local")
        self.assertEqual(
            normalized[0]["cluster_name"],
            "kubernetes-cp-01-example-local",
        )


class CredentialSerializerTests(TestCase):
    def test_password_auth_requires_password(self):
        serializer = CredentialSerializer(
            data={
                "name": "cred-password",
                "auth_type": Credential.AuthType.PASSWORD,
                "username": "user",
                "password": "",
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("password", serializer.errors)

    def test_ssh_key_auth_clears_password(self):
        serializer = CredentialSerializer(
            data={
                "name": "cred-key",
                "auth_type": Credential.AuthType.SSH_KEY,
                "username": "user",
                "private_key": "PRIVATE KEY",
                "password": "should-be-cleared",
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["password"], "")

    def test_secrets_are_omitted_from_serialized_output(self):
        cred = Credential.objects.create(
            name="cred-hidden",
            auth_type=Credential.AuthType.PASSWORD,
            username="secuser",
            password="super-secret-password",
            become_password="super-become-password",
        )
        data = CredentialSerializer(cred).data
        self.assertNotIn("password", data)
        self.assertNotIn("become_password", data)
        self.assertNotIn("private_key", data)
        self.assertTrue(data.get("has_password"))
        self.assertTrue(data.get("has_become_password"))
        self.assertFalse(data.get("has_private_key"))

    def test_update_preserves_existing_password_when_omitted(self):
        cred = Credential.objects.create(
            name="cred-preserve",
            auth_type=Credential.AuthType.PASSWORD,
            username="secuser",
            password="my-existing-password",
        )
        serializer = CredentialSerializer(
            cred,
            data={"name": "cred-preserve-renamed"},
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        updated = serializer.save()
        self.assertEqual(updated.password, "my-existing-password")


class ApiSecurityAndVaultTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_unauthenticated_api_endpoints_return_401(self):
        self.assertEqual(self.client.get("/api/hosts/").status_code, 401)
        self.assertEqual(self.client.get("/api/credentials/").status_code, 401)
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 401)
        self.assertEqual(self.client.get("/api/templates/").status_code, 401)

    def test_public_health_check_returns_200_unauthenticated(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("status"), "ok")

    def test_public_registration_never_grants_admin_privileges(self):
        response = self.client.post(
            "/api/auth/register/",
            {
                "email": "attacker@example.com",
                "username": "attacker",
                "password": "Password123!",
                "is_staff": True,
                "is_superuser": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username="attacker")
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)

    def test_vault_encrypt_decrypt_roundtrip(self):
        from .vault import decrypt_secret, encrypt_secret, is_encrypted

        raw_secret = "P@ssw0rd with spaces and 'quotes' & symbols!"
        encrypted = encrypt_secret(raw_secret)
        self.assertTrue(is_encrypted(encrypted))
        self.assertNotEqual(encrypted, raw_secret)
        self.assertEqual(decrypt_secret(encrypted), raw_secret)

        # Legacy plaintext passthrough
        self.assertEqual(decrypt_secret("unencrypted-legacy-secret"), "unencrypted-legacy-secret")

    def test_encrypt_credentials_management_command_and_rollback(self):
        from django.core.management import call_command
        from .vault import is_encrypted

        cred = Credential.objects.create(
            name="cmd-cred",
            auth_type=Credential.AuthType.PASSWORD,
            username="cmduser",
            password="test-command-password",
            become_password="test-command-become",
        )

        # Dry run does not persist
        call_command("encrypt_credentials", dry_run=True)
        cred.refresh_from_db()
        self.assertFalse(is_encrypted(cred.password))

        # Real encryption
        call_command("encrypt_credentials")
        cred.refresh_from_db()
        self.assertTrue(is_encrypted(cred.password))
        self.assertTrue(is_encrypted(cred.become_password))

        # Rollback decryption
        call_command("encrypt_credentials", decrypt=True)
        cred.refresh_from_db()
        self.assertFalse(is_encrypted(cred.password))
        self.assertEqual(cred.password, "test-command-password")
        self.assertEqual(cred.become_password, "test-command-become")


class TemplateSerializerTests(TestCase):
    def test_rejects_absolute_playbook_path(self):
        serializer = InstallationTemplateSerializer(
            data={
                "name": "bad-template",
                "playbook_path": "/tmp/playbook.yml",
                "deployment_type": InstallationTemplate.DeploymentType.SINGLE_NODE,
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("playbook_path", serializer.errors)


class InstallationTopologyModelTests(TestCase):
    def setUp(self):
        self.host = Host.objects.create(
            name="topology-node-01",
            ip_address="192.0.2.30",
        )
        self.template = InstallationTemplate.objects.create(
            name="topology-model-template",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            playbook_path="playbooks/test_topology_model.yml",
            deployment_type=InstallationTemplate.DeploymentType.SINGLE_NODE,
        )

    def test_existing_creation_path_defaults_to_single_node_bootstrap(self):
        installation = Installation.objects.create(template=self.template)
        target = InstallationTarget.objects.create(
            installation=installation,
            host=self.host,
        )

        self.assertEqual(installation.topology, Installation.Topology.SINGLE_NODE)
        self.assertIsNone(installation.bootstrap_host)
        self.assertEqual(target.desired_role, InstallationTarget.DesiredRole.CONTROL_PLANE)
        self.assertTrue(target.is_bootstrap)
        self.assertEqual(target.join_status, InstallationTarget.JoinStatus.NOT_APPLICABLE)

    def test_multi_node_topology_stores_bootstrap_and_worker_state(self):
        installation = Installation.objects.create(
            template=self.template,
            topology=Installation.Topology.MULTI_NODE,
            cluster_name="production",
            control_plane_endpoint="192.0.2.30:6443",
            bootstrap_host=self.host,
        )
        target = InstallationTarget.objects.create(
            installation=installation,
            host=self.host,
            desired_role=InstallationTarget.DesiredRole.CONTROL_PLANE,
            is_bootstrap=True,
            join_status=InstallationTarget.JoinStatus.JOINED,
            node_name="production-cp-01",
        )

        self.assertEqual(installation.topology, Installation.Topology.MULTI_NODE)
        self.assertEqual(installation.bootstrap_host, self.host)
        self.assertEqual(target.node_name, "production-cp-01")
        self.assertEqual(target.join_status, InstallationTarget.JoinStatus.JOINED)

    def test_successful_multi_node_worker_recap_marks_join_complete(self):
        installation = Installation.objects.create(
            template=self.template,
            topology=Installation.Topology.MULTI_NODE,
            cluster_name="production",
            control_plane_endpoint="192.0.2.30:6443",
            bootstrap_host=self.host,
        )
        target = InstallationTarget.objects.create(
            installation=installation,
            host=self.host,
            desired_role=InstallationTarget.DesiredRole.WORKER,
            is_bootstrap=False,
            join_status=InstallationTarget.JoinStatus.NOT_STARTED,
            node_name="production-worker-01",
        )

        apply_playbook_results(
            [target],
            "PLAY RECAP\n"
            "topology-node-01 : ok=10 changed=1 unreachable=0 failed=0 "
            "skipped=2 rescued=0 ignored=0\n",
            "",
            0,
        )

        target.refresh_from_db()
        self.assertEqual(target.status, InstallationTarget.Status.SUCCESS)
        self.assertEqual(target.join_status, InstallationTarget.JoinStatus.JOINED)


class ConnectivityParserTests(TestCase):
    def test_marks_missing_hosts_as_failed(self):
        parsed = parse_connectivity_output(
            stdout_text="target1 | SUCCESS => {\"ping\": \"pong\"}",
            stderr_text="",
            expected_hosts=["target1", "target2"],
        )

        by_host = {item["host"]: item for item in parsed}
        self.assertEqual(by_host["target1"]["status"], "success")
        self.assertEqual(by_host["target2"]["status"], "failed")


class PlayRecapParserTests(TestCase):
    def test_extracts_per_host_status_from_play_recap(self):
        recap = parse_play_recap(
            """
PLAY RECAP *********************************************************************
target1                    : ok=10   changed=3    unreachable=0    failed=0    skipped=1    rescued=0    ignored=0
target2                    : ok=8    changed=2    unreachable=0    failed=1    skipped=2    rescued=0    ignored=0
            """.strip()
        )

        self.assertEqual(recap["target1"]["failed"], 0)
        self.assertEqual(recap["target1"]["unreachable"], 0)
        self.assertEqual(recap["target2"]["failed"], 1)

    def test_zero_return_code_without_recap_is_not_a_success(self):
        credential = Credential.objects.create(
            name="missing-recap-credential",
            auth_type=Credential.AuthType.PASSWORD,
            username="user",
            password="secret",
        )
        host = Host.objects.create(
            name="missing-recap-host",
            ip_address="192.0.2.90",
            credential=credential,
        )
        template = InstallationTemplate.objects.create(
            name="missing-recap-template",
            playbook_path="playbooks/test_missing_recap.yml",
        )
        installation = Installation.objects.create(template=template)
        target = InstallationTarget.objects.create(
            installation=installation,
            host=host,
        )

        result = apply_playbook_results([target], "", "", 0)

        target.refresh_from_db()
        self.assertEqual(target.status, InstallationTarget.Status.FAILED)
        self.assertEqual(result["success_count"], 0)
        self.assertEqual(result["failed_count"], 1)
        self.assertIn("without a PLAY RECAP", target.output)


class InstallationTargetOperatorIssueTests(TestCase):
    def test_serializes_k3s_conflict_as_actionable_issue(self):
        host = Host.objects.create(
            name="node-with-k3s",
            ip_address="192.0.2.10",
        )
        template = InstallationTemplate.objects.create(
            name="kubernetes-single-node-operator-issue-test",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            playbook_path="playbooks/test_kubernetes_operator_issue.yml",
            deployment_type=InstallationTemplate.DeploymentType.SINGLE_NODE,
        )
        installation = Installation.objects.create(
            template=template,
            status=Installation.Status.FAILED,
            phase=Installation.Phase.FAILED,
        )
        InstallationTarget.objects.create(
            installation=installation,
            host=host,
            status=InstallationTarget.Status.FAILED,
            stderr=(
                'fatal: [node-with-k3s]: FAILED! => {"msg": "Kubernetes cannot be installed '
                "because K3s installation artifacts are still present. Detected artifacts: "
                "/usr/local/bin/k3s, /etc/rancher/k3s/k3s.yaml. "
                'No Kubernetes system changes were applied."}'
            ),
            return_code=2,
        )

        payload = InstallationSerializer(installation).data
        issue = payload["targets"][0]["operator_issue"]

        self.assertEqual(issue["code"], "k3s_conflict")
        self.assertEqual(issue["cleanup_system"], InstallationTemplate.SystemType.K3S)
        self.assertEqual(
            issue["artifacts"],
            ["/usr/local/bin/k3s", "/etc/rancher/k3s/k3s.yaml"],
        )

    def test_serializes_kubernetes_conflict_as_actionable_issue(self):
        host = Host.objects.create(
            name="node-with-kubernetes",
            ip_address="192.0.2.11",
        )
        template = InstallationTemplate.objects.create(
            name="k3s-single-node-operator-issue-test",
            system_type=InstallationTemplate.SystemType.K3S,
            playbook_path="playbooks/test_k3s_operator_issue.yml",
            deployment_type=InstallationTemplate.DeploymentType.SINGLE_NODE,
        )
        installation = Installation.objects.create(
            template=template,
            status=Installation.Status.FAILED,
            phase=Installation.Phase.FAILED,
        )
        InstallationTarget.objects.create(
            installation=installation,
            host=host,
            status=InstallationTarget.Status.FAILED,
            stderr=(
                'fatal: [node-with-kubernetes]: FAILED! => {"msg": "K3s cannot be installed '
                "because Kubernetes installation artifacts are still present. Run the Kubernetes "
                "cleanup workflow. Detected artifacts: /etc/kubernetes/admin.conf, "
                '/etc/cni/net.d/10-calico.conflist. No K3s system changes were applied."}'
            ),
            return_code=2,
        )

        payload = InstallationSerializer(installation).data
        issue = payload["targets"][0]["operator_issue"]

        self.assertEqual(issue["code"], "kubernetes_conflict")
        self.assertEqual(
            issue["cleanup_system"],
            InstallationTemplate.SystemType.KUBERNETES,
        )
        self.assertEqual(
            issue["artifacts"],
            ["/etc/kubernetes/admin.conf", "/etc/cni/net.d/10-calico.conflist"],
        )

    def test_serializes_kubernetes_identity_conflict_as_reset_action(self):
        host = Host.objects.create(
            name="renamed-node",
            ip_address="192.0.2.12",
        )
        template = InstallationTemplate.objects.create(
            name="kubernetes-identity-operator-issue-test",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            playbook_path="playbooks/test_kubernetes_identity_issue.yml",
            deployment_type=InstallationTemplate.DeploymentType.MULTI_NODE,
        )
        installation = Installation.objects.create(
            template=template,
            status=Installation.Status.FAILED,
            phase=Installation.Phase.FAILED,
        )
        InstallationTarget.objects.create(
            installation=installation,
            host=host,
            status=InstallationTarget.Status.FAILED,
            stderr=(
                'fatal: [renamed-node]: FAILED! => {"msg": "Existing Kubernetes '
                "cluster identity does not match the requested configuration. "
                'Run Reset Cluster."}'
            ),
            return_code=2,
        )

        issue = InstallationSerializer(installation).data["targets"][0]["operator_issue"]

        self.assertEqual(issue["code"], "kubernetes_identity_conflict")
        self.assertEqual(
            issue["cleanup_system"],
            InstallationTemplate.SystemType.KUBERNETES,
        )


class BaselineDetectionTests(TestCase):
    def test_classifies_initialized_when_admin_conf_exists(self):
        state = classify_baseline_facts({"admin_conf_exists": True})
        self.assertEqual(state, Host.BaselineState.INITIALIZED)

    def test_classifies_prepared_when_node_prerequisites_exist(self):
        state = classify_baseline_facts(
            {
                "admin_conf_exists": False,
                "containerd_installed": True,
                "containerd_active": True,
                "kubelet_installed": True,
                "kubeadm_installed": True,
                "kubectl_installed": True,
                "swap_disabled": True,
                "modules_configured": True,
                "sysctl_configured": True,
            }
        )
        self.assertEqual(state, Host.BaselineState.PREPARED)


class HostSerializerTests(TestCase):
    def test_normalizes_known_os_type_aliases(self):
        credential = Credential.objects.create(
            name="cred-host-os-known",
            auth_type=Credential.AuthType.PASSWORD,
            username="user",
            password="secret",
        )

        serializer = HostSerializer(
            data={
                "name": "target-os-known",
                "hostname": "target-os-known.example.local",
                "ip_address": "192.168.100.61",
                "ssh_port": 22,
                "os_type": "Ubuntu 24.04",
                "node_role": Host.NodeRole.STANDALONE,
                "enabled": True,
                "credential": credential.id,
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        host = serializer.save()
        self.assertEqual(host.os_type, "ubuntu24.04")

    def test_normalizes_custom_os_type_values(self):
        credential = Credential.objects.create(
            name="cred-host-os-custom",
            auth_type=Credential.AuthType.PASSWORD,
            username="user",
            password="secret",
        )

        serializer = HostSerializer(
            data={
                "name": "target-os-custom",
                "hostname": "target-os-custom.example.local",
                "ip_address": "192.168.100.62",
                "ssh_port": 22,
                "os_type": "Oracle Linux 9",
                "node_role": Host.NodeRole.STANDALONE,
                "enabled": True,
                "credential": credential.id,
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        host = serializer.save()
        self.assertEqual(host.os_type, "oracle-linux-9")

    def test_rejects_invalid_custom_os_type_characters(self):
        credential = Credential.objects.create(
            name="cred-host-os-invalid",
            auth_type=Credential.AuthType.PASSWORD,
            username="user",
            password="secret",
        )

        serializer = HostSerializer(
            data={
                "name": "target-os-invalid",
                "hostname": "target-os-invalid.example.local",
                "ip_address": "192.168.100.63",
                "ssh_port": 22,
                "os_type": "oracle/linux/9",
                "node_role": Host.NodeRole.STANDALONE,
                "enabled": True,
                "credential": credential.id,
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("os_type", serializer.errors)

    def test_resets_cached_detection_when_connection_fields_change(self):
        credential = Credential.objects.create(
            name="cred-host-reset",
            auth_type=Credential.AuthType.PASSWORD,
            username="user",
            password="secret",
        )
        host = Host.objects.create(
            name="target-reset",
            ip_address="192.168.100.31",
            credential=credential,
            baseline_state=Host.BaselineState.PREPARED,
            baseline_facts={"containerd_installed": True},
        )

        serializer = HostSerializer(
            host,
            data={
                "name": host.name,
                "hostname": host.hostname,
                "ip_address": "192.168.100.32",
                "ssh_port": host.ssh_port,
                "os_type": host.os_type,
                "node_role": host.node_role,
                "enabled": host.enabled,
                "credential": credential.id,
            },
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        host.refresh_from_db()

        self.assertEqual(host.baseline_state, Host.BaselineState.UNKNOWN)
        self.assertEqual(host.baseline_facts, {})
        self.assertIsNone(host.last_detection_at)


class DashboardApiTests(TestCase):
    def setUp(self):
        self.client = make_authenticated_client("dashboard_user")
        credential = Credential.objects.create(
            name="cred-1",
            auth_type=Credential.AuthType.PASSWORD,
            username="user",
            password="secret",
        )
        Host.objects.create(
            name="target1",
            ip_address="192.168.100.10",
            credential=credential,
        )
        template = InstallationTemplate.objects.create(
            name="single-node",
            playbook_path="playbooks/test_dashboard_single_node.yml",
        )
        Installation.objects.create(template=template)

    def test_dashboard_endpoint_returns_counts(self):
        response = self.client.get("/api/dashboard/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["hosts"]["total"], 1)
        self.assertIn("unknown", payload["hosts"])
        self.assertEqual(payload["credentials"]["total"], 1)
        self.assertEqual(payload["installations"]["total"], 1)


class TemplatesApiTests(TestCase):
    def setUp(self):
        self.client = make_authenticated_client("templates_user")
        InstallationTemplate.objects.create(
            name="k8s-template",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            playbook_path="playbooks/test_templates_kubernetes.yml",
        )
        InstallationTemplate.objects.create(
            name="k3s-template",
            system_type=InstallationTemplate.SystemType.K3S,
            playbook_path="playbooks/test_templates_k3s.yml",
        )

    def test_templates_endpoint_can_filter_by_system_type(self):
        response = self.client.get("/api/templates/?system_type=kubernetes")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreaterEqual(len(payload), 1)
        self.assertTrue(
            all(item["system_type"] == InstallationTemplate.SystemType.KUBERNETES for item in payload)
        )


class HostDetectionApiTests(TestCase):
    def setUp(self):
        self.client = make_authenticated_client("host_detect_user")
        self.credential = Credential.objects.create(
            name="cred-detect",
            auth_type=Credential.AuthType.PASSWORD,
            username="user",
            password="secret",
        )
        self.host = Host.objects.create(
            name="target-detect",
            ip_address="192.168.100.41",
            credential=self.credential,
        )

    @patch("auto_K8S.views.detect_hosts_baseline")
    def test_detect_endpoint_returns_reachable_state(self, detect_hosts_baseline_mock):
        detect_hosts_baseline_mock.return_value = {
            "command": "ansible selected_hosts -m shell",
            "execution_seconds": 1.2,
            "detections": [
                {
                    "id": self.host.id,
                    "name": self.host.name,
                    "ip_address": self.host.ip_address,
                    "host": self.host.name,
                    "reachable": True,
                    "baseline_state": Host.BaselineState.PREPARED,
                    "facts": {"containerd_installed": True},
                    "detail": "ok",
                }
            ],
        }

        response = self.client.post(f"/api/hosts/{self.host.id}/detect/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["host"]["baseline_state"], Host.BaselineState.PREPARED)
        self.assertEqual(payload["timings"]["detection_seconds"], 1.2)


class LaunchInstallationAutoModeTests(TestCase):
    def setUp(self):
        self.client = make_authenticated_client("launch_auto_user")
        self.credential = Credential.objects.create(
            name="cred-launch",
            auth_type=Credential.AuthType.PASSWORD,
            username="user",
            password="secret",
        )
        self.host = Host.objects.create(
            name="target-launch",
            ip_address="192.168.100.51",
            credential=self.credential,
        )
        self.host_two = Host.objects.create(
            name="target-launch-2",
            ip_address="192.168.100.52",
            credential=self.credential,
        )
        self.template, _ = InstallationTemplate.objects.get_or_create(
            playbook_path="playbooks/init_single_node.yml",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            defaults={
                "name": "init-single-node",
                "deployment_type": InstallationTemplate.DeploymentType.SINGLE_NODE,
            },
        )

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_uses_automatic_selection(self, select_template_mock, run_task_mock):
        select_template_mock.return_value = {
            "template": self.template,
            "strategy": "prepared",
            "detections": [
                {
                    "id": self.host.id,
                    "name": self.host.name,
                    "baseline_state": Host.BaselineState.PREPARED,
                    "reachable": True,
                }
            ],
            "detection_command": "ansible selected_hosts -m shell",
            "detection_seconds": 0.9,
        }
        run_task_mock.delay.return_value = Mock(id="celery-task-1")

        response = self.client.post(
            "/api/installations/launch/",
            {"host_ids": [self.host.id], "deployment_mode": "auto"},
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        payload = response.json()
        self.assertEqual(payload["selected_strategy"], "prepared")
        self.assertEqual(payload["selected_playbook"], "playbooks/init_single_node.yml")
        select_template_mock.assert_called_once()
        run_task_mock.delay.assert_called_once()

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_accepts_multiple_hosts_for_single_node_per_target(self, select_template_mock, run_task_mock):
        select_template_mock.return_value = {
            "template": self.template,
            "strategy": "full",
            "detections": [],
        }
        run_task_mock.delay.return_value = Mock(id="celery-task-multi")

        response = self.client.post(
            "/api/installations/launch/",
            {
                "host_ids": [self.host.id, self.host_two.id],
                "deployment_mode": "auto",
                "system_type": "kubernetes",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(installation.targets.count(), 2)
        self.assertEqual(installation.topology, Installation.Topology.SINGLE_NODE)
        self.assertIsNone(installation.bootstrap_host)
        self.assertTrue(all(target.is_bootstrap for target in installation.targets.all()))

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_persists_valid_multi_node_topology(self, select_template_mock, run_task_mock):
        multi_node_template = InstallationTemplate.objects.create(
            name="kubernetes-multi-node-template",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            playbook_path="playbooks/test_launch_k8s_multi_node.yml",
            deployment_type=InstallationTemplate.DeploymentType.MULTI_NODE,
        )
        select_template_mock.return_value = {
            "template": multi_node_template,
            "strategy": "multi_node",
            "detections": [],
            "eligible_host_names": [self.host.name, self.host_two.name],
        }
        run_task_mock.delay.return_value = Mock(id="celery-task-multi-node")

        response = self.client.post(
            "/api/installations/launch/",
            {
                "topology": "multi_node",
                "system_type": "kubernetes",
                "control_plane_host_ids": [self.host.id],
                "worker_host_ids": [self.host_two.id],
                "bootstrap_host_id": self.host.id,
                "cluster_config": {"cluster_name": "production"},
                "host_overrides": [
                    {"host_id": self.host.id, "node_name": "production-cp-01"},
                    {"host_id": self.host_two.id, "node_name": "production-worker-01"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202, response.json())
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(installation.topology, Installation.Topology.MULTI_NODE)
        self.assertEqual(installation.cluster_name, "production")
        self.assertEqual(installation.control_plane_endpoint, "192.168.100.51:6443")
        self.assertEqual(installation.bootstrap_host, self.host)

        targets = {target.host_id: target for target in installation.targets.all()}
        self.assertEqual(
            targets[self.host.id].desired_role,
            InstallationTarget.DesiredRole.CONTROL_PLANE,
        )
        self.assertTrue(targets[self.host.id].is_bootstrap)
        self.assertEqual(
            targets[self.host.id].join_status,
            InstallationTarget.JoinStatus.NOT_APPLICABLE,
        )
        self.assertEqual(
            targets[self.host_two.id].desired_role,
            InstallationTarget.DesiredRole.WORKER,
        )
        self.assertFalse(targets[self.host_two.id].is_bootstrap)
        self.assertEqual(
            targets[self.host_two.id].join_status,
            InstallationTarget.JoinStatus.NOT_STARTED,
        )
        self.assertEqual(targets[self.host_two.id].node_name, "production-worker-01")
        self.assertEqual(response.json()["topology"], "multi_node")

    def test_launch_rejects_host_in_both_multi_node_roles(self):
        response = self.client.post(
            "/api/installations/launch/",
            {
                "topology": "multi_node",
                "control_plane_host_ids": [self.host.id],
                "worker_host_ids": [self.host.id],
                "bootstrap_host_id": self.host.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("worker_host_ids", response.json()["errors"])

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_rejects_duplicate_normalized_multi_node_names(
        self, select_template_mock, run_task_mock
    ):
        response = self.client.post(
            "/api/installations/launch/",
            {
                "topology": "multi_node",
                "system_type": "kubernetes",
                "control_plane_host_ids": [self.host.id],
                "worker_host_ids": [self.host_two.id],
                "bootstrap_host_id": self.host.id,
                "host_overrides": [
                    {"host_id": self.host.id, "node_name": "NODE 01"},
                    {"host_id": self.host_two.id, "node_name": "node-01"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Duplicate node names", response.json()["errors"]["host_overrides"])
        select_template_mock.assert_not_called()
        run_task_mock.delay.assert_not_called()

    def test_launch_rejects_bootstrap_outside_control_plane_group(self):
        response = self.client.post(
            "/api/installations/launch/",
            {
                "topology": "multi_node",
                "control_plane_host_ids": [self.host.id],
                "worker_host_ids": [self.host_two.id],
                "bootstrap_host_id": self.host_two.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("bootstrap_host_id", response.json()["errors"])

    def test_launch_rejects_multi_node_without_worker(self):
        response = self.client.post(
            "/api/installations/launch/",
            {
                "topology": "multi_node",
                "control_plane_host_ids": [self.host.id],
                "bootstrap_host_id": self.host.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("worker_host_ids", response.json()["errors"])

    def test_launch_rejects_single_node_template_for_multi_node_request(self):
        response = self.client.post(
            "/api/installations/launch/",
            {
                "topology": "multi_node",
                "deployment_mode": "manual",
                "template_id": self.template.id,
                "system_type": "kubernetes",
                "control_plane_host_ids": [self.host.id],
                "worker_host_ids": [self.host_two.id],
                "bootstrap_host_id": self.host.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("not a multi-node", response.json()["message"])

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_maps_k3s_multi_node_roles_to_server_and_agent(
        self,
        select_template_mock,
        run_task_mock,
    ):
        k3s_template, _ = InstallationTemplate.objects.get_or_create(
            system_type=InstallationTemplate.SystemType.K3S,
            playbook_path="playbooks/k3s_multi_node.yml",
            defaults={
                "name": "k3s-multi-node-template",
                "deployment_type": InstallationTemplate.DeploymentType.MULTI_NODE,
            },
        )
        select_template_mock.return_value = {
            "template": k3s_template,
            "strategy": "multi_node",
            "detections": [],
        }
        run_task_mock.delay.return_value = Mock(id="celery-task-k3s-multi-node")

        response = self.client.post(
            "/api/installations/launch/",
            {
                "topology": "multi_node",
                "system_type": "k3s",
                "control_plane_host_ids": [self.host.id],
                "worker_host_ids": [self.host_two.id],
                "bootstrap_host_id": self.host.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202, response.json())
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        roles_by_host_id = {
            item["host_id"]: item["node_role"] for item in installation.host_overrides
        }
        self.assertEqual(roles_by_host_id[self.host.id], "server")
        self.assertEqual(roles_by_host_id[self.host_two.id], "agent")

    def test_select_installation_template_resolves_k3s_multi_node(self):
        result = select_installation_template(
            [self.host, self.host_two],
            system_type="k3s",
            topology="multi_node",
        )
        self.assertEqual(result["template"].playbook_path, "playbooks/k3s_multi_node.yml")
        self.assertEqual(result["template"].system_type, "k3s")
        self.assertEqual(result["template"].deployment_type, "multi_node")
        self.assertEqual(result["strategy"], "multi_node")

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_rejects_host_used_by_active_execution(
        self,
        select_template_mock,
        run_task_mock,
    ):
        active_installation = Installation.objects.create(
            template=self.template,
            status=Installation.Status.RUNNING,
        )
        InstallationTarget.objects.create(
            installation=active_installation,
            host=self.host,
        )

        response = self.client.post(
            "/api/installations/launch/",
            {"host_ids": [self.host.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["errors"]["busy_hosts"][0]["host_id"], self.host.id)
        select_template_mock.assert_not_called()
        run_task_mock.delay.assert_not_called()

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_releases_host_from_stale_pre_execution_job(
        self,
        select_template_mock,
        run_task_mock,
    ):
        stale_installation = Installation.objects.create(
            template=self.template,
            status=Installation.Status.RUNNING,
            phase=Installation.Phase.SSH_CHECK,
        )
        InstallationTarget.objects.create(
            installation=stale_installation,
            host=self.host,
        )
        Installation.objects.filter(pk=stale_installation.pk).update(
            updated_at=timezone.now() - timezone.timedelta(minutes=20)
        )
        select_template_mock.return_value = {
            "template": self.template,
            "strategy": "single_node",
            "detections": [],
        }
        run_task_mock.delay.return_value = Mock(id="replacement-task")

        response = self.client.post(
            "/api/installations/launch/",
            {"host_ids": [self.host.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 202, response.json())
        stale_installation.refresh_from_db()
        self.assertEqual(stale_installation.status, Installation.Status.CANCELLED)
        self.assertIn("automatically cancelled", stale_installation.summary_message)

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_accepts_k3s_installer(self, select_template_mock, run_task_mock):
        k3s_template = InstallationTemplate.objects.create(
            name="k3s-single-node-template",
            system_type=InstallationTemplate.SystemType.K3S,
            playbook_path="playbooks/test_launch_k3s_single_node.yml",
        )
        select_template_mock.return_value = {
            "template": k3s_template,
            "strategy": "single_node",
            "detections": [],
        }
        run_task_mock.delay.return_value = Mock(id="celery-task-k3s")

        response = self.client.post(
            "/api/installations/launch/",
            {"host_ids": [self.host.id], "deployment_mode": "auto", "system_type": "k3s"},
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(
            response.json()["selected_playbook"],
            "playbooks/test_launch_k3s_single_node.yml",
        )
        select_template_mock.assert_called_once()
        run_task_mock.delay.assert_called_once()

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_accepts_multiple_hosts_for_kubernetes_cleanup(self, select_template_mock, run_task_mock):
        cleanup_template = InstallationTemplate.objects.create(
            name="k8s-cleanup-template",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            playbook_path="playbooks/test_launch_k8s_cleanup.yml",
            deployment_type=InstallationTemplate.DeploymentType.CLEANUP,
        )
        select_template_mock.return_value = {
            "template": cleanup_template,
            "strategy": "manual",
            "detections": [],
        }
        run_task_mock.delay.return_value = Mock(id="celery-task-k8s-cleanup-multi")

        response = self.client.post(
            "/api/installations/launch/",
            {
                "host_ids": [self.host.id, self.host_two.id],
                "deployment_mode": "manual",
                "template_id": cleanup_template.id,
                "system_type": "kubernetes",
                "cluster_config": {
                    "target_modification_approved": True,
                    "cleanup_confirmation": "CLEAN kubernetes-cluster-01 ON "
                    + ",".join(
                        sorted((str(self.host.stable_id), str(self.host_two.stable_id)))
                    ),
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(
            installation.template.playbook_path,
            "playbooks/test_launch_k8s_cleanup.yml",
        )
        self.assertEqual(installation.targets.count(), 2)

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_accepts_multiple_hosts_for_k3s_cleanup(self, select_template_mock, run_task_mock):
        cleanup_template = InstallationTemplate.objects.create(
            name="k3s-cleanup-template",
            system_type=InstallationTemplate.SystemType.K3S,
            playbook_path="playbooks/test_launch_k3s_cleanup.yml",
            deployment_type=InstallationTemplate.DeploymentType.CLEANUP,
        )
        select_template_mock.return_value = {
            "template": cleanup_template,
            "strategy": "manual",
            "detections": [],
        }
        run_task_mock.delay.return_value = Mock(id="celery-task-k3s-cleanup-multi")

        response = self.client.post(
            "/api/installations/launch/",
            {
                "host_ids": [self.host.id, self.host_two.id],
                "deployment_mode": "manual",
                "template_id": cleanup_template.id,
                "system_type": "k3s",
                "cluster_config": {
                    "target_modification_approved": True,
                    "cleanup_confirmation": "CLEAN k3s-cluster-01 ON "
                    + ",".join(
                        sorted((str(self.host.stable_id), str(self.host_two.stable_id)))
                    ),
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(
            installation.template.playbook_path,
            "playbooks/test_launch_k3s_cleanup.yml",
        )
        self.assertEqual(installation.targets.count(), 2)

    @patch("auto_K8S.views.run_installation_task")
    def test_launch_accepts_k3s_multi_node_cleanup(self, run_task_mock):
        cleanup_template, _ = InstallationTemplate.objects.get_or_create(
            system_type=InstallationTemplate.SystemType.K3S,
            playbook_path="playbooks/k3s_multi_node_cleanup.yml",
            defaults={
                "name": "k3s-multi-node-cleanup",
                "deployment_type": InstallationTemplate.DeploymentType.CLEANUP,
            },
        )
        run_task_mock.delay.return_value = Mock(id="celery-task-k3s-multi-cleanup")

        response = self.client.post(
            "/api/installations/launch/",
            {
                "topology": "multi_node",
                "deployment_mode": "manual",
                "template_id": cleanup_template.id,
                "system_type": "k3s",
                "control_plane_host_ids": [self.host.id],
                "worker_host_ids": [self.host_two.id],
                "bootstrap_host_id": self.host.id,
                "cluster_config": {
                    "target_modification_approved": True,
                    "cleanup_confirmation": "CLEAN k3s-cluster-01 ON "
                    + ",".join(
                        sorted((str(self.host.stable_id), str(self.host_two.stable_id)))
                    ),
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202, response.json())
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(
            installation.template.playbook_path,
            "playbooks/k3s_multi_node_cleanup.yml",
        )
        self.assertEqual(installation.targets.count(), 2)
        self.assertEqual(installation.topology, Installation.Topology.MULTI_NODE)


    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_direct_cleanup_launch_succeeds_without_manual_confirmation(self, select_template_mock, run_task_mock):
        cleanup_template = InstallationTemplate.objects.create(
            name="kubernetes-cleanup",
            playbook_path="playbooks/test_direct_cleanup.yml",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            deployment_type=InstallationTemplate.DeploymentType.CLEANUP,
        )
        select_template_mock.return_value = {
            "template": cleanup_template,
            "strategy": "manual",
            "detections": [],
        }
        run_task_mock.delay.return_value = Mock(id="celery-task-cleanup")

        response = self.client.post(
            "/api/installations/launch/",
            {
                "host_ids": [self.host.id],
                "deployment_mode": "manual",
                "template_id": cleanup_template.id,
                "system_type": "kubernetes",
                "cluster_config": {},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        self.assertTrue(run_task_mock.delay.called)

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_persists_cluster_and_host_spec(self, select_template_mock, run_task_mock):
        select_template_mock.return_value = {
            "template": self.template,
            "strategy": "full",
            "detections": [],
        }
        run_task_mock.delay.return_value = Mock(id="celery-task-spec")

        response = self.client.post(
            "/api/installations/launch/",
            {
                "host_ids": [self.host.id],
                "deployment_mode": "auto",
                "cluster_config": {
                    "cluster_name": "lab-k8s-01",
                    "version": "1.36",
                    "pod_cidr": "172.16.0.0/16",
                },
                "host_overrides": [
                    {
                        "host_id": self.host.id,
                        "cluster_name": "Single Lab 01",
                        "node_name": "cp-01",
                        "node_role": "control_plane",
                        "advertise_address": self.host.ip_address,
                        "ansible_user": "custom-user",
                        "ssh_port": 2222,
                        "labels": ["env=lab"],
                        "taints": [],
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(installation.cluster_config["cluster_name"], "lab-k8s-01")
        self.assertEqual(installation.cluster_config["control_plane_count"], 1)
        self.assertEqual(installation.host_overrides[0]["ssh_port"], 2222)
        self.assertEqual(installation.host_overrides[0]["ansible_user"], "custom-user")
        self.assertEqual(installation.host_overrides[0]["cluster_name"], "single-lab-01")
        target = installation.targets.get(host=self.host)
        self.assertEqual(target.node_name, "cp-01")
        self.assertEqual(target.cluster_name, "single-lab-01")


class RunnerConfigTests(TestCase):
    def test_linux_runner_sets_non_interactive_ssh_env(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            (repo_root / "ansible.cfg").write_text("[defaults]\n", encoding="utf-8")
            (repo_root / "roles").mkdir()

            env_prefix = LinuxRunner().build_command_env_prefix(repo_root)

            self.assertEqual(env_prefix["ANSIBLE_TIMEOUT"], "15")
            self.assertEqual(env_prefix["ANSIBLE_HOST_KEY_CHECKING"], "False")
            self.assertIn("StrictHostKeyChecking=no", env_prefix["ANSIBLE_SSH_ARGS"])
            self.assertIn("ConnectTimeout=15", env_prefix["ANSIBLE_SSH_ARGS"])
            self.assertIn("ServerAliveInterval=15", env_prefix["ANSIBLE_SSH_ARGS"])
            self.assertIn("ServerAliveCountMax=3", env_prefix["ANSIBLE_SSH_ARGS"])


class InstallationCancellationApiTests(TestCase):
    def setUp(self):
        self.client = make_authenticated_client("cancel_user")
        self.credential = Credential.objects.create(
            name="cred-cancel",
            auth_type=Credential.AuthType.PASSWORD,
            username="user",
            password="secret",
        )
        self.host = Host.objects.create(
            name="target-cancel",
            ip_address="192.168.100.20",
            credential=self.credential,
        )
        self.template = InstallationTemplate.objects.create(
            name="cancel-template",
            playbook_path="playbooks/test_cancel_installation.yml",
        )

    def test_cancel_endpoint_marks_installation_and_target_cancelled(self):
        installation = Installation.objects.create(
            template=self.template,
            status=Installation.Status.PENDING,
            phase=Installation.Phase.QUEUED,
            summary_message="Queued",
        )
        target = InstallationTarget.objects.create(
            installation=installation,
            host=self.host,
            status=InstallationTarget.Status.PENDING,
        )

        response = self.client.post(f"/api/installations/{installation.id}/cancel/")

        self.assertEqual(response.status_code, 200)
        installation.refresh_from_db()
        target.refresh_from_db()
        self.assertEqual(installation.status, Installation.Status.CANCELLED)
        self.assertEqual(installation.phase, Installation.Phase.CANCELLED)
        self.assertEqual(target.status, InstallationTarget.Status.CANCELLED)


class InstallationHistoryApiTests(TestCase):
    def setUp(self):
        self.client = make_authenticated_client("history_user")
        self.template = InstallationTemplate.objects.create(
            name="history-template",
            playbook_path="playbooks/test_history_installation.yml",
        )

    def test_clear_history_deletes_only_finished_installations(self):
        Installation.objects.create(
            template=self.template,
            status=Installation.Status.SUCCESS,
            phase=Installation.Phase.COMPLETED,
            summary_message="Done",
        )
        running_installation = Installation.objects.create(
            template=self.template,
            status=Installation.Status.RUNNING,
            phase=Installation.Phase.RUNNING_PLAYBOOK,
            summary_message="Running",
        )
        Installation.objects.create(
            template=self.template,
            status=Installation.Status.FAILED,
            phase=Installation.Phase.FAILED,
            summary_message="Failed",
        )

        response = self.client.post("/api/installations/clear-history/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted_count"], 2)
        self.assertEqual(Installation.objects.count(), 1)
        self.assertTrue(Installation.objects.filter(id=running_installation.id).exists())

    def test_delete_history_item_removes_one_finished_installation(self):
        installation = Installation.objects.create(
            template=self.template,
            status=Installation.Status.SUCCESS,
            phase=Installation.Phase.COMPLETED,
            summary_message="Done",
        )

        response = self.client.delete(f"/api/installations/{installation.id}/")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Installation.objects.filter(id=installation.id).exists())

    def test_delete_history_item_rejects_active_installation(self):
        installation = Installation.objects.create(
            template=self.template,
            status=Installation.Status.RUNNING,
            phase=Installation.Phase.RUNNING_PLAYBOOK,
            summary_message="Running",
        )

        response = self.client.delete(f"/api/installations/{installation.id}/")

        self.assertEqual(response.status_code, 409)
        self.assertTrue(Installation.objects.filter(id=installation.id).exists())

    def test_installation_detail_returns_incremental_output_with_offset(self):
        installation = Installation.objects.create(
            template=self.template,
            status=Installation.Status.RUNNING,
            phase=Installation.Phase.RUNNING_PLAYBOOK,
            summary_message="Running",
            celery_task_id="test-task-1234",
        )
        with tempfile.TemporaryDirectory() as directory:
            with override_settings(BASE_DIR=Path(directory)):
                output_path = reset_live_output(installation.id)
                output_lock = threading.Lock()
                for i in range(5):
                    append_live_output_line(
                        output_path,
                        output_lock,
                        channel="stdout",
                        line=f"live line {i}",
                        timestamp="2026-08-16T12:00:00+00:00",
                    )

                response = self.client.get(f"/api/installations/{installation.id}/?offset=2")
                self.assertEqual(response.status_code, 200)
                progress = response.data.get("celery_progress")
                self.assertIsNotNone(progress)
                lines = progress["meta"]["output_lines"]
                self.assertEqual(len(lines), 3)
                self.assertEqual(lines[0]["line"], "live line 2")
                self.assertEqual(progress["meta"]["next_offset"], 5)
                self.assertEqual(progress["meta"]["total_lines"], 5)

    def test_sanitize_log_line_redacts_passwords_with_spaces_and_quotes(self):
        from .services import sanitize_log_line
        test_inputs = [
            'ansible_password: "my secret pass phrase"',
            "ansible_password: 'single quoted phrase'",
            "ansible_password: unquoted secret with spaces",
            'ansible_become_password="sudo pass word", ansible_user=root',
            "ansible_ssh_pass: complex@pass#123",
        ]
        for line in test_inputs:
            sanitized = sanitize_log_line(line)
            self.assertNotIn("secret pass phrase", sanitized)
            self.assertNotIn("single quoted phrase", sanitized)
            self.assertNotIn("sudo pass word", sanitized)
            self.assertNotIn("complex@pass#123", sanitized)
            self.assertIn("<redacted>", sanitized)

    def test_build_inventory_file_handles_complex_passwords_safely(self):
        import yaml
        from .services import build_inventory_file
        cred = Credential.objects.create(
            name="complex-cred",
            auth_type=Credential.AuthType.PASSWORD,
            username="testuser",
            password='P@ss"word with \\backslashes\\ and \n newlines and {{ jinja }}',
            become_password='sudo "secret" with spaces',
        )
        host = Host.objects.create(
            name="test-complex-node",
            ip_address="192.168.1.50",
            ssh_port=22,
            credential=cred,
        )
        inv_path = build_inventory_file([host])
        self.assertTrue(inv_path.exists())
        content = inv_path.read_text(encoding="utf-8")
        parsed = yaml.safe_load(content)
        host_dict = parsed["all"]["children"]["selected_hosts"]["hosts"]["test-complex-node"]
        self.assertEqual(
            host_dict["ansible_password"],
            'P@ss"word with \\backslashes\\ and \n newlines and {{ jinja }}',
        )
        self.assertEqual(
            host_dict["ansible_become_password"],
            'sudo "secret" with spaces',
        )
