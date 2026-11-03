import os
import re
import json
import stat
import shutil
import tempfile
import threading
import time
import unicodedata
from collections import deque
from pathlib import Path

from celery.result import AsyncResult
from django.conf import settings
from django.utils import timezone

from backend.celery import app as celery_app
from .models import Host, Installation, InstallationTarget, InstallationTemplate, MirrorProfile
from .openshift_secrets import consume_secret_bundle, destroy_secret_bundle
from .openshift_telemetry import OpenShiftTelemetryPoller
from .runners import get_runner
from .runners.control import controlled_installation, ProcessStopUnconfirmed
from .execution_lock import execution_transaction
from .inventory_safety import LiteralSecret, dump_inventory, redact_inventory


class InstallationCancelled(Exception):
    pass


AUTO_FULL_PLAYBOOK_PATH = "playbooks/k8s_single_node.yml"
AUTO_PREPARED_PLAYBOOK_PATH = "playbooks/k8s_single_node.yml"
AUTO_K3S_SINGLE_NODE_PLAYBOOK_PATH = "playbooks/k3s_single_node.yml"
AUTO_K3S_MULTI_NODE_PLAYBOOK_PATH = "playbooks/k3s_multi_node.yml"
AUTO_K3S_MULTI_NODE_CLEANUP_PLAYBOOK_PATH = "playbooks/k3s_multi_node_cleanup.yml"

LIVE_OUTPUT_LINE_LIMIT = 5000

SECRET_PATTERNS = [
    # Red Hat Offline Tokens / JWTs
    (re.compile(r"eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}"), "<redacted-jwt-token>"),
    # Docker auth tokens / base64 auth
    (re.compile(r'("auth":\s*")[^"]+(")'), r'\1<redacted-auth>\2'),
    (re.compile(r'("password":\s*")[^"]+(")'), r'\1<redacted-password>\2'),
    # OpenShift pull secret auths
    (re.compile(r'("auths":\s*\{)[^\}]+(\})'), r'\1"<redacted-pull-secret>"\2'),
    # Do not guess where a secret ends: commas and whitespace may belong to it.
    (re.compile(r'ansible_(?:password|become_password|become_pass|ssh_pass)\s*[=:][^\r\n]*', re.IGNORECASE), 'ansible_password: "<redacted>"'),
    # Private keys
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), "<redacted-private-key>"),
    # Generic bearer tokens
    (re.compile(r"(Bearer\s+)[A-Za-z0-9_\-\.]{20,}", re.IGNORECASE), r"\1<redacted-token>"),
]


def sanitize_log_line(text):
    """Scrub sensitive credentials, tokens, passwords, and private keys from log lines."""
    if not text or not isinstance(text, str):
        return text or ""
    sanitized = text
    for pattern, replacement in SECRET_PATTERNS:
        sanitized = pattern.sub(replacement, sanitized)
    return sanitized


def redact_inventory_secrets(inventory_content):
    """Return a diagnostic-safe inventory without SSH or sudo secret values."""
    if not inventory_content:
        return ""
    return redact_inventory(inventory_content)


def get_live_output_path(installation_id):
    return Path(settings.BASE_DIR) / "runtime" / "live-output" / f"installation-{installation_id}.jsonl"


def reset_live_output(installation_id):
    path = get_live_output_path(installation_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")
    return path


def append_live_output_line(path, lock, *, channel, line, timestamp):
    safe_line = sanitize_log_line(line)
    payload = json.dumps(
        {
            "channel": channel,
            "line": safe_line,
            "timestamp": timestamp,
        },
        ensure_ascii=False,
    )
    with lock:
        with path.open("a", encoding="utf-8") as stream:
            stream.write(f"{payload}\n")


def read_live_output_lines(installation_id, limit=LIVE_OUTPUT_LINE_LIMIT):
    path = get_live_output_path(installation_id)
    if not path.is_file():
        return []

    output_lines = deque(maxlen=max(1, int(limit)))
    try:
        with path.open("r", encoding="utf-8") as stream:
            for raw_line in stream:
                try:
                    item = json.loads(raw_line)
                except (TypeError, ValueError):
                    continue
                if isinstance(item, dict) and isinstance(item.get("line"), str):
                    output_lines.append(item)
    except OSError:
        return []

    return list(output_lines)


def read_live_output_chunk(installation_id, offset=0, limit=LIVE_OUTPUT_LINE_LIMIT):
    """
    Read output lines starting from line index `offset` (0-indexed).
    Returns a dict: {"lines": [...], "next_offset": int, "total_lines": int}
    """
    path = get_live_output_path(installation_id)
    if not path.is_file():
        return {"lines": [], "next_offset": 0, "total_lines": 0}

    offset_val = max(0, int(offset or 0))
    limit_val = max(1, int(limit or LIVE_OUTPUT_LINE_LIMIT))

    lines = []
    current_index = 0
    try:
        with path.open("r", encoding="utf-8") as stream:
            for raw_line in stream:
                try:
                    item = json.loads(raw_line)
                except (TypeError, ValueError):
                    continue
                if isinstance(item, dict) and isinstance(item.get("line"), str):
                    if current_index >= offset_val and len(lines) < limit_val:
                        lines.append(item)
                    current_index += 1
    except OSError:
        return {"lines": [], "next_offset": offset_val, "total_lines": current_index}

    return {
        "lines": lines,
        "next_offset": offset_val + len(lines),
        "total_lines": current_index,
    }


def normalize_node_name(value, fallback="node"):
    """Return a Kubernetes-compatible DNS label without changing valid names."""
    candidate = unicodedata.normalize("NFKD", str(value or ""))
    candidate = candidate.encode("ascii", "ignore").decode("ascii").lower()
    candidate = re.sub(r"[^a-z0-9-]+", "-", candidate)
    candidate = re.sub(r"-+", "-", candidate).strip("-")
    candidate = candidate[:63].rstrip("-")

    if candidate:
        return candidate

    normalized_fallback = re.sub(r"[^a-z0-9-]+", "-", str(fallback).lower())
    return normalized_fallback.strip("-")[:63] or "node"


def normalize_cluster_name(value, fallback="cluster"):
    """Return a DNS-subdomain-compatible cluster identifier."""
    candidate = unicodedata.normalize("NFKD", str(value or ""))
    candidate = candidate.encode("ascii", "ignore").decode("ascii").lower()
    candidate = re.sub(r"[^a-z0-9.-]+", "-", candidate)
    candidate = re.sub(r"-+", "-", candidate)
    candidate = re.sub(r"\.+", ".", candidate).strip("-.")
    candidate = candidate[:253].rstrip("-.")

    if candidate:
        return candidate

    normalized_fallback = re.sub(r"[^a-z0-9.-]+", "-", str(fallback).lower())
    return normalized_fallback.strip("-.")[:253] or "cluster"


def revoke_celery_task(task_id):
    if not task_id:
        return

    try:
        celery_app.control.revoke(task_id, terminate=False)
    except Exception:
        try:
            AsyncResult(task_id, app=celery_app).revoke(terminate=False)
        except Exception:
            pass


def normalize_host_overrides(hosts, host_overrides=None, system_type=None, default_cluster_name=None):
    overrides_by_host_id = {}
    default_role = (
        "server"
        if system_type == InstallationTemplate.SystemType.K3S
        else "control_plane"
    )

    if isinstance(host_overrides, list):
        for item in host_overrides:
            if not isinstance(item, dict):
                continue
            host_id = item.get("host_id")
            if host_id is None:
                continue
            overrides_by_host_id[int(host_id)] = item

    normalized = []

    for host in hosts:
        raw = overrides_by_host_id.get(host.id, {})
        node_name = normalize_node_name(
            raw.get("node_name") or host.hostname or host.name,
            fallback=f"node-{host.id}",
        )
        system_prefix = (
            "k3s"
            if system_type == InstallationTemplate.SystemType.K3S
            else ("openshift" if system_type == InstallationTemplate.SystemType.OPENSHIFT_SNO else "kubernetes")
        )
        fallback_cluster = default_cluster_name or f"{system_prefix}-{node_name}"
        normalized_item = {
                "host_id": host.id,
                "host_name": host.name,
                "hostname": host.hostname,
                "ip_address": host.ip_address,
                "ssh_port": int(raw.get("ssh_port") or host.ssh_port),
                "ansible_user": (raw.get("ansible_user") or getattr(host.credential, "username", "")).strip(),
                "node_name": node_name,
                "cluster_name": normalize_cluster_name(
                    raw.get("cluster_name"),
                    fallback=fallback_cluster,
                ),
                "cluster_name_explicit": bool(str(raw.get("cluster_name") or default_cluster_name or "").strip()),
                "node_role": (raw.get("node_role") or default_role).strip(),
                "advertise_address": (raw.get("advertise_address") or host.ip_address).strip(),
                "labels": raw.get("labels") or [],
                "taints": raw.get("taints") or [],
                "execution_allowed": raw.get("execution_allowed", True),
                "validation_error": (raw.get("validation_error") or "").strip(),
                "baseline_state": raw.get("baseline_state") or "",
                "reachable": raw.get("reachable"),
            }
        if system_type == InstallationTemplate.SystemType.OPENSHIFT_SNO:
            for key in (
                "vm_name",
                "node_ip",
                "prefix_length",
                "gateway",
                "interface_name",
                "mac_address",
                "installation_disk",
                "libvirt_network",
                "storage_pool",
                "vcpu",
                "memory_gib",
                "disk_gib",
                "network_mode",
            ):
                normalized_item[key] = raw.get(key)
            if not normalized_item.get("mac_address"):
                try:
                    host_id_byte = int(host.id) % 256
                    last_ip_byte = int(str(normalized_item.get("node_ip", "10")).split(".")[-1]) % 256
                    normalized_item["mac_address"] = f"52:54:00:01:{host_id_byte:02x}:{last_ip_byte:02x}"
                except Exception:
                    normalized_item["mac_address"] = "52:54:00:01:00:10"
        normalized.append(normalized_item)

    return normalized


def _build_inventory_host_dict(
    host,
    host_override,
    runner,
    temp_dir,
    include_node_metadata=False,
):
    host_dict = {
        "ansible_host": host.ip_address,
        "lindeploy_target_id": str(host.stable_id),
        "ansible_port": int(host_override.get("ssh_port", host.ssh_port)),
    }

    if include_node_metadata and host_override.get("node_name"):
        host_dict["lindeploy_node_name"] = str(host_override["node_name"])
    if include_node_metadata and host_override.get("cluster_name"):
        host_dict["lindeploy_cluster_name"] = str(host_override["cluster_name"])
        host_dict["lindeploy_cluster_name_explicit"] = bool(
            host_override.get("cluster_name_explicit")
        )
    if include_node_metadata and host_override.get("advertise_address"):
        host_dict["lindeploy_advertise_address"] = str(host_override["advertise_address"])

    if not host.credential:
        return host_dict

    host_dict["ansible_user"] = LiteralSecret(host_override.get("ansible_user", host.credential.username))

    if host.credential.auth_type == "password" and host.credential.password:
        host_dict["ansible_password"] = LiteralSecret(host.credential.password)

    if host.credential.auth_type == "ssh_key" and host.credential.private_key:
        key_path = temp_dir / f"credential-{host.credential.id}-{host.stable_id}.pem"
        key_path.write_text(host.credential.private_key, encoding="utf-8")
        os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)
        host_dict["ansible_ssh_private_key_file"] = runner.to_runner_path(key_path)

    if host.credential.become_password:
        host_dict["ansible_become_password"] = LiteralSecret(host.credential.become_password)

    return host_dict


def build_inventory_file(
    hosts,
    host_overrides=None,
    topology=Installation.Topology.SINGLE_NODE,
    bootstrap_host_id=None,
):
    runner = get_runner()
    temp_dir = Path(tempfile.mkdtemp())
    try:
        overrides_by_host_id = {
            item["host_id"]: item for item in normalize_host_overrides(hosts, host_overrides)
        }

        if topology == Installation.Topology.MULTI_NODE:
            control_plane_hosts = [
                host
                for host in hosts
                if overrides_by_host_id.get(host.id, {}).get("node_role")
                in {"control_plane", "server"}
            ]
            worker_hosts = [
                host
                for host in hosts
                if overrides_by_host_id.get(host.id, {}).get("node_role") in {"worker", "agent"}
            ]
            bootstrap_host = next(
                (host for host in control_plane_hosts if host.id == bootstrap_host_id),
                None,
            )

            if not control_plane_hosts:
                raise ValueError("Multi-node inventory requires at least one control-plane host.")
            if not worker_hosts:
                raise ValueError("Multi-node inventory requires at least one worker host.")
            if bootstrap_host is None:
                raise ValueError(
                    "Multi-node inventory requires a reachable bootstrap host in the control-plane group."
                )

            control_plane_dict = {}
            for host in control_plane_hosts:
                h_data = _build_inventory_host_dict(
                    host,
                    overrides_by_host_id[host.id],
                    runner,
                    temp_dir,
                    include_node_metadata=True,
                )
                h_data["lindeploy_is_bootstrap"] = (host.id == bootstrap_host_id)
                h_data["lindeploy_desired_role"] = "control_plane"
                control_plane_dict[host.name] = h_data

            workers_dict = {}
            for host in worker_hosts:
                h_data = _build_inventory_host_dict(
                    host,
                    overrides_by_host_id[host.id],
                    runner,
                    temp_dir,
                    include_node_metadata=True,
                )
                h_data["lindeploy_is_bootstrap"] = False
                h_data["lindeploy_desired_role"] = "worker"
                workers_dict[host.name] = h_data

            inventory_data = {
                "all": {
                    "children": {
                        "selected_hosts": {
                            "children": {
                                "control_plane": {
                                    "hosts": control_plane_dict,
                                },
                                "workers": {
                                    "hosts": workers_dict,
                                },
                                "bootstrap": {
                                    "hosts": {
                                        bootstrap_host.name: {},
                                    },
                                },
                            },
                        },
                    },
                },
            }
            inventory_path = temp_dir / "inventory.yml"
            inventory_path.write_text(
                dump_inventory(inventory_data),
                encoding="utf-8",
            )
            os.chmod(inventory_path, stat.S_IRUSR | stat.S_IWUSR)
            return inventory_path

        hosts_dict = {}
        for host in hosts:
            host_override = overrides_by_host_id.get(host.id, {})
            hosts_dict[host.name] = _build_inventory_host_dict(
                host,
                host_override,
                runner,
                temp_dir,
                include_node_metadata=True,
            )

        inventory_data = {
            "all": {
                "children": {
                    "selected_hosts": {
                        "hosts": hosts_dict,
                    },
                },
            },
        }
        inventory_path = temp_dir / "inventory.yml"
        inventory_path.write_text(
            dump_inventory(inventory_data),
            encoding="utf-8",
        )
        os.chmod(inventory_path, stat.S_IRUSR | stat.S_IWUSR)
        return inventory_path
    except BaseException:
        shutil.rmtree(temp_dir)
        raise


def build_extra_vars_file(
    cluster_config=None,
    host_overrides=None,
    system_type=None,
    topology=Installation.Topology.SINGLE_NODE,
    bootstrap_host_id=None,
    ephemeral_secrets=None,
):
    temp_dir = Path(tempfile.mkdtemp())
    payload = {
        "installer_type": system_type,
        "cluster_config": cluster_config or {},
        "host_overrides": host_overrides or [],
        "selected_hosts_config": host_overrides or [],
        "deployment_topology": topology,
    }
    if system_type == InstallationTemplate.SystemType.OPENSHIFT_SNO:
        payload.update(ephemeral_secrets or {})
        if not payload.get("mirror_username"):
            payload["mirror_username"] = getattr(settings, "OPENSHIFT_MIRROR_USERNAME", "init")
        if not payload.get("mirror_password"):
            payload["mirror_password"] = getattr(settings, "OPENSHIFT_MIRROR_PASSWORD", "")
        payload["redhat_offline_token"] = settings.OPENSHIFT_RED_HAT_OFFLINE_TOKEN
        payload["openshift_default_version"] = settings.OPENSHIFT_DEFAULT_VERSION

    if settings.LINDEPLOY_MIRROR_ENABLED:
        registry_mirrors = settings.LINDEPLOY_REGISTRY_MIRRORS
        if not registry_mirrors:
            raise ValueError(
                "LINDEPLOY_MIRROR_ENABLED requires at least one registry "
                "endpoint in LINDEPLOY_REGISTRY_MIRRORS_JSON."
            )

        invalid_endpoints = [
            endpoint
            for endpoint in registry_mirrors.values()
            if not str(endpoint).startswith(("https://", "http://"))
        ]
        if invalid_endpoints:
            raise ValueError(
                "Every registry mirror endpoint must start with https:// or http://."
            )
        insecure_endpoints = [
            endpoint
            for endpoint in registry_mirrors.values()
            if str(endpoint).startswith("http://")
        ]
        if insecure_endpoints and not settings.LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP:
            raise ValueError(
                "HTTP registry mirrors are disabled. Configure HTTPS or explicitly "
                "set LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP=True for an isolated lab."
            )

        mirror_payload = {
            "lindeploy_mirror_enabled": True,
            "lindeploy_mirror_allow_insecure_http": (
                settings.LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP
            ),
            "lindeploy_registry_mirrors": registry_mirrors,
            "lindeploy_system_package_cache_enabled": (
                settings.LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED
            ),
            "lindeploy_mirror_cache_required": settings.LINDEPLOY_MIRROR_CACHE_REQUIRED,
        }

        requested_profile_id = {
            InstallationTemplate.SystemType.KUBERNETES: settings.LINDEPLOY_KUBERNETES_PROFILE_ID,
            InstallationTemplate.SystemType.K3S: settings.LINDEPLOY_K3S_PROFILE_ID,
        }.get(system_type, "")
        if requested_profile_id:
            mirror_payload["lindeploy_mirror_profile_id"] = requested_profile_id
            profile = MirrorProfile.objects.filter(
                profile_id=requested_profile_id,
                verification_state=MirrorProfile.VerificationState.READY,
            ).first()
            if settings.LINDEPLOY_MIRROR_CACHE_REQUIRED and profile is None:
                raise ValueError(
                    f"Required immutable mirror profile {requested_profile_id} is not ready. "
                    "Run and verify mirror prewarm before starting this installation."
                )
            if profile:
                if system_type == InstallationTemplate.SystemType.KUBERNETES:
                    mirror_payload["kubeadm_kubernetes_version"] = profile.exact_version
                elif system_type == InstallationTemplate.SystemType.K3S:
                    mirror_payload["k3s_version"] = profile.exact_version
        if settings.LINDEPLOY_PACKAGE_MIRROR_BASE_URL:
            package_mirror_url = settings.LINDEPLOY_PACKAGE_MIRROR_BASE_URL
            if not package_mirror_url.startswith("https://"):
                raise ValueError(
                    "LINDEPLOY_PACKAGE_MIRROR_BASE_URL requires an HTTPS "
                    "LINDEPLOY_PACKAGE_MIRROR_BASE_URL."
                )

            mirror_payload["lindeploy_package_mirror_base_url"] = package_mirror_url

        ca_file = settings.LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE
        if ca_file:
            ca_path = Path(ca_file).expanduser()
            if not ca_path.is_file():
                raise ValueError(
                    "LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE does not reference "
                    "a readable certificate file."
                )
            mirror_payload["lindeploy_mirror_ca_certificate"] = ca_path.read_text(
                encoding="utf-8"
            )

        optional_urls = {
            "k3s_install_script_url": settings.LINDEPLOY_K3S_INSTALL_SCRIPT_URL,
            "k3s_install_channel_url": settings.LINDEPLOY_K3S_CHANNEL_URL,
            "k3s_install_artifact_url": settings.LINDEPLOY_K3S_ARTIFACT_URL,
            "calico_manifest_url": settings.LINDEPLOY_CALICO_MANIFEST_URL,
            "containerd_repo_baseurl": settings.LINDEPLOY_CONTAINERD_RPM_BASEURL,
            "containerd_repo_gpgkey": settings.LINDEPLOY_CONTAINERD_RPM_GPGKEY,
            "containerd_apt_repo_url": settings.LINDEPLOY_CONTAINERD_APT_REPO_URL,
            "containerd_apt_key_url": settings.LINDEPLOY_CONTAINERD_APT_KEY_URL,
            "kubernetes_repo_baseurl": settings.LINDEPLOY_KUBERNETES_RPM_BASEURL,
            "kubernetes_repo_gpgkey": settings.LINDEPLOY_KUBERNETES_RPM_GPGKEY,
            "kubernetes_apt_repo_url": settings.LINDEPLOY_KUBERNETES_APT_REPO_URL,
            "kubernetes_apt_repo_key_url": settings.LINDEPLOY_KUBERNETES_APT_KEY_URL,
        }
        mirror_payload.update(
            {key: value for key, value in optional_urls.items() if value}
        )
        payload.update(mirror_payload)

    bootstrap_host = None

    if topology == Installation.Topology.MULTI_NODE:
        control_plane_hosts = [
            item
            for item in host_overrides or []
            if item.get("node_role") in {"control_plane", "server"}
        ]
        worker_hosts = [
            item
            for item in host_overrides or []
            if item.get("node_role") in {"worker", "agent"}
        ]
        bootstrap_host = next(
            (
                item
                for item in control_plane_hosts
                if str(item.get("host_id")) == str(bootstrap_host_id)
            ),
            None,
        )
        payload.update(
            {
                "control_plane_hosts": control_plane_hosts,
                "worker_hosts": worker_hosts,
                "bootstrap_host_id": bootstrap_host_id,
                "bootstrap_host_name": bootstrap_host.get("host_name") if bootstrap_host else None,
                "bootstrap_node_name": bootstrap_host.get("node_name") if bootstrap_host else None,
                "bootstrap_advertise_address": (
                    bootstrap_host.get("advertise_address") if bootstrap_host else None
                ),
            }
        )

    primary_host = bootstrap_host
    if primary_host is None:
        for host_override in host_overrides or []:
            if host_override.get("node_role") in {"control_plane", "server"}:
                primary_host = host_override
                break

    if primary_host:
        payload["primary_host_name"] = primary_host.get("host_name")
        payload["primary_node_name"] = primary_host.get("node_name")
        payload["primary_advertise_address"] = primary_host.get("advertise_address")

    for key in (
        "cluster_name",
        "cluster_name_explicit",
        "version",
        "cluster_domain",
        "pod_cidr",
        "service_cidr",
        "control_plane_endpoint",
        "cni_plugin",
        "disable_ingress",
        "control_plane_count",
        "worker_count",
        "target_modification_approved",
        "cleanup_confirmation",
        "cleanup_expected_confirmation",
    ):
        if cluster_config and key in cluster_config:
            payload[key] = cluster_config[key]

    extra_vars_path = temp_dir / "extra-vars.json"
    extra_vars_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.chmod(extra_vars_path, stat.S_IRUSR | stat.S_IWUSR)
    return extra_vars_path


def parse_task_profile(stdout_text):
    tasks = []
    in_tasks_recap = False

    for raw_line in stdout_text.splitlines():
        line = raw_line.rstrip()

        if "TASKS RECAP" in line:
            in_tasks_recap = True
            continue

        if "PLAYBOOK RECAP" in line:
            break

        if not in_tasks_recap:
            continue

        match = re.match(r"^(?P<name>.+?)-+\s+(?P<seconds>\d+\.\d+)s$", line.strip())
        if not match:
            continue

        tasks.append(
            {
                "name": match.group("name").strip(),
                "seconds": float(match.group("seconds")),
            }
        )

    return tasks


def parse_live_ansible_line(line):
    stripped = line.strip()
    if not stripped:
        return None

    play_match = re.match(r"^PLAY \[(?P<play>.+)\]", stripped)
    if play_match:
        return {
            "kind": "play_started",
            "play": play_match.group("play").strip(),
        }

    task_match = re.match(r"^TASK \[(?:(?P<role>[^\]]+?)\s+:\s+)?(?P<task>[^\]]+)\]", stripped)
    if task_match:
        role = task_match.group("role") or ""
        return {
            "kind": "task_started",
            "role": role.strip(),
            "task": task_match.group("task").strip(),
        }

    host_result_patterns = [
        re.match(r"^(?P<status>ok|changed|skipping): \[(?P<host>[^\]]+)\]", stripped),
        re.match(r"^fatal: \[(?P<host>[^\]]+)\]: (?P<status>FAILED|UNREACHABLE)!? =>", stripped),
    ]

    for match in host_result_patterns:
        if not match:
            continue

        return {
            "kind": "task_result",
            "host": match.group("host").strip(),
            "status": match.group("status").strip().lower(),
            "line": stripped,
        }

    return None


def parse_listed_task_count(stdout_text):
    """Count the executable task entries emitted by ansible-playbook --list-tasks."""
    return sum(
        1
        for line in stdout_text.splitlines()
        if re.match(r"^\s{6,}\S.*\s+TAGS:\s*\[.*\]\s*$", line)
    )


def parse_listed_task_work_count(stdout_text, free_strategy_group_sizes=None):
    """Estimate emitted task headers for plays that run independently per host."""
    group_sizes = free_strategy_group_sizes or {}
    current_pattern = ""
    task_count = 0

    for line in stdout_text.splitlines():
        play_match = re.match(r"^\s+play #\d+ \((?P<pattern>[^)]+)\):", line)
        if play_match:
            current_pattern = play_match.group("pattern").strip()
            continue

        if not re.match(r"^\s{6,}\S.*\s+TAGS:\s*\[.*\]\s*$", line):
            continue

        multiplier = (
            max(0, int(group_sizes[current_pattern]))
            if current_pattern in group_sizes
            else 1
        )
        task_count += multiplier

    return task_count


def parse_play_recap(stdout_text):
    recap_by_host = {}
    in_play_recap = False

    for raw_line in stdout_text.splitlines():
        stripped = raw_line.strip()

        if "PLAY RECAP" in stripped:
            in_play_recap = True
            continue

        if not in_play_recap or not stripped:
            continue

        match = re.match(
            (
                r"^(?P<host>\S+)\s+:\s+ok=(?P<ok>\d+)\s+changed=(?P<changed>\d+)\s+"
                r"unreachable=(?P<unreachable>\d+)\s+failed=(?P<failed>\d+)\s+"
                r"skipped=(?P<skipped>\d+)(?:\s+rescued=(?P<rescued>\d+))?"
                r"(?:\s+ignored=(?P<ignored>\d+))?"
            ),
            stripped,
        )
        if not match:
            continue

        recap_by_host[match.group("host")] = {
            "host": match.group("host"),
            "ok": int(match.group("ok")),
            "changed": int(match.group("changed")),
            "unreachable": int(match.group("unreachable")),
            "failed": int(match.group("failed")),
            "skipped": int(match.group("skipped")),
            "rescued": int(match.group("rescued") or 0),
            "ignored": int(match.group("ignored") or 0),
            "line": stripped,
        }

    return recap_by_host


def apply_playbook_results(targets, stdout_text, stderr_text, return_code):
    recap_by_host = parse_play_recap(stdout_text)
    success_count = 0
    failed_count = 0

    for target in targets:
        recap = (
            recap_by_host.get(target.host.name)
            or recap_by_host.get(target.host.hostname)
            or recap_by_host.get(target.host.ip_address)
            or next(
                (v for k, v in recap_by_host.items() if k.lower() == target.host.name.lower()),
                None,
            )
        )

        if recap is not None:
            host_failed = recap["failed"] > 0 or recap["unreachable"] > 0
            if (
                target.installation.topology == Installation.Topology.MULTI_NODE
                and return_code != 0
                and not host_failed
            ):
                target_status = InstallationTarget.Status.FAILED
                output = f"Multi-node execution aborted because another host encountered a blocking failure. ({recap['line']})"
            else:
                target_status = (
                    InstallationTarget.Status.FAILED
                    if host_failed
                    else InstallationTarget.Status.SUCCESS
                )
                output = recap["line"]
        else:
            target_status = InstallationTarget.Status.FAILED
            diagnostic = ""
            if return_code != 0:
                combined_lines = [
                    line.strip()
                    for line in f"{stderr_text or ''}\n{stdout_text or ''}".splitlines()
                    if line.strip()
                ]
                for line in combined_lines:
                    if any(
                        marker in line.lower()
                        for marker in ("[error]", "error!", "syntax error", "fatal:")
                    ):
                        diagnostic = line
                        break
            output = (
                "Ansible returned without a PLAY RECAP. The execution result "
                "cannot be verified and is treated as failed."
                if return_code == 0
                else (
                    f"Host status could not be resolved from Ansible PLAY RECAP ({diagnostic})."
                    if diagnostic
                    else "Host status could not be resolved from Ansible PLAY RECAP."
                )
            )

        if target_status == InstallationTarget.Status.SUCCESS:
            success_count += 1
        else:
            failed_count += 1

        target_updates = {
            "status": target_status,
            "stdout": stdout_text,
            "stderr": stderr_text,
            "return_code": return_code,
            "output": output,
        }
        if (
            target.installation.topology == Installation.Topology.MULTI_NODE
            and not target.is_bootstrap
        ):
            target_updates["join_status"] = (
                InstallationTarget.JoinStatus.JOINED
                if target_status == InstallationTarget.Status.SUCCESS
                else InstallationTarget.JoinStatus.FAILED
            )

        update_target(
            target,
            **target_updates,
        )

    return {
        "success_count": success_count,
        "failed_count": failed_count,
        "recap_by_host": recap_by_host,
    }


def build_bottleneck_hints(task_profile):
    hints = []
    top_tasks = task_profile[:5]

    for task in top_tasks:
        task_name = task["name"].lower()
        seconds = task["seconds"]

        if "install kubernetes packages" in task_name or "install containerd package" in task_name:
            hints.append(
                f"Package installation took {seconds:.2f}s. This usually means repository download speed or machine internet access is slow."
            )
        elif "pull kubernetes images" in task_name:
            hints.append(
                f"Kubernetes image pull took {seconds:.2f}s. A local mirror or pre-pulled base image would reduce this significantly."
            )
        elif "pre-pull calico images" in task_name:
            hints.append(
                f"Calico image pre-pull took {seconds:.2f}s. A local registry or prepared node baseline would reduce this delay."
            )
        elif "run kubeadm init" in task_name:
            hints.append(
                f"kubeadm init took {seconds:.2f}s. API server startup, etcd bootstrap, or CPU/RAM pressure may be the bottleneck."
            )
        elif "wait for calico-node rollout" in task_name or "wait for coredns rollout" in task_name:
            hints.append(
                f"CNI rollout wait took {seconds:.2f}s. This usually points to Calico startup, networking, or image pull delays."
            )
        elif "wait for node to become ready" in task_name:
            hints.append(
                f"Node readiness wait took {seconds:.2f}s. kubelet, CNI initialization, or control-plane health is likely delaying completion."
            )
        elif "gathering facts" in task_name:
            hints.append(
                f"Fact gathering took {seconds:.2f}s. SSH connection setup, DNS resolution, or remote Python startup may be slow."
            )

    return hints


def get_ansible_repo_root():
    configured_repo_root = getattr(settings, "ANSIBLE_REPO_ROOT", "").strip()
    candidates = []

    if configured_repo_root:
        candidates.append(Path(configured_repo_root))

    candidates.extend(
        [
            Path(settings.BASE_DIR) / "backend" / "Playbooks",
            Path(settings.BASE_DIR) / "ansible",
        ]
    )

    for candidate in candidates:
        if (candidate / "ansible.cfg").exists() and (candidate / "playbooks").exists():
            return candidate

    raise FileNotFoundError(
        "Unable to locate the Ansible repo root. Expected a folder containing "
        "'ansible.cfg' and 'playbooks'. Set ANSIBLE_REPO_ROOT in your environment "
        "to avoid controller-specific path guesses."
    )


def build_baseline_detection_script():
    return (
        "containerd_installed=false; command -v containerd >/dev/null 2>&1 && containerd_installed=true; "
        "containerd_active=false; systemctl is-active --quiet containerd >/dev/null 2>&1 && containerd_active=true; "
        "kubelet_installed=false; command -v kubelet >/dev/null 2>&1 && kubelet_installed=true; "
        "kubeadm_installed=false; command -v kubeadm >/dev/null 2>&1 && kubeadm_installed=true; "
        "kubectl_installed=false; command -v kubectl >/dev/null 2>&1 && kubectl_installed=true; "
        "swap_disabled=true; [ -n \"$(swapon --noheadings 2>/dev/null)\" ] && swap_disabled=false; "
        "modules_configured=false; [ -f /etc/modules-load.d/k8s.conf ] && modules_configured=true; "
        "sysctl_configured=false; [ -f /etc/sysctl.d/k8s.conf ] && sysctl_configured=true; "
        "admin_conf_exists=false; [ -f /etc/kubernetes/admin.conf ] && admin_conf_exists=true; "
        "k3s_installed=false; ([ -f /usr/local/bin/k3s ] || [ -f /etc/systemd/system/k3s.service ] || [ -f /etc/rancher/k3s/k3s.yaml ]) && k3s_installed=true; "
        "k8s_installed=false; ([ -f /etc/kubernetes/admin.conf ] || [ -f /etc/kubernetes/manifests/kube-apiserver.yaml ] || [ -d /var/lib/etcd/member ]) && k8s_installed=true; "
        "printf 'BASELINE_FACTS containerd_installed=%s containerd_active=%s kubelet_installed=%s "
        "kubeadm_installed=%s kubectl_installed=%s swap_disabled=%s modules_configured=%s "
        "sysctl_configured=%s admin_conf_exists=%s k3s_installed=%s k8s_installed=%s\n' "
        "\"$containerd_installed\" \"$containerd_active\" \"$kubelet_installed\" \"$kubeadm_installed\" "
        "\"$kubectl_installed\" \"$swap_disabled\" \"$modules_configured\" \"$sysctl_configured\" \"$admin_conf_exists\" "
        "\"$k3s_installed\" \"$k8s_installed\""
    )


def classify_baseline_facts(facts):
    if facts.get("admin_conf_exists") or facts.get("k8s_installed") or facts.get("k3s_installed"):
        return Host.BaselineState.INITIALIZED

    prepared_requirements = (
        facts.get("containerd_installed"),
        facts.get("containerd_active"),
        facts.get("kubelet_installed"),
        facts.get("kubeadm_installed"),
        facts.get("kubectl_installed"),
        facts.get("swap_disabled"),
        facts.get("modules_configured"),
        facts.get("sysctl_configured"),
    )
    if all(prepared_requirements):
        return Host.BaselineState.PREPARED

    return Host.BaselineState.FRESH


def parse_bool_token(value):
    return str(value).strip().lower() == "true"


def parse_baseline_detection_output(stdout_text, stderr_text, expected_hosts=None):
    detections = {}

    for raw_line in stdout_text.splitlines():
        line = raw_line.strip()
        if "BASELINE_FACTS" not in line or " | " not in line:
            continue

        host_name = line.split(" | ", 1)[0].strip()
        facts_section = line.split("BASELINE_FACTS", 1)[1].strip()
        facts = {}
        for token in facts_section.split():
            if "=" not in token:
                continue
            key, value = token.split("=", 1)
            facts[key] = parse_bool_token(value)

        state = classify_baseline_facts(facts)
        detections[host_name] = {
            "host": host_name,
            "reachable": True,
            "baseline_state": state,
            "facts": facts,
            "detail": line,
        }

    unreachable_patterns = [
        re.compile(r"^(?P<host>\S+)\s+\|\s+(?P<status>FAILED|UNREACHABLE)!?\s+=>\s*(?P<detail>.*)$"),
        re.compile(r"^fatal:\s+\[(?P<host>[^\]]+)\]:\s+(?P<status>FAILED|UNREACHABLE)!?\s+=>\s*(?P<detail>.*)$"),
    ]

    for source in (stdout_text, stderr_text):
        for raw_line in source.splitlines():
            line = raw_line.strip()
            for pattern in unreachable_patterns:
                match = pattern.match(line)
                if not match:
                    continue

                detections[match.group("host")] = {
                    "host": match.group("host"),
                    "reachable": False,
                    "baseline_state": Host.BaselineState.UNKNOWN,
                    "facts": {},
                    "detail": line,
                }
                break

    if expected_hosts:
        fallback_detail = (
            stderr_text.strip()
            or stdout_text.strip()
            or "No baseline detection output was returned."
        )
        fallback_detail = fallback_detail.splitlines()[0]

        for host_name in expected_hosts:
            if host_name in detections:
                continue
            detections[host_name] = {
                "host": host_name,
                "reachable": False,
                "baseline_state": Host.BaselineState.UNKNOWN,
                "facts": {},
                "detail": fallback_detail,
            }

    return list(detections.values())


def parse_connectivity_output(stdout_text, stderr_text, expected_hosts=None):
    statuses = {}
    patterns = [
        re.compile(r"^(?P<host>\S+)\s+\|\s+(?P<status>SUCCESS|FAILED|UNREACHABLE)!?\s+=>"),
        re.compile(r"^fatal:\s+\[(?P<host>[^\]]+)\]:\s+(?P<status>FAILED|UNREACHABLE)!?\s+=>"),
    ]

    def register_status(line):
        for pattern in patterns:
            match = pattern.match(line)
            if not match:
                continue

            statuses[match.group("host")] = {
                "host": match.group("host"),
                "status": match.group("status").lower(),
                "detail": line,
            }
            return True

        return False

    for raw_line in stdout_text.splitlines():
        register_status(raw_line.strip())

    for raw_line in stderr_text.splitlines():
        register_status(raw_line.strip())

    if expected_hosts:
        fallback_detail = (
            stderr_text.strip()
            or stdout_text.strip()
            or "No host-level status was returned by Ansible."
        )
        fallback_detail = fallback_detail.splitlines()[0]

        for host_name in expected_hosts:
            if host_name not in statuses:
                statuses[host_name] = {
                    "host": host_name,
                    "status": "failed",
                    "detail": fallback_detail,
                }

    return list(statuses.values())


def run_connectivity_check(repo_root, inventory_path, expected_hosts=None):
    runner = get_runner()
    result, metadata = runner.run_connectivity_check(
        repo_root=repo_root,
        inventory_path=inventory_path,
    )
    metadata["connectivity"] = parse_connectivity_output(
        result.stdout,
        result.stderr,
        expected_hosts=expected_hosts,
    )

    return result, metadata


def run_baseline_detection(repo_root, inventory_path, expected_hosts=None):
    runner = get_runner()
    result, metadata = runner.run_ad_hoc_command(
        repo_root=repo_root,
        inventory_path=inventory_path,
        module_name="shell",
        module_args=build_baseline_detection_script(),
    )
    metadata["detections"] = parse_baseline_detection_output(
        result.stdout,
        result.stderr,
        expected_hosts=expected_hosts,
    )

    return result, metadata


def run_playbook(
    repo_root,
    playbook_relative_path,
    inventory_path,
    extra_vars_path=None,
    on_stdout_line=None,
    on_stderr_line=None,
    on_process_start=None,
):
    runner = get_runner()
    result, metadata = runner.run_playbook(
        repo_root=repo_root,
        playbook_relative_path=playbook_relative_path,
        inventory_path=inventory_path,
        extra_vars_path=extra_vars_path,
        on_stdout_line=on_stdout_line,
        on_stderr_line=on_stderr_line,
        on_process_start=on_process_start,
    )
    task_profile = parse_task_profile(result.stdout)
    task_profile.sort(key=lambda item: item["seconds"], reverse=True)

    metadata.update(
        {
            "task_profile": task_profile,
            "slow_tasks": task_profile[:5],
            "bottleneck_hints": build_bottleneck_hints(task_profile),
        }
    )

    return result, metadata


def inspect_playbook_task_count(
    repo_root,
    playbook_relative_path,
    inventory_path,
    extra_vars_path=None,
    free_strategy_group_sizes=None,
):
    runner = get_runner()
    result, metadata = runner.list_playbook_tasks(
        repo_root=repo_root,
        playbook_relative_path=playbook_relative_path,
        inventory_path=inventory_path,
        extra_vars_path=extra_vars_path,
    )
    metadata["raw_task_count"] = (
        parse_listed_task_count(result.stdout) if result.returncode == 0 else 0
    )
    metadata["task_count"] = (
        parse_listed_task_work_count(
            result.stdout,
            free_strategy_group_sizes=free_strategy_group_sizes,
        )
        if result.returncode == 0
        else 0
    )
    return result, metadata


def update_host_baseline(host, detection):
    host.baseline_state = detection["baseline_state"]
    host.baseline_facts = detection["facts"]
    host.last_detection_at = timezone.now()
    host.save(update_fields=["baseline_state", "baseline_facts", "last_detection_at", "updated_at"])


def detect_hosts_baseline(hosts):
    if not hosts:
        return []

    inventory_path = build_inventory_file(hosts)
    ansible_repo_root = get_ansible_repo_root()
    result, metadata = run_baseline_detection(
        repo_root=ansible_repo_root,
        inventory_path=inventory_path,
        expected_hosts=[host.name for host in hosts],
    )

    detections_by_host = {item["host"]: item for item in metadata["detections"]}
    ordered_detections = []
    for host in hosts:
        detection = detections_by_host.get(
            host.name,
            {
                "host": host.name,
                "reachable": False,
                "baseline_state": Host.BaselineState.UNKNOWN,
                "facts": {},
                "detail": "No baseline detection output was returned.",
            },
        )
        update_host_baseline(host, detection)
        ordered_detections.append(
            {
                "id": host.id,
                "name": host.name,
                "ip_address": host.ip_address,
                **detection,
            }
        )

    return {
        "result": result,
        "command": metadata["command"],
        "execution_seconds": metadata["execution_seconds"],
        "detections": ordered_detections,
    }


def get_installation_template_by_path(playbook_path, system_type=InstallationTemplate.SystemType.KUBERNETES):
    templates = InstallationTemplate.objects.filter(
        playbook_path=playbook_path,
        system_type=system_type,
    )
    template = templates.order_by("id").first()
    if template is None:
        raise InstallationTemplate.DoesNotExist
    if templates.count() > 1:
        raise ValueError(
            "Duplicate installation templates were found for "
            f"'{system_type}' and '{playbook_path}'. Apply the latest backend "
            "migrations, restart the API service, and retry."
        )
    return template


def select_installation_template(
    hosts,
    deployment_mode="auto",
    template_id=None,
    system_type="kubernetes",
    topology=Installation.Topology.SINGLE_NODE,
):
    normalized_system = (system_type or InstallationTemplate.SystemType.KUBERNETES).strip().lower()
    normalized_mode = (deployment_mode or "auto").strip().lower()
    normalized_topology = (topology or Installation.Topology.SINGLE_NODE).strip().lower()

    if normalized_mode == "manual":
        if not template_id:
            raise ValueError("template_id is required when deployment_mode is manual.")
        template = InstallationTemplate.objects.get(
            id=template_id,
            system_type=normalized_system,
        )
        if (
            normalized_topology == Installation.Topology.MULTI_NODE
            and template.deployment_type not in {
                InstallationTemplate.DeploymentType.MULTI_NODE,
                InstallationTemplate.DeploymentType.CLEANUP,
            }
        ):
            raise ValueError("The selected template is not a multi-node installation template.")

        return {
            "template": template,
            "strategy": "manual",
            "detections": [],
        }

    if normalized_topology == Installation.Topology.MULTI_NODE:
        if normalized_system not in {
            InstallationTemplate.SystemType.KUBERNETES,
            InstallationTemplate.SystemType.K3S,
        }:
            raise ValueError(f"Installer '{normalized_system}' does not support multi-node yet.")

        template = InstallationTemplate.objects.filter(
            system_type=normalized_system,
            deployment_type=InstallationTemplate.DeploymentType.MULTI_NODE,
        ).order_by("id").first()
        if template is None:
            raise InstallationTemplate.DoesNotExist

        return {
            "template": template,
            "strategy": "multi_node",
            "detections": [],
            "eligible_host_names": [host.name for host in hosts],
        }

    if normalized_system == InstallationTemplate.SystemType.K3S:
        template = get_installation_template_by_path(
            AUTO_K3S_SINGLE_NODE_PLAYBOOK_PATH,
            system_type=InstallationTemplate.SystemType.K3S,
        )
        return {
            "template": template,
            "strategy": "single_node",
            "detections": [],
        }

    if normalized_system != InstallationTemplate.SystemType.KUBERNETES:
        raise ValueError(f"Installer '{normalized_system}' is not supported yet.")

    detection_result = detect_hosts_baseline(hosts)
    detections = detection_result["detections"]
    eligible_detections = [
        item
        for item in detections
        if item["reachable"] and item["baseline_state"] != Host.BaselineState.INITIALIZED
    ]

    if not eligible_detections:
        unreachable_hosts = [item["name"] for item in detections if not item["reachable"]]
        initialized_hosts = [
            item["name"]
            for item in detections
            if item["baseline_state"] == Host.BaselineState.INITIALIZED
        ]
        problems = []
        if unreachable_hosts:
            problems.append(f"baseline detection failed for: {', '.join(unreachable_hosts)}")
        if initialized_hosts:
            problems.append(
                f"Kubernetes already appears initialized on: {', '.join(initialized_hosts)}"
            )
        raise ValueError(
            "No eligible hosts remained after baseline detection. "
            + ("; ".join(problems) if problems else "Review the selected targets.")
        )

    states = {item["baseline_state"] for item in eligible_detections}

    if normalized_mode == "prepared":
        playbook_path = AUTO_PREPARED_PLAYBOOK_PATH
        strategy = "prepared"
    elif normalized_mode == "full":
        playbook_path = AUTO_FULL_PLAYBOOK_PATH
        strategy = "full"
    else:
        all_prepared = states and states.issubset({Host.BaselineState.PREPARED})
        playbook_path = AUTO_PREPARED_PLAYBOOK_PATH if all_prepared else AUTO_FULL_PLAYBOOK_PATH
        strategy = "prepared" if all_prepared else "full"

    template = get_installation_template_by_path(
        playbook_path,
        system_type=InstallationTemplate.SystemType.KUBERNETES,
    )

    return {
        "template": template,
        "strategy": strategy,
        "detections": detections,
        "eligible_host_names": [item["name"] for item in eligible_detections],
        "detection_command": detection_result["command"],
        "detection_seconds": detection_result["execution_seconds"],
    }


def update_installation(installation, **fields):
    update_fields = []

    for field_name, value in fields.items():
        setattr(installation, field_name, value)
        update_fields.append(field_name)

    if "updated_at" not in update_fields:
        update_fields.append("updated_at")

    installation.save(update_fields=update_fields)


def update_target(target, **fields):
    update_fields = []

    for field_name, value in fields.items():
        setattr(target, field_name, value)
        update_fields.append(field_name)

    if "updated_at" not in update_fields:
        update_fields.append("updated_at")

    target.save(update_fields=update_fields)


def publish_task_progress(
    task,
    installation,
    *,
    state="PROGRESS",
    current_step=None,
    total_steps=None,
    extra_meta=None,
    task_id=None,
):
    if task is None:
        return

    meta = {
        "installation_id": installation.id,
        "status": installation.status,
        "phase": installation.phase,
        "progress": installation.progress,
        "summary_message": installation.summary_message,
        "current_step": current_step,
        "total_steps": total_steps,
        "started_at": installation.started_at.isoformat() if installation.started_at else None,
        "updated_at": installation.updated_at.isoformat() if installation.updated_at else None,
    }
    if extra_meta:
        meta.update(extra_meta)
    effective_task_id = task_id or getattr(getattr(task, "request", None), "id", None)
    if not effective_task_id:
        return
    task.update_state(task_id=effective_task_id, state=state, meta=meta)


def push_live_event(tracker, event):
    tracker["recent_events"].append(event)
    tracker["recent_events"] = tracker["recent_events"][-100:]


def compute_live_playbook_progress(completed_tasks, total_tasks):
    if total_tasks <= 0:
        return min(90, 35 + max(0, completed_tasks))

    completed_ratio = min(1.0, max(0, completed_tasks) / total_tasks)
    return min(91, 35 + round(completed_ratio * 56))


def apply_connectivity_results(targets, connectivity, stdout_text, stderr_text, return_code):
    target_map = {target.host.name: target for target in targets}

    for item in connectivity:
        target = target_map.get(item["host"])
        if target is None:
            continue

        target_status = (
            InstallationTarget.Status.SUCCESS
            if item["status"] == "success"
            else InstallationTarget.Status.FAILED
        )
        update_target(
            target,
            status=target_status,
            stdout=stdout_text,
            stderr=stderr_text,
            return_code=return_code,
            output=item["detail"],
        )


def build_execution_result(
    installation,
    *,
    inventory_content="",
    stdout="",
    stderr="",
    return_code=None,
    timings=None,
    task_profile=None,
    slow_tasks=None,
    bottleneck_hints=None,
    connectivity=None,
):
    return {
        "installation_id": installation.id,
        "status": installation.status,
        "return_code": return_code,
        "inventory_content": inventory_content,
        "stdout": stdout,
        "stderr": stderr,
        "timings": timings or {},
        "task_profile": task_profile or [],
        "slow_tasks": slow_tasks or [],
        "bottleneck_hints": bottleneck_hints or [],
        "connectivity": connectivity or [],
    }


def is_installation_cancelled(installation):
    installation.refresh_from_db()
    return (
        installation.cancel_requested
        or installation.status == Installation.Status.CANCELLED
        or installation.phase == Installation.Phase.CANCELLED
    )


def raise_if_installation_cancelled(installation, default_message):
    if is_installation_cancelled(installation):
        raise InstallationCancelled(installation.summary_message or default_message)


def finalize_cancelled_installation(
    installation,
    targets,
    *,
    summary_message,
    task=None,
    task_id=None,
    inventory_content="",
    stdout="",
    stderr="",
    return_code=None,
    timings=None,
    connectivity=None,
    extra_meta=None,
):
    existing_stdout = installation.stdout or ""
    existing_stderr = installation.stderr or ""

    update_installation(
        installation,
        status=Installation.Status.CANCELLED,
        phase=Installation.Phase.CANCELLED,
        progress=100,
        cancel_requested=False,
        runner_pid=None,
        finished_at=installation.finished_at or timezone.now(),
        summary_message=summary_message,
        stdout=stdout or existing_stdout,
        stderr=stderr or existing_stderr,
        return_code=return_code if return_code is not None else installation.return_code,
        timings=timings or installation.timings,
        connectivity=connectivity if connectivity is not None else installation.connectivity,
    )

    output_message = summary_message
    for target in targets:
        if target.status in (
            InstallationTarget.Status.PENDING,
            InstallationTarget.Status.RUNNING,
        ):
            update_target(
                target,
                status=InstallationTarget.Status.CANCELLED,
                stdout=stdout or target.stdout,
                stderr=stderr or target.stderr,
                return_code=return_code if return_code is not None else target.return_code,
                output=output_message,
            )

    publish_task_progress(
        task,
        installation,
        state="INSTALLATION_CANCELLED",
        current_step=5,
        total_steps=5,
        task_id=task_id,
        extra_meta=extra_meta,
    )

    return build_execution_result(
        installation,
        inventory_content=inventory_content or installation.inventory_content,
        stdout=installation.stdout,
        stderr=installation.stderr,
        return_code=installation.return_code,
        timings=installation.timings,
        connectivity=installation.connectivity,
    )


def request_installation_cancellation(installation):
    # Claiming a pending task and cancelling it use the same database lock.
    # The API never signals a process belonging to another container.
    with execution_transaction():
        installation.refresh_from_db()
        if installation.status not in (Installation.Status.PENDING, Installation.Status.RUNNING):
            return installation
        if installation.status == Installation.Status.PENDING:
            update_installation(
                installation, status=Installation.Status.CANCELLED,
                phase=Installation.Phase.CANCELLED, progress=100, cancel_requested=True,
                finished_at=timezone.now(), summary_message="Installation cancelled before worker execution started.",
            )
            installation.targets.update(status=InstallationTarget.Status.CANCELLED)
        else:
            update_installation(installation, cancel_requested=True,
                                summary_message="Cancellation requested. Hosts remain reserved until the worker confirms the stop.")
    # A running worker observes the flag and stops its own process group.
    if installation.status == Installation.Status.CANCELLED:
        revoke_celery_task(installation.celery_task_id)
    return installation


@controlled_installation
def execute_installation(installation_id, task=None):
    with execution_transaction():
        installation = Installation.objects.get(id=installation_id)
        if installation.status != Installation.Status.PENDING or installation.cancel_requested:
            return {"installation_id": installation_id, "status": installation.status}
        update_installation(installation, status=Installation.Status.RUNNING,
                            phase=Installation.Phase.SSH_CHECK, started_at=timezone.now())
    targets = list(
        InstallationTarget.objects.filter(installation=installation).select_related(
            "host", "host__credential"
        )
    )
    hosts = [target.host for target in targets]
    live_tracker = {
        "current_play": "",
        "current_role": "",
        "current_task": "",
        "seen_tasks": 0,
        "completed_tasks": 0,
        "total_tasks": 0,
        "recent_events": [],
        "last_output_publish": 0.0,
    }
    celery_task_id = getattr(getattr(task, "request", None), "id", None)
    inventory_content = installation.inventory_content or ""
    connectivity = installation.connectivity or []
    timings = installation.timings or {}
    openshift_secret_bundle = None
    ephemeral_secrets = {}
    ephemeral_extra_vars_paths = []
    ephemeral_inventory_paths = []

    if installation.status == Installation.Status.CANCELLED or installation.cancel_requested:
        return finalize_cancelled_installation(
            installation,
            targets,
            summary_message=installation.summary_message or "Installation cancelled before execution started.",
            task=task,
            task_id=celery_task_id,
            inventory_content=inventory_content,
            timings=timings,
            connectivity=connectivity,
        )

    update_installation(
        installation,
        status=Installation.Status.RUNNING,
        phase=Installation.Phase.SSH_CHECK,
        progress=5,
        started_at=timezone.now(),
        summary_message="Building inventory and validating SSH connectivity.",
    )
    publish_task_progress(
        task,
        installation,
        current_step=1,
        total_steps=5,
        task_id=celery_task_id,
    )

    try:
        if (
            installation.template.system_type == InstallationTemplate.SystemType.OPENSHIFT_SNO
            and installation.template.deployment_type != InstallationTemplate.DeploymentType.CLEANUP
        ):
            secret_reference = (installation.cluster_config or {}).get("secret_reference")
            if secret_reference:
                openshift_secret_bundle, ephemeral_secrets = consume_secret_bundle(secret_reference)

        normalized_host_overrides = normalize_host_overrides(
            hosts,
            installation.host_overrides,
            installation.template.system_type,
            default_cluster_name=installation.cluster_name,
        )
        overrides_by_host_id = {
            item["host_id"]: item for item in normalized_host_overrides
        }
        blocked_targets = []
        runnable_targets = []
        runnable_hosts = []
        runnable_host_overrides = []

        for target in targets:
            host_override = overrides_by_host_id.get(target.host.id, {})
            if host_override.get("execution_allowed", True):
                runnable_targets.append(target)
                runnable_hosts.append(target.host)
                runnable_host_overrides.append(host_override)
                update_target(target, status=InstallationTarget.Status.RUNNING)
                continue

            blocked_targets.append(target)
            validation_error = (
                host_override.get("validation_error")
                or "Target was excluded before execution."
            )
            update_target(
                target,
                status=InstallationTarget.Status.FAILED,
                stderr=validation_error,
                output=validation_error,
                return_code=1,
            )

        if not runnable_hosts:
            raise ValueError("No eligible target remained after validation.")

        inventory_started_at = time.perf_counter()
        inventory_path = build_inventory_file(
            runnable_hosts,
            host_overrides=runnable_host_overrides,
            topology=installation.topology,
            bootstrap_host_id=installation.bootstrap_host_id,
        )
        ephemeral_inventory_paths.append(inventory_path)
        inventory_content = redact_inventory_secrets(
            inventory_path.read_text(encoding="utf-8")
        )
        extra_vars_path = build_extra_vars_file(
            cluster_config=installation.cluster_config,
            host_overrides=runnable_host_overrides,
            system_type=installation.template.system_type,
            topology=installation.topology,
            bootstrap_host_id=installation.bootstrap_host_id,
            ephemeral_secrets=ephemeral_secrets,
        )
        ephemeral_extra_vars_paths.append(extra_vars_path)
        inventory_build_seconds = round(time.perf_counter() - inventory_started_at, 3)
        update_installation(
            installation,
            progress=12,
            inventory_content=inventory_content,
            summary_message="Inventory built. Discovering controller repository.",
        )
        raise_if_installation_cancelled(
            installation,
            "Installation cancelled after inventory generation.",
        )
        publish_task_progress(
            task,
            installation,
            current_step=2,
            total_steps=5,
            task_id=celery_task_id,
        )

        repo_discovery_started_at = time.perf_counter()
        ansible_repo_root = get_ansible_repo_root()
        repo_discovery_seconds = round(time.perf_counter() - repo_discovery_started_at, 3)
        raise_if_installation_cancelled(
            installation,
            "Installation cancelled before SSH connectivity validation.",
        )

        connectivity_result, connectivity_metadata = run_connectivity_check(
            repo_root=ansible_repo_root,
            inventory_path=inventory_path,
            expected_hosts=[host.name for host in runnable_hosts],
        )
        connectivity = connectivity_metadata["connectivity"]
        timings = {
            "inventory_build_seconds": inventory_build_seconds,
            "repo_discovery_seconds": repo_discovery_seconds,
            "ssh_check_seconds": connectivity_metadata["execution_seconds"],
        }

        update_installation(
            installation,
            command=connectivity_metadata["command"],
            connectivity=connectivity,
            timings=timings,
            stdout=connectivity_result.stdout,
            stderr=connectivity_result.stderr,
            return_code=connectivity_result.returncode,
            progress=25,
            summary_message="SSH connectivity check completed.",
        )
        raise_if_installation_cancelled(
            installation,
            "Installation cancelled after SSH connectivity validation.",
        )
        publish_task_progress(
            task,
            installation,
            current_step=3,
            total_steps=5,
            task_id=celery_task_id,
        )

        apply_connectivity_results(
            runnable_targets,
            connectivity,
            connectivity_result.stdout,
            connectivity_result.stderr,
            connectivity_result.returncode,
        )
        reachable_host_names = {
            item["host"] for item in connectivity if item["status"] == "success"
        }
        reachable_targets = [
            target
            for target in runnable_targets
            if target.host.name in reachable_host_names
        ]
        reachable_hosts = [target.host for target in reachable_targets]
        reachable_host_overrides = [
            overrides_by_host_id[target.host.id]
            for target in reachable_targets
            if target.host.id in overrides_by_host_id
        ]
        connectivity_failed_targets = [
            target
            for target in runnable_targets
            if target.host.name not in reachable_host_names
        ]

        for target in reachable_targets:
            update_target(
                target,
                status=InstallationTarget.Status.RUNNING,
                output="SSH connectivity verified. Waiting for playbook execution.",
            )

        if not reachable_targets:
            failed_targets = len(blocked_targets) + len(connectivity_failed_targets)
            update_installation(
                installation,
                status=Installation.Status.FAILED,
                phase=Installation.Phase.FAILED,
                progress=100,
                finished_at=timezone.now(),
                summary_message=(
                    "SSH connectivity failed on all eligible selected hosts."
                    if failed_targets
                    else "SSH connectivity failed before playbook execution started."
                ),
            )
            publish_task_progress(
                task,
                installation,
                state="INSTALLATION_FAILED",
                current_step=3,
                total_steps=5,
                task_id=celery_task_id,
            )
            return build_execution_result(
                installation,
                inventory_content=inventory_content,
                stdout=connectivity_result.stdout,
                stderr=connectivity_result.stderr,
                return_code=connectivity_result.returncode,
                timings=timings,
                bottleneck_hints=["SSH validation failed before Ansible playbook execution started."],
                connectivity=connectivity,
            )

        inventory_path = build_inventory_file(
            reachable_hosts,
            host_overrides=reachable_host_overrides,
            topology=installation.topology,
            bootstrap_host_id=installation.bootstrap_host_id,
        )
        ephemeral_inventory_paths.append(inventory_path)
        inventory_content = redact_inventory_secrets(
            inventory_path.read_text(encoding="utf-8")
        )
        extra_vars_path = build_extra_vars_file(
            cluster_config=installation.cluster_config,
            host_overrides=reachable_host_overrides,
            system_type=installation.template.system_type,
            topology=installation.topology,
            bootstrap_host_id=installation.bootstrap_host_id,
            ephemeral_secrets=ephemeral_secrets,
        )
        ephemeral_extra_vars_paths.append(extra_vars_path)
        try:
            control_plane_count = sum(
                1
                for item in reachable_host_overrides
                if item.get("desired_role") == "control_plane"
            )
            _, task_plan_metadata = inspect_playbook_task_count(
                repo_root=ansible_repo_root,
                playbook_relative_path=installation.template.playbook_path,
                inventory_path=inventory_path,
                extra_vars_path=extra_vars_path,
                free_strategy_group_sizes={
                    "selected_hosts": len(reachable_targets),
                    "workers": sum(
                        1
                        for item in reachable_host_overrides
                        if item.get("desired_role") == "worker"
                    ),
                    "control_plane:!bootstrap": max(0, control_plane_count - 1),
                },
            )
            live_tracker["total_tasks"] = task_plan_metadata["task_count"]
            timings["task_plan_seconds"] = task_plan_metadata["execution_seconds"]
        except (FileNotFoundError, OSError, ValueError):
            live_tracker["total_tasks"] = 0

        live_output_path = reset_live_output(installation.id)
        live_output_lock = threading.Lock()

        update_installation(
            installation,
            phase=Installation.Phase.RUNNING_PLAYBOOK,
            progress=35,
            summary_message=(
                f"SSH connectivity verified on {len(reachable_targets)} target(s). "
                "Running Ansible playbook."
            ),
        )
        raise_if_installation_cancelled(
            installation,
            "Installation cancelled before Ansible playbook execution started.",
        )

        def publish_live_playbook_state(force=True):
            published_at = time.monotonic()
            if (
                not force
                and published_at - live_tracker["last_output_publish"] < 0.5
            ):
                return
            live_tracker["last_output_publish"] = published_at
            publish_task_progress(
                task,
                installation,
                current_step=4,
                total_steps=5,
                task_id=celery_task_id,
                extra_meta={
                    "current_play": live_tracker["current_play"],
                    "current_role": live_tracker["current_role"],
                    "current_task": live_tracker["current_task"],
                    "seen_tasks": live_tracker["seen_tasks"],
                    "completed_tasks": live_tracker["completed_tasks"],
                    "total_tasks": live_tracker["total_tasks"],
                    "recent_events": live_tracker["recent_events"],
                },
            )

        def handle_playbook_line(channel, line):
            if is_installation_cancelled(installation):
                return

            timestamp = timezone.now().isoformat()
            append_live_output_line(
                live_output_path,
                live_output_lock,
                channel=channel,
                line=line,
                timestamp=timestamp,
            )
            parsed = parse_live_ansible_line(line)
            if not parsed:
                publish_live_playbook_state(force=False)
                return

            if parsed["kind"] == "play_started":
                live_tracker["current_play"] = parsed["play"]
                push_live_event(
                    live_tracker,
                    {
                        "kind": "play_started",
                        "play": parsed["play"],
                        "channel": channel,
                        "timestamp": timestamp,
                    },
                )
                publish_live_playbook_state()
                return

            if parsed["kind"] == "task_started":
                if live_tracker["seen_tasks"] > 0:
                    live_tracker["completed_tasks"] = max(
                        live_tracker["completed_tasks"],
                        live_tracker["seen_tasks"],
                    )

                live_tracker["seen_tasks"] += 1
                live_tracker["total_tasks"] = max(
                    live_tracker["total_tasks"],
                    live_tracker["seen_tasks"],
                )
                live_tracker["current_role"] = parsed["role"]
                live_tracker["current_task"] = parsed["task"]

                role_prefix = f"{parsed['role']} : " if parsed["role"] else ""
                task_label = f"{role_prefix}{parsed['task']}"

                update_installation(
                    installation,
                    progress=compute_live_playbook_progress(
                        live_tracker["completed_tasks"],
                        live_tracker["total_tasks"],
                    ),
                    summary_message=f"Current task: {task_label}",
                )
                push_live_event(
                    live_tracker,
                    {
                        "kind": "task_started",
                        "role": parsed["role"],
                        "task": parsed["task"],
                        "channel": channel,
                        "timestamp": timestamp,
                    },
                )
                publish_live_playbook_state()
                return

            if parsed["kind"] == "task_result":
                push_live_event(
                    live_tracker,
                    {
                        "kind": "task_result",
                        "host": parsed["host"],
                        "status": parsed["status"],
                        "line": parsed["line"],
                        "channel": channel,
                        "timestamp": timestamp,
                        "task": live_tracker["current_task"],
                        "role": live_tracker["current_role"],
                    },
                )
                publish_live_playbook_state()

        publish_live_playbook_state()

        telemetry_poller = None
        if installation.template.system_type == InstallationTemplate.SystemType.OPENSHIFT_SNO:
            cluster_cfg = installation.cluster_config or {}
            target_ip = cluster_cfg.get("rendezvous_ip") or "192.168.130.10"
            cluster_name = cluster_cfg.get("cluster_name") or "sno-01"
            home_dir = os.environ.get("HOME") or "/home/rayen"
            assets_dir = f"{home_dir}/.local/share/lindeploy/openshift-agent/{cluster_name}"
            standard_assets_dir = f"/var/lib/lindeploy/openshift-agent/{cluster_name}"
            legacy_assets_dir = f"{home_dir}/.local/share/lindeploy/openshift-agent/{cluster_name}"
            assets_dir = standard_assets_dir if os.path.isdir(standard_assets_dir) else legacy_assets_dir

            def on_telemetry(data):
                stage = data.get("stage") or ""
                stage_pct = data.get("stage_percentage") or 0
                tot_pct = data.get("total_percentage") or 0
                prog_info = data.get("progress_info") or ""
                extra = f" ({prog_info})" if prog_info and prog_info != str(stage_pct) + "%" else ""
                msg = f"Stage: {stage}{extra} - {stage_pct}% (Cluster: {tot_pct}%)"
                installation.summary_message = msg
                update_installation(
                    installation,
                    summary_message=msg,
                    progress=max(installation.progress or 0, min(92, 35 + int(tot_pct * 0.57))),
                )
                publish_task_progress(
                    task,
                    installation,
                    current_step=4,
                    total_steps=5,
                    task_id=celery_task_id,
                    extra_meta={
                        "current_play": live_tracker["current_play"],
                        "current_role": live_tracker["current_role"],
                        "current_task": live_tracker["current_task"],
                        "seen_tasks": live_tracker["seen_tasks"],
                        "completed_tasks": live_tracker["completed_tasks"],
                        "total_tasks": live_tracker["total_tasks"],
                        "recent_events": live_tracker["recent_events"],
                        "telemetry": data,
                    },
                )

            try:
                telemetry_poller = OpenShiftTelemetryPoller(
                    vm_ip=target_ip,
                    assets_directory=assets_dir,
                    on_update_callback=on_telemetry,
                    poll_interval=5.0,
                )
                telemetry_poller.start()
            except Exception:
                pass

        try:
            result, playbook_metadata = run_playbook(
                repo_root=ansible_repo_root,
                playbook_relative_path=installation.template.playbook_path,
                inventory_path=inventory_path,
                extra_vars_path=extra_vars_path,
                on_stdout_line=lambda line: handle_playbook_line("stdout", line),
                on_stderr_line=lambda line: handle_playbook_line("stderr", line),
                on_process_start=lambda process: update_installation(
                    installation,
                    runner_pid=process.pid,
                ),
            )
        finally:
            if telemetry_poller:
                telemetry_poller.stop()

        timings["playbook_execution_seconds"] = playbook_metadata["execution_seconds"]
        live_tracker["completed_tasks"] = max(
            live_tracker["completed_tasks"],
            live_tracker["seen_tasks"],
        )
        update_installation(installation, runner_pid=None)

        if is_installation_cancelled(installation):
            return finalize_cancelled_installation(
                installation,
                targets,
                summary_message=installation.summary_message or "Installation cancelled by user.",
                task=task,
                task_id=celery_task_id,
                inventory_content=inventory_content,
                stdout=result.stdout,
                stderr=result.stderr,
                return_code=result.returncode,
                timings=timings,
                connectivity=connectivity,
                extra_meta={
                    "current_play": live_tracker["current_play"],
                    "current_role": live_tracker["current_role"],
                    "current_task": live_tracker["current_task"],
                    "seen_tasks": live_tracker["seen_tasks"],
                    "completed_tasks": live_tracker["completed_tasks"],
                    "total_tasks": live_tracker["total_tasks"],
                    "recent_events": live_tracker["recent_events"],
                },
            )

        update_installation(
            installation,
            phase=Installation.Phase.FINALIZING,
            progress=92,
            runner_pid=None,
            summary_message="Collecting Ansible output and saving the final result.",
        )
        publish_task_progress(
            task,
            installation,
            current_step=5,
            total_steps=5,
            task_id=celery_task_id,
            extra_meta={
                "current_play": live_tracker["current_play"],
                "current_role": live_tracker["current_role"],
                "current_task": live_tracker["current_task"],
                "seen_tasks": live_tracker["seen_tasks"],
                "completed_tasks": live_tracker["completed_tasks"],
                "total_tasks": live_tracker["total_tasks"],
                "recent_events": live_tracker["recent_events"],
            },
        )

        playbook_target_results = apply_playbook_results(
            reachable_targets,
            result.stdout,
            result.stderr,
            result.returncode,
        )
        failed_targets = (
            len(blocked_targets)
            + len(connectivity_failed_targets)
            + playbook_target_results["failed_count"]
        )
        successful_targets = playbook_target_results["success_count"]
        installation_status = (
            Installation.Status.SUCCESS
            if failed_targets == 0 and result.returncode == 0
            else (
                Installation.Status.PARTIAL_SUCCESS
                if successful_targets > 0 and installation.topology != Installation.Topology.MULTI_NODE
                else Installation.Status.FAILED
            )
        )
        installation_phase = (
            Installation.Phase.COMPLETED
            if installation_status in (Installation.Status.SUCCESS, Installation.Status.PARTIAL_SUCCESS)
            else Installation.Phase.FAILED
        )
        summary_message = (
            "Playbook executed successfully on all selected hosts."
            if installation_status == Installation.Status.SUCCESS
            else (
                f"Playbook completed on {successful_targets} host(s) and failed on {failed_targets} host(s)."
                if installation_status == Installation.Status.PARTIAL_SUCCESS
                else "Playbook execution failed on all selected hosts."
            )
        )

        update_installation(
            installation,
            status=installation_status,
            phase=installation_phase,
            progress=100,
            finished_at=timezone.now(),
            command=playbook_metadata["command"],
            stdout=sanitize_log_line(result.stdout),
            stderr=sanitize_log_line(result.stderr),
            summary_message=summary_message,
            return_code=result.returncode,
            timings=timings,
            task_profile=playbook_metadata["task_profile"],
            bottleneck_hints=playbook_metadata["bottleneck_hints"],
        )
        publish_task_progress(
            task,
            installation,
            state=(
                "INSTALLATION_SUCCESS"
                if installation_status == Installation.Status.SUCCESS
                else (
                    "INSTALLATION_PARTIAL_SUCCESS"
                    if installation_status == Installation.Status.PARTIAL_SUCCESS
                    else "INSTALLATION_FAILED"
                )
            ),
            current_step=5,
            total_steps=5,
            task_id=celery_task_id,
            extra_meta={
                "current_play": live_tracker["current_play"],
                "current_role": live_tracker["current_role"],
                "current_task": live_tracker["current_task"],
                "seen_tasks": live_tracker["seen_tasks"],
                "completed_tasks": live_tracker["completed_tasks"],
                "recent_events": live_tracker["recent_events"],
            },
        )

        return build_execution_result(
            installation,
            inventory_content=inventory_content,
            stdout=result.stdout,
            stderr=result.stderr,
            return_code=result.returncode,
            timings=timings,
            task_profile=playbook_metadata["task_profile"],
            slow_tasks=playbook_metadata["slow_tasks"],
            bottleneck_hints=playbook_metadata["bottleneck_hints"],
            connectivity=connectivity,
        )

    except ProcessStopUnconfirmed:
        update_installation(installation, summary_message="Worker could not confirm process stop. Hosts remain reserved; operator verification required.")
        raise

    except InstallationCancelled as exc:
        return finalize_cancelled_installation(
            installation,
            targets,
            summary_message=str(exc),
            task=task,
            task_id=celery_task_id,
            inventory_content=inventory_content,
            timings=timings,
            connectivity=connectivity,
            extra_meta={
                "current_play": live_tracker["current_play"],
                "current_role": live_tracker["current_role"],
                "current_task": live_tracker["current_task"],
                "seen_tasks": live_tracker["seen_tasks"],
                "completed_tasks": live_tracker["completed_tasks"],
                "recent_events": live_tracker["recent_events"],
            },
        )

    except Exception as exc:
        if installation.status == Installation.Status.CANCELLED or installation.cancel_requested:
            return finalize_cancelled_installation(
                installation,
                targets,
                summary_message=installation.summary_message or "Installation cancelled by user.",
                task=task,
                task_id=celery_task_id,
                inventory_content=inventory_content,
                timings=timings,
                connectivity=connectivity,
                extra_meta={
                    "current_play": live_tracker["current_play"],
                    "current_role": live_tracker["current_role"],
                    "current_task": live_tracker["current_task"],
                    "seen_tasks": live_tracker["seen_tasks"],
                    "completed_tasks": live_tracker["completed_tasks"],
                    "recent_events": live_tracker["recent_events"],
                },
            )

        update_installation(
            installation,
            status=Installation.Status.FAILED,
            phase=Installation.Phase.FAILED,
            progress=100,
            runner_pid=None,
            finished_at=timezone.now(),
            summary_message=str(exc),
            stderr=str(exc),
        )
        publish_task_progress(
            task,
            installation,
            state="INSTALLATION_EXCEPTION",
            current_step=5,
            total_steps=5,
            task_id=celery_task_id,
        )

        for target in targets:
            update_target(
                target,
                status=InstallationTarget.Status.FAILED,
                stderr=str(exc),
                output=str(exc),
            )

        raise

    finally:
        ephemeral_secrets.clear()
        for ephemeral_path in ephemeral_extra_vars_paths:
            try:
                ephemeral_path.unlink(missing_ok=True)
                ephemeral_path.parent.rmdir()
            except OSError:
                pass
        for inventory_path in ephemeral_inventory_paths:
            try:
                for generated_file in inventory_path.parent.iterdir():
                    if generated_file.is_file():
                        generated_file.unlink(missing_ok=True)
                inventory_path.parent.rmdir()
            except OSError:
                pass
        destroy_secret_bundle(openshift_secret_bundle)
