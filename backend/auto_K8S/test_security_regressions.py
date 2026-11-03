import base64
import hashlib
import io
import os
import signal
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch

import yaml
from cryptography.fernet import Fernet
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command, CommandError
from django.db import connection, connections
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, TransactionTestCase, SimpleTestCase, override_settings
from rest_framework.test import APIClient

from .execution_lock import execution_transaction, ensure_hosts_available, HostsBusy
from .inventory_safety import InventoryLoader
from .log_safety import OutputRedactor
from .models import Credential, Host, Installation, InstallationTarget, InstallationTemplate, ExecutionMutex
from .permissions import OPERATOR_GROUP
from .runners.base import BaseRunner
from .runners.control import cancellation_scope
from .services import build_inventory_file, redact_inventory_secrets, sanitize_log_line, request_installation_cancellation, execute_installation
from .vault import CredentialEncryptionError, encrypt_secret

TEST_KEY = base64.urlsafe_b64encode(bytes(range(32))).decode()


@override_settings(LINDEPLOY_CREDENTIAL_KEY=TEST_KEY)
class CredentialSecurityTests(TestCase):
    def setUp(self):
        self.secret = ' leading "quote",comma\\slash\nsecond line {{ 7 * 7 }} trailing '
        self.credential = Credential.objects.create(name="fixture", auth_type="password", username="fixture", password=self.secret)
        self.host = Host.objects.create(name="fixture", ip_address="192.0.2.1", credential=self.credential)

    def raw_password(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT password FROM auto_K8S_credential WHERE id=%s", [self.credential.pk])
            return cursor.fetchone()[0]

    def test_model_storage_encrypted_and_actual_inventory_decrypted(self):
        self.assertTrue(self.raw_password().startswith("enc:v2:"))
        self.assertNotIn("leading", self.raw_password())
        self.host.refresh_from_db()
        path = build_inventory_file([self.host])
        self.addCleanup(lambda: __import__('shutil').rmtree(path.parent))
        data = yaml.load(path.read_text(), Loader=InventoryLoader)
        self.assertEqual(data["all"]["children"]["selected_hosts"]["hosts"]["fixture"]["ansible_password"], self.secret)
        if os.name == "posix":
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_ansible_does_not_template_secret(self):
        try:
            from ansible.parsing.dataloader import DataLoader
            from ansible.template import Templar
        except ImportError:
            self.skipTest("ansible is not installed in current python environment")
        path = build_inventory_file([self.host])
        self.addCleanup(lambda: __import__('shutil').rmtree(path.parent))
        loader = DataLoader()
        data = loader.load(path.read_text())
        value = data["all"]["children"]["selected_hosts"]["hosts"]["fixture"]["ansible_password"]
        self.assertEqual(Templar(loader=loader).template(value), self.secret)

    def test_structured_redaction_covers_comma_multiline_and_jinja(self):
        path = build_inventory_file([self.host])
        self.addCleanup(lambda: __import__('shutil').rmtree(path.parent))
        redacted = redact_inventory_secrets(path.read_text())
        for fragment in ("leading", "second line", "trailing", "comma"):
            self.assertNotIn(fragment, redacted)
        self.assertIn("<redacted>", redacted)
        self.assertNotIn("suffix", sanitize_log_line("ansible_password: prefix,suffix"))

    def test_private_key_is_decrypted_into_restricted_file(self):
        key = "-----BEGIN PRIVATE KEY-----\nSYNTHETIC_KEY_BODY\n-----END PRIVATE KEY-----"
        self.credential.auth_type = "ssh_key"
        self.credential.private_key = key
        self.credential.save()
        self.host.refresh_from_db()
        path = build_inventory_file([self.host])
        self.addCleanup(lambda: __import__('shutil').rmtree(path.parent))
        key_file = next(path.parent.glob("*.pem"))
        self.assertEqual(key_file.read_text(), key)
        if os.name == "posix":
            self.assertEqual(key_file.stat().st_mode & 0o777, 0o600)

    def test_plaintext_legacy_and_v1_remain_readable(self):
        from django.conf import settings
        derived = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
        for stored in (self.secret, "enc:v1:" + Fernet(derived).encrypt(self.secret.encode()).decode()):
            with connection.cursor() as cursor:
                cursor.execute("UPDATE auto_K8S_credential SET password=%s WHERE id=%s", [stored, self.credential.pk])
            self.credential.refresh_from_db()
            self.assertEqual(self.credential.password, self.secret)
            call_command("encrypt_credentials", stdout=io.StringIO())
            self.assertTrue(self.raw_password().startswith("enc:v2:"))

    def test_wrong_key_fails_without_modifying_storage(self):
        original = self.raw_password()
        with override_settings(LINDEPLOY_CREDENTIAL_KEY=Fernet.generate_key().decode()):
            with self.assertRaises(CredentialEncryptionError):
                self.credential.refresh_from_db()
            with self.assertRaises(CommandError):
                call_command("encrypt_credentials", stdout=io.StringIO())
        self.assertEqual(self.raw_password(), original)

    def test_missing_key_rejects_new_writes(self):
        with override_settings(LINDEPLOY_CREDENTIAL_KEY=""):
            with self.assertRaises(CredentialEncryptionError):
                encrypt_secret("synthetic")

    def test_api_create_edit_never_returns_secrets_or_changes_omitted_values(self):
        user = get_user_model().objects.create_user(username="operator")
        user.groups.add(Group.objects.get_or_create(name=OPERATOR_GROUP)[0])
        client = APIClient()
        client.force_authenticate(user)
        created = client.post("/api/credentials/", {"name":"api-fixture", "auth_type":"password", "username":"fixture", "password":self.secret}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        for key in ("password", "private_key", "become_password"):
            self.assertNotIn(key, created.data)
        edited = client.patch(f"/api/credentials/{created.data['id']}/", {"name":"renamed", "password":""}, format="json")
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(Credential.objects.get(pk=created.data['id']).password, self.secret)

    def test_registered_account_can_operate_and_deactivated_cannot(self):
        client = APIClient()
        registered = client.post("/api/auth/register/", {"username":"new-user", "email":"new@example.invalid", "password":"Synthetic123!"}, format="json")
        self.assertEqual(registered.status_code, 201)
        self.assertTrue(registered.data["user"]["can_operate"])
        client.credentials(HTTP_AUTHORIZATION="Bearer " + registered.data["token"])
        self.assertEqual(client.get("/api/auth/me/").status_code, 200)
        self.assertEqual(client.get("/api/credentials/").status_code, 200)
        self.assertEqual(client.get("/api/hosts/").status_code, 200)

        # Deactivated users are blocked
        user = get_user_model().objects.get(username="new-user")
        user.is_active = False
        user.save()
        self.assertIn(client.get("/api/hosts/").status_code, (401, 403))


class CancellationTests(TestCase):
    def setUp(self):
        self.template = InstallationTemplate.objects.first()
        self.host = Host.objects.create(name="cancel-fixture", ip_address="192.0.2.2")
        self.installation = Installation.objects.create(template=self.template, status="running", phase="ssh_check")
        self.target = InstallationTarget.objects.create(installation=self.installation, host=self.host, status="running")

    @patch("auto_K8S.services.revoke_celery_task")
    def test_running_silent_or_missing_worker_keeps_reservation(self, revoke):
        request_installation_cancellation(self.installation)
        request_installation_cancellation(self.installation)
        self.installation.refresh_from_db()
        self.target.refresh_from_db()
        self.assertTrue(self.installation.cancel_requested)
        self.assertEqual(self.installation.status, "running")
        self.assertEqual(self.target.status, "running")
        revoke.assert_not_called()
        with self.assertRaises(HostsBusy), execution_transaction():
            ensure_hosts_available([self.host.pk])

    @patch("auto_K8S.services.run_playbook")
    def test_duplicate_running_delivery_cannot_start_another_process(self, run):
        result = execute_installation(self.installation.pk)
        self.assertEqual(result["status"], "running")
        run.assert_not_called()

    @patch("auto_K8S.services.run_playbook")
    def test_cancelled_pending_delivery_never_starts(self, run):
        self.installation.status = "pending"
        self.installation.save()
        request_installation_cancellation(self.installation)
        execute_installation(self.installation.pk)
        run.assert_not_called()
        self.installation.refresh_from_db()
        self.assertEqual(self.installation.status, "cancelled")


class ProcessCancellationTests(SimpleTestCase):
    @skipUnless(os.name == "posix", "Linux process-group integration test")
    def test_silent_process_and_child_are_stopped_before_return(self):
        with tempfile.TemporaryDirectory() as directory:
            heartbeat = Path(directory) / "heartbeat"
            child = "import signal,time,pathlib; signal.signal(signal.SIGTERM,signal.SIG_IGN); p=pathlib.Path(" + repr(str(heartbeat)) + ");\nwhile True: p.write_text(str(time.time())); time.sleep(.05)"
            parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c'," + repr(child) + "]); time.sleep(60)"
            requested = threading.Event()
            def started(process):
                deadline = time.monotonic() + 5
                while not heartbeat.exists() and time.monotonic() < deadline:
                    time.sleep(.05)
                requested.set()
            started_at = time.monotonic()
            with cancellation_scope(requested.is_set):
                result = BaseRunner.run_streaming_subprocess([sys.executable, "-c", parent], on_process_start=started)
            self.assertLess(time.monotonic() - started_at, 10)
            self.assertNotEqual(result.returncode, 0)
            last = heartbeat.read_text()
            time.sleep(.25)
            self.assertEqual(last, heartbeat.read_text())

    def test_stream_masks_multiline_key_and_known_password_fragments(self):
        redact = OutputRedactor(["first line\nsecond line"])
        lines = ["-----BEGIN PRIVATE KEY-----\n", "SECRET_BODY\n", "-----END PRIVATE KEY-----\n", "second line\n"]
        output = "".join(redact(line) for line in lines)
        self.assertNotIn("SECRET_BODY", output)
        self.assertNotIn("second line", output)


class ReservationConcurrencyTests(TransactionTestCase):
    def setUp(self):
        ExecutionMutex.objects.get_or_create(pk=1)
        self.template = InstallationTemplate.objects.create(name="race", playbook_path="playbooks/race.yml")
        self.host = Host.objects.create(name="race", ip_address="192.0.2.3")

    def test_two_connections_cannot_reserve_same_host(self):
        barrier = threading.Barrier(2)
        outcomes = []
        def reserve():
            try:
                barrier.wait(timeout=5)
                with execution_transaction():
                    ensure_hosts_available([self.host.pk])
                    installation = Installation.objects.create(template_id=self.template.pk)
                    InstallationTarget.objects.create(installation=installation, host_id=self.host.pk)
                outcomes.append("reserved")
            except HostsBusy:
                outcomes.append("conflict")
            except Exception as exc:
                outcomes.append(type(exc).__name__)
            finally:
                connections.close_all()
        threads = [threading.Thread(target=reserve) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
            self.assertFalse(thread.is_alive())
        self.assertCountEqual(outcomes, ["reserved", "conflict"])
        self.assertEqual(InstallationTarget.objects.filter(host=self.host).count(), 1)


@override_settings(LINDEPLOY_CREDENTIAL_KEY=TEST_KEY)
class CredentialMigrationTests(TransactionTestCase):
    def test_forward_migration_preserves_legacy_data_and_explicit_rollback(self):
        previous = [("auto_K8S", "0027_seed_k3s_multi_node_cleanup_template")]
        current = [("auto_K8S", "0028_credential_encryption_execution_mutex")]
        executor = MigrationExecutor(connection)
        try:
            executor.migrate(previous)
            old_model = executor.loader.project_state(previous).apps.get_model("auto_K8S", "Credential")
            row = old_model.objects.create(name="legacy-migration", auth_type="password", username="fixture", password="legacy-synthetic")
            MigrationExecutor(connection).migrate(current)
            with connection.cursor() as cursor:
                cursor.execute("SELECT password FROM auto_K8S_credential WHERE id=%s", [row.pk])
                self.assertEqual(cursor.fetchone()[0], "legacy-synthetic")
            call_command("encrypt_credentials", stdout=io.StringIO())
            self.assertEqual(Credential.objects.get(pk=row.pk).password, "legacy-synthetic")
            call_command("encrypt_credentials", decrypt=True, stdout=io.StringIO())
            MigrationExecutor(connection).migrate(previous)
            self.assertEqual(old_model.objects.get(pk=row.pk).password, "legacy-synthetic")
        finally:
            MigrationExecutor(connection).migrate(current)
