import json
from datetime import timedelta
from unittest.mock import Mock, patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Credential, Host, Installation, InstallationTemplate, OpenShiftSecretBundle
from .openshift_secrets import OpenShiftSecretError, consume_secret_bundle, create_secret_bundle
from .services import normalize_host_overrides


VALID_PULL_SECRET = json.dumps({"auths": {"cloud.redhat.com": {"auth": "hidden"}}})
VALID_PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILinDeployTest"


@override_settings(
    OPENSHIFT_SECRET_ENCRYPTION_KEY="",
    OPENSHIFT_SECRET_TTL_SECONDS=1800,
    OPENSHIFT_RED_HAT_OFFLINE_TOKEN="offline-token-for-test",
)
class OpenShiftSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_secret_endpoint_encrypts_plaintext_and_returns_only_reference(self):
        response = self.client.post(
            "/api/openshift/secrets/",
            {"pull_secret": VALID_PULL_SECRET, "ssh_public_key": VALID_PUBLIC_KEY},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertNotIn("pull_secret", response.json())
        bundle = OpenShiftSecretBundle.objects.get(reference=response.json()["secret_reference"])
        encrypted = bytes(bundle.encrypted_payload)
        self.assertNotIn(b"cloud.redhat.com", encrypted)
        self.assertNotIn(b"AAAAC3", encrypted)

    def test_secret_bundle_is_one_use(self):
        bundle = create_secret_bundle(
            {"pull_secret": VALID_PULL_SECRET, "ssh_public_key": VALID_PUBLIC_KEY}
        )
        _, payload = consume_secret_bundle(bundle.reference)
        self.assertEqual(payload["ssh_public_key"], VALID_PUBLIC_KEY)
        with self.assertRaises(OpenShiftSecretError):
            consume_secret_bundle(bundle.reference)

    def test_expired_secret_bundle_is_rejected(self):
        bundle = create_secret_bundle(
            {"pull_secret": VALID_PULL_SECRET, "ssh_public_key": VALID_PUBLIC_KEY}
        )
        OpenShiftSecretBundle.objects.filter(pk=bundle.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        with self.assertRaises(OpenShiftSecretError):
            consume_secret_bundle(bundle.reference)


@override_settings(
    OPENSHIFT_SECRET_ENCRYPTION_KEY="",
    OPENSHIFT_SECRET_TTL_SECONDS=1800,
    OPENSHIFT_RED_HAT_OFFLINE_TOKEN="offline-token-for-test",
)
class OpenShiftLaunchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        credential = Credential.objects.create(
            name="openshift-kvm-credential",
            auth_type=Credential.AuthType.PASSWORD,
            username="rayen",
            password="ssh-password",
            become_password="sudo-password",
        )
        self.host = Host.objects.create(
            name="openshift-kvm-host",
            hostname="kvm-host.lab.test",
            ip_address="192.168.1.91",
            credential=credential,
        )
        self.template = InstallationTemplate.objects.get(
            system_type=InstallationTemplate.SystemType.OPENSHIFT_SNO,
            playbook_path="playbooks/openshift_sno.yml",
        )
        self.disconnected_template = InstallationTemplate.objects.get(
            system_type=InstallationTemplate.SystemType.OPENSHIFT_SNO,
            playbook_path="playbooks/openshift_sno_disconnected.yml",
        )
        self.mirror_template = InstallationTemplate.objects.get(
            system_type=InstallationTemplate.SystemType.OPENSHIFT_SNO,
            playbook_path="playbooks/openshift_mirror_prepare.yml",
        )
        self.cleanup_template = InstallationTemplate.objects.get(
            system_type=InstallationTemplate.SystemType.OPENSHIFT_SNO,
            playbook_path="playbooks/openshift_sno_cleanup.yml",
        )

    def request_payload(self, reference, confirmation="ERASE /dev/vda", disconnected=False):
        return {
            "deployment_mode": "manual",
            "system_type": "openshift_sno",
            "topology": "single_node",
            "template_id": self.template.id,
            "host_ids": [self.host.id],
            "cluster_config": {
                "cluster_name": "sno-test",
                "base_domain": "lab.test",
                "machine_network_cidr": "192.168.130.0/24",
                "rendezvous_ip": "192.168.130.10",
                "cluster_network_cidr": "10.128.0.0/14",
                "service_network_cidr": "172.30.0.0/16",
                "host_prefix": 23,
                "dns_servers": ["192.168.130.1"],
                "secret_reference": str(reference),
                "target_modification_approved": True,
                "install_confirmation": confirmation,
                "disconnected": disconnected,
            },
            "host_overrides": [{
                "host_id": self.host.id,
                "vm_name": "sno-test",
                "node_name": "sno-test-node",
                "node_ip": "192.168.130.10",
                "prefix_length": 24,
                "gateway": "192.168.130.1",
                "interface_name": "enp1s0",
                "installation_disk": "/dev/vda",
                "libvirt_network": "sno-workshop",
                "storage_pool": "sno-pool",
                "vcpu": 8,
                "memory_gib": 24,
                "disk_gib": 150,
                "network_mode": "dhcp_reservation",
            }],
        }

    def create_bundle(self, disconnected=False, include_mirror_ca=True):
        mirror_values = (
            {
                "mirror_ca_bundle": (
                    "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----"
                    if include_mirror_ca
                    else ""
                ),
                "mirror_username": "mirror-user",
                "mirror_password": "mirror-password",
            }
            if disconnected
            else {}
        )
        return create_secret_bundle(
            {
                "pull_secret": VALID_PULL_SECRET,
                "ssh_public_key": VALID_PUBLIC_KEY,
                **mirror_values,
            }
        )

    def test_launch_rejects_wrong_disk_confirmation(self):
        response = self.client.post(
            "/api/installations/launch/",
            self.request_payload(self.create_bundle().reference, "ERASE /dev/sda"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Installation.objects.count(), 0)

    def test_connected_template_rejects_disconnected_mode(self):
        response = self.client.post(
            "/api/installations/launch/",
            self.request_payload(self.create_bundle().reference, disconnected=True),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("disconnected template", response.json()["message"])

    @override_settings(OPENSHIFT_RED_HAT_OFFLINE_TOKEN="")
    @patch("auto_K8S.views.run_installation_task")
    def test_disconnected_launch_does_not_require_assisted_installer_token(self, run_task_mock):
        run_task_mock.delay.return_value = Mock(id="openshift-disconnected-task")
        bundle = self.create_bundle(disconnected=True)
        payload = self.request_payload(bundle.reference, disconnected=True)
        payload["template_id"] = self.disconnected_template.id
        payload["cluster_config"].update(
            {
                "openshift_version": "4.20.3",
                "mirror_registry": "registry.lab.test:8443",
                "mirror_ca_configured": True,
            }
        )

        response = self.client.post("/api/installations/launch/", payload, format="json")

        self.assertEqual(response.status_code, 202)
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(installation.template, self.disconnected_template)
        serialized = json.dumps(installation.cluster_config)
        self.assertNotIn("mirror-password", serialized)
        self.assertNotIn("BEGIN CERTIFICATE", serialized)
        run_task_mock.delay.assert_called_once_with(installation.id)

    @patch("auto_K8S.views.run_installation_task")
    def test_disconnected_launch_accepts_locally_managed_mirror_ca(self, run_task_mock):
        run_task_mock.delay.return_value = Mock(id="openshift-local-ca-task")
        bundle = self.create_bundle(disconnected=True, include_mirror_ca=False)
        payload = self.request_payload(bundle.reference, disconnected=True)
        payload["template_id"] = self.disconnected_template.id
        payload["cluster_config"].update(
            {
                "openshift_version": "4.20.3",
                "mirror_registry": "registry.lab.test:8443",
                "mirror_ca_configured": False,
            }
        )

        response = self.client.post("/api/installations/launch/", payload, format="json")

        self.assertEqual(response.status_code, 202)
        run_task_mock.delay.assert_called_once()

    @patch("auto_K8S.views.run_installation_task")
    def test_mirror_preparation_does_not_require_sno_network_or_disk_approval(self, run_task_mock):
        run_task_mock.delay.return_value = Mock(id="openshift-mirror-task")
        bundle = self.create_bundle(disconnected=True)
        payload = self.request_payload(bundle.reference, disconnected=True)
        payload["template_id"] = self.mirror_template.id
        payload["cluster_config"].update(
            {
                "openshift_version": "4.20.3",
                "mirror_registry": "registry.lab.test:8443",
            }
        )
        payload["cluster_config"].pop("machine_network_cidr")
        payload["cluster_config"].pop("rendezvous_ip")
        payload["cluster_config"]["target_modification_approved"] = False
        payload["cluster_config"]["install_confirmation"] = ""

        response = self.client.post("/api/installations/launch/", payload, format="json")

        self.assertEqual(response.status_code, 202)
        run_task_mock.delay.assert_called_once()

    @patch("auto_K8S.views.run_installation_task")
    def test_cleanup_does_not_require_ephemeral_openshift_secrets(self, run_task_mock):
        run_task_mock.delay.return_value = Mock(id="openshift-cleanup-task")
        payload = self.request_payload("unused")
        payload["template_id"] = self.cleanup_template.id
        payload["cluster_config"].pop("secret_reference")
        payload["cluster_config"].pop("machine_network_cidr")
        payload["cluster_config"].pop("rendezvous_ip")
        payload["cluster_config"]["target_modification_approved"] = False
        payload["cluster_config"]["install_confirmation"] = ""

        response = self.client.post("/api/installations/launch/", payload, format="json")

        self.assertEqual(response.status_code, 202)
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        self.assertEqual(installation.template, self.cleanup_template)
        run_task_mock.delay.assert_called_once_with(installation.id)

    def test_launch_rejects_network_address_as_node_and_rendezvous_ip(self):
        payload = self.request_payload(self.create_bundle().reference)
        payload["host_overrides"][0]["node_ip"] = "192.168.130.0"
        payload["cluster_config"]["rendezvous_ip"] = "192.168.130.0"

        response = self.client.post(
            "/api/installations/launch/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("usable host", response.json()["message"])
        self.assertEqual(Installation.objects.count(), 0)

    @patch("auto_K8S.views.run_installation_task")
    def test_launch_queues_registered_openshift_template_without_plaintext_secrets(self, run_task_mock):
        bundle = self.create_bundle()
        run_task_mock.delay.return_value = Mock(id="openshift-task-1")

        response = self.client.post(
            "/api/installations/launch/",
            self.request_payload(bundle.reference),
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        installation = Installation.objects.get(pk=response.json()["installation_id"])
        serialized = json.dumps(installation.cluster_config)
        self.assertNotIn("cloud.redhat.com", serialized)
        self.assertNotIn("AAAAC3", serialized)
        self.assertEqual(installation.template, self.template)
        self.assertEqual(installation.host_overrides[0]["installation_disk"], "/dev/vda")
        run_task_mock.delay.assert_called_once_with(installation.id)

    def test_normalization_preserves_libvirt_contract(self):
        normalized = normalize_host_overrides(
            [self.host],
            self.request_payload(self.create_bundle().reference)["host_overrides"],
            InstallationTemplate.SystemType.OPENSHIFT_SNO,
        )[0]
        self.assertEqual(normalized["vm_name"], "sno-test")
        self.assertEqual(normalized["installation_disk"], "/dev/vda")
        self.assertEqual(normalized["network_mode"], "dhcp_reservation")

    @patch("auto_K8S.views.run_installation_task")
    def test_failed_openshift_installation_can_restart_with_same_configuration(self, run_task_mock):
        run_task_mock.delay.side_effect = [Mock(id="original-task"), Mock(id="retry-task")]
        original_response = self.client.post(
            "/api/installations/launch/",
            self.request_payload(self.create_bundle().reference),
            format="json",
        )
        self.assertEqual(original_response.status_code, 202)
        original = Installation.objects.get(pk=original_response.json()["installation_id"])
        original.status = Installation.Status.FAILED
        original.phase = Installation.Phase.FAILED
        original.save(update_fields=["status", "phase", "updated_at"])

        retry_bundle = self.create_bundle()
        retry_response = self.client.post(
            f"/api/installations/{original.id}/retry-openshift/",
            {"secret_reference": str(retry_bundle.reference)},
            format="json",
        )

        self.assertEqual(retry_response.status_code, 202)
        restarted = Installation.objects.get(pk=retry_response.json()["installation_id"])
        self.assertNotEqual(restarted.id, original.id)
        self.assertEqual(restarted.status, Installation.Status.PENDING)
        self.assertEqual(restarted.template, original.template)
        self.assertEqual(restarted.host_overrides, original.host_overrides)
        self.assertEqual(
            restarted.cluster_config["secret_reference"],
            str(retry_bundle.reference),
        )
        self.assertEqual(original.status, Installation.Status.FAILED)
        run_task_mock.delay.assert_called_with(restarted.id)

    @patch("auto_K8S.views.run_installation_task")
    def test_running_openshift_installation_cannot_be_restarted(self, run_task_mock):
        run_task_mock.delay.return_value = Mock(id="original-task")
        original_response = self.client.post(
            "/api/installations/launch/",
            self.request_payload(self.create_bundle().reference),
            format="json",
        )
        original = Installation.objects.get(pk=original_response.json()["installation_id"])

        retry_response = self.client.post(
            f"/api/installations/{original.id}/retry-openshift/",
            {"secret_reference": str(self.create_bundle().reference)},
            format="json",
        )

        self.assertEqual(retry_response.status_code, 409)
        self.assertEqual(Installation.objects.count(), 1)
