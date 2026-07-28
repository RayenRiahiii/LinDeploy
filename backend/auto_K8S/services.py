import os
import re
import stat
import subprocess
import tempfile
import time
from pathlib import Path

from celery.result import AsyncResult
from django.conf import settings
from django.utils import timezone

from backend.celery import app as celery_app
from .models import Host, Installation, InstallationTarget, InstallationTemplate
from .runners import get_runner


class InstallationCancelled(Exception):
    pass


AUTO_FULL_PLAYBOOK_PATH = "playbooks/k8s_single_node.yml"
AUTO_PREPARED_PLAYBOOK_PATH = "playbooks/init_single_node.yml"
AUTO_K3S_SINGLE_NODE_PLAYBOOK_PATH = "playbooks/k3s_single_node.yml"


def revoke_celery_task(task_id):
    if not task_id:
        return

    try:
        AsyncResult(task_id, app=celery_app).revoke(terminate=False)
    except Exception:
        pass


def kill_process_tree(pid):
    if not pid:
        return

    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                text=True,
                check=False,
                shell=False,
            )
            return

        import signal

        os.killpg(pid, signal.SIGTERM)
    except Exception:
        pass


def build_inventory_file(hosts):
    runner = get_runner()
    temp_dir = Path(tempfile.mkdtemp())
    inventory_lines = [
        "all:",
        "  children:",
        "    selected_hosts:",
        "      hosts:",
    ]

    for host in hosts:
        inventory_lines.append(f"        {host.name}:")
        inventory_lines.append(f"          ansible_host: {host.ip_address}")
        inventory_lines.append(f"          ansible_port: {host.ssh_port}")

        if not host.credential:
            continue

        inventory_lines.append(f"          ansible_user: \"{host.credential.username}\"")

        if host.credential.auth_type == "password" and host.credential.password:
            inventory_lines.append(f"          ansible_password: \"{host.credential.password}\"")

        if host.credential.auth_type == "ssh_key" and host.credential.private_key:
            key_path = temp_dir / f"{host.name}-{host.credential.id}.pem"
            key_path.write_text(host.credential.private_key, encoding="utf-8")
            os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)
            inventory_lines.append(
                f"          ansible_ssh_private_key_file: \"{runner.to_runner_path(key_path)}\""
            )

        if host.credential.become_password:
            inventory_lines.append(
                f"          ansible_become_password: \"{host.credential.become_password}\""
            )

    inventory_path = temp_dir / "inventory.yml"
    inventory_path.write_text("\n".join(inventory_lines) + "\n", encoding="utf-8")

    return inventory_path


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
            Path(settings.BASE_DIR) / "backend" / "Playbooks" / "k8s-single-noded" / "k8s-single-noded",
            Path(settings.BASE_DIR) / "backend" / "Playbooks" / "k8s-single-noded",
            Path(settings.BASE_DIR) / "ansible" / "k8s-single-noded",
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
        "printf 'BASELINE_FACTS containerd_installed=%s containerd_active=%s kubelet_installed=%s "
        "kubeadm_installed=%s kubectl_installed=%s swap_disabled=%s modules_configured=%s "
        "sysctl_configured=%s admin_conf_exists=%s\n' "
        "\"$containerd_installed\" \"$containerd_active\" \"$kubelet_installed\" \"$kubeadm_installed\" "
        "\"$kubectl_installed\" \"$swap_disabled\" \"$modules_configured\" \"$sysctl_configured\" \"$admin_conf_exists\""
    )


def classify_baseline_facts(facts):
    if facts.get("admin_conf_exists"):
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
    on_stdout_line=None,
    on_stderr_line=None,
    on_process_start=None,
):
    runner = get_runner()
    result, metadata = runner.run_playbook(
        repo_root=repo_root,
        playbook_relative_path=playbook_relative_path,
        inventory_path=inventory_path,
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
    return InstallationTemplate.objects.get(
        playbook_path=playbook_path,
        system_type=system_type,
    )


def select_installation_template(hosts, deployment_mode="auto", template_id=None, system_type="kubernetes"):
    normalized_system = (system_type or InstallationTemplate.SystemType.KUBERNETES).strip().lower()

    normalized_mode = (deployment_mode or "auto").strip().lower()

    if normalized_mode == "manual":
        if not template_id:
            raise ValueError("template_id is required when deployment_mode is manual.")
        template = InstallationTemplate.objects.get(
            id=template_id,
            system_type=normalized_system,
        )
        return {
            "template": template,
            "strategy": "manual",
            "detections": [],
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
    states = {item["baseline_state"] for item in detections}
    unreachable_hosts = [item for item in detections if not item["reachable"]]

    if unreachable_hosts:
        host_names = ", ".join(item["name"] for item in unreachable_hosts)
        raise ValueError(f"Baseline detection failed for: {host_names}.")

    initialized_hosts = [item for item in detections if item["baseline_state"] == Host.BaselineState.INITIALIZED]
    if initialized_hosts:
        host_names = ", ".join(item["name"] for item in initialized_hosts)
        raise ValueError(
            f"Kubernetes already appears initialized on: {host_names}. Reset those nodes before reinstalling."
        )

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
    tracker["recent_events"] = tracker["recent_events"][-25:]


def compute_live_playbook_progress(seen_tasks):
    return min(88, 35 + max(0, seen_tasks - 1) * 3)


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
    current_pid = installation.runner_pid
    was_pending = installation.status == Installation.Status.PENDING

    update_installation(
        installation,
        status=Installation.Status.CANCELLED,
        phase=Installation.Phase.CANCELLED,
        progress=100,
        cancel_requested=True,
        finished_at=installation.finished_at or timezone.now(),
        summary_message=(
            "Installation cancelled before worker execution started."
            if was_pending and not current_pid
            else "Installation cancelled by user. The running process was stopped."
        ),
    )

    revoke_celery_task(installation.celery_task_id)
    kill_process_tree(current_pid)

    if current_pid:
        update_installation(installation, runner_pid=None)

    for target in installation.targets.select_related("host").all():
        if target.status in (
            InstallationTarget.Status.PENDING,
            InstallationTarget.Status.RUNNING,
        ):
            update_target(
                target,
                status=InstallationTarget.Status.CANCELLED,
                output=installation.summary_message,
            )

    return installation


def execute_installation(installation_id, task=None):
    installation = Installation.objects.get(id=installation_id)
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
        "recent_events": [],
    }
    celery_task_id = getattr(getattr(task, "request", None), "id", None)
    inventory_content = installation.inventory_content or ""
    connectivity = installation.connectivity or []
    timings = installation.timings or {}

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
        cancel_requested=False,
        summary_message="Building inventory and validating SSH connectivity.",
    )
    publish_task_progress(
        task,
        installation,
        current_step=1,
        total_steps=5,
        task_id=celery_task_id,
    )

    for target in targets:
        update_target(target, status=InstallationTarget.Status.RUNNING)

    try:
        inventory_started_at = time.perf_counter()
        inventory_path = build_inventory_file(hosts)
        inventory_content = inventory_path.read_text(encoding="utf-8")
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
            expected_hosts=[host.name for host in hosts],
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

        if connectivity_result.returncode != 0:
            apply_connectivity_results(
                targets,
                connectivity,
                connectivity_result.stdout,
                connectivity_result.stderr,
                connectivity_result.returncode,
            )
            update_installation(
                installation,
                status=Installation.Status.FAILED,
                phase=Installation.Phase.FAILED,
                progress=100,
                finished_at=timezone.now(),
                summary_message="SSH connectivity check failed for one or more selected hosts.",
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

        update_installation(
            installation,
            phase=Installation.Phase.RUNNING_PLAYBOOK,
            progress=35,
            summary_message="SSH connectivity verified. Running Ansible playbook.",
        )
        raise_if_installation_cancelled(
            installation,
            "Installation cancelled before Ansible playbook execution started.",
        )

        def publish_live_playbook_state():
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
                    "recent_events": live_tracker["recent_events"],
                },
            )

        def handle_playbook_line(channel, line):
            if is_installation_cancelled(installation):
                return

            parsed = parse_live_ansible_line(line)
            if not parsed:
                return

            timestamp = timezone.now().isoformat()

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
                        live_tracker["seen_tasks"] - 1,
                    )

                live_tracker["seen_tasks"] += 1
                live_tracker["current_role"] = parsed["role"]
                live_tracker["current_task"] = parsed["task"]

                role_prefix = f"{parsed['role']} : " if parsed["role"] else ""
                task_label = f"{role_prefix}{parsed['task']}"

                update_installation(
                    installation,
                    progress=compute_live_playbook_progress(live_tracker["seen_tasks"]),
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

        result, playbook_metadata = run_playbook(
            repo_root=ansible_repo_root,
            playbook_relative_path=installation.template.playbook_path,
            inventory_path=inventory_path,
            on_stdout_line=lambda line: handle_playbook_line("stdout", line),
            on_stderr_line=lambda line: handle_playbook_line("stderr", line),
            on_process_start=lambda process: update_installation(
                installation,
                runner_pid=process.pid,
            ),
        )
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
                    "recent_events": live_tracker["recent_events"],
                },
            )

        installation_status = (
            Installation.Status.SUCCESS if result.returncode == 0 else Installation.Status.FAILED
        )
        installation_phase = (
            Installation.Phase.COMPLETED if result.returncode == 0 else Installation.Phase.FAILED
        )
        target_status = (
            InstallationTarget.Status.SUCCESS
            if result.returncode == 0
            else InstallationTarget.Status.FAILED
        )
        summary_message = (
            "Playbook executed successfully."
            if result.returncode == 0
            else "Playbook execution failed."
        )

        update_installation(
            installation,
            status=installation_status,
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
        )

        for target in targets:
            update_target(
                target,
                status=target_status,
                stdout=result.stdout,
                stderr=result.stderr,
                return_code=result.returncode,
                output=f"STDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}",
            )

        update_installation(
            installation,
            status=installation_status,
            phase=installation_phase,
            progress=100,
            cancel_requested=False,
            finished_at=timezone.now(),
            command=playbook_metadata["command"],
            stdout=result.stdout,
            stderr=result.stderr,
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
                else "INSTALLATION_FAILED"
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
