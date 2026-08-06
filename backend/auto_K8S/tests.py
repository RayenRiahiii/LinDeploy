import tempfile
from django.test import TestCase
from rest_framework.test import APIClient
from unittest.mock import Mock, patch
from pathlib import Path

from .models import Credential, Host, Installation, InstallationTarget, InstallationTemplate
from .runners.linux_runner import LinuxRunner
from .serializers import (
    CredentialSerializer,
    HostSerializer,
    InstallationSerializer,
    InstallationTemplateSerializer,
)
from .services import (
    classify_baseline_facts,
    parse_connectivity_output,
    parse_play_recap,
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


class InstallationTargetOperatorIssueTests(TestCase):
    def test_serializes_k3s_conflict_as_actionable_issue(self):
        host = Host.objects.create(
            name="node-with-k3s",
            ip_address="192.0.2.10",
        )
        template = InstallationTemplate.objects.create(
            name="kubernetes-single-node-operator-issue-test",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            playbook_path="playbooks/k8s_single_node.yml",
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
            playbook_path="playbooks/k3s_single_node.yml",
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
        self.client = APIClient()
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
            playbook_path="playbooks/k8s_single_node.yml",
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
        self.client = APIClient()
        InstallationTemplate.objects.create(
            name="k8s-template",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            playbook_path="playbooks/k8s_single_node.yml",
        )
        InstallationTemplate.objects.create(
            name="k3s-template",
            system_type=InstallationTemplate.SystemType.K3S,
            playbook_path="playbooks/k3s_single_node.yml",
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
        self.client = APIClient()
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
        self.client = APIClient()
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
        self.template = InstallationTemplate.objects.create(
            name="init-single-node",
            playbook_path="playbooks/init_single_node.yml",
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

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_accepts_k3s_installer(self, select_template_mock, run_task_mock):
        k3s_template = InstallationTemplate.objects.create(
            name="k3s-single-node-template",
            system_type=InstallationTemplate.SystemType.K3S,
            playbook_path="playbooks/k3s_single_node.yml",
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
        self.assertEqual(response.json()["selected_playbook"], "playbooks/k3s_single_node.yml")
        select_template_mock.assert_called_once()
        run_task_mock.delay.assert_called_once()

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_accepts_multiple_hosts_for_kubernetes_cleanup(self, select_template_mock, run_task_mock):
        cleanup_template = InstallationTemplate.objects.create(
            name="k8s-cleanup-template",
            system_type=InstallationTemplate.SystemType.KUBERNETES,
            playbook_path="playbooks/k8s_cleanup.yml",
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
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(installation.template.playbook_path, "playbooks/k8s_cleanup.yml")
        self.assertEqual(installation.targets.count(), 2)

    @patch("auto_K8S.views.run_installation_task")
    @patch("auto_K8S.views.select_installation_template")
    def test_launch_accepts_multiple_hosts_for_k3s_cleanup(self, select_template_mock, run_task_mock):
        cleanup_template = InstallationTemplate.objects.create(
            name="k3s-cleanup-template",
            system_type=InstallationTemplate.SystemType.K3S,
            playbook_path="playbooks/k3s_cleanup.yml",
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
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(installation.template.playbook_path, "playbooks/k3s_cleanup.yml")
        self.assertEqual(installation.targets.count(), 2)

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
        self.client = APIClient()
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
            playbook_path="playbooks/k8s_single_node.yml",
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
        self.client = APIClient()
        self.template = InstallationTemplate.objects.create(
            name="history-template",
            playbook_path="playbooks/k8s_single_node.yml",
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
