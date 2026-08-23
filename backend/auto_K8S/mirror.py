import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings


PROJECT_ROOT = Path(settings.BASE_DIR).parent
MIRROR_ROOT = PROJECT_ROOT / "infra" / "mirror"
MIRROR_STATE_PATH = MIRROR_ROOT / "runtime" / "prewarm-state.json"
MIRROR_LOCK_PATH = MIRROR_ROOT / "runtime" / "prewarm.lock"
MIRROR_LOG_PATH = MIRROR_ROOT / "runtime" / "prewarm.log"


def _empty_component():
    return {
        "profile": "",
        "status": "idle",
        "active_version": "",
        "available_version": "",
        "last_checked_at": "",
        "last_prewarm_at": "",
        "manifest_path": "",
        "manifest_sha256": "",
        "error": "",
    }


def read_mirror_state():
    payload = {
        "updated_at": "",
        "components": {
            "kubernetes": _empty_component(),
            "k3s": _empty_component(),
        },
    }
    try:
        stored = json.loads(MIRROR_STATE_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return payload

    payload["updated_at"] = stored.get("updated_at", "")
    for name in ("kubernetes", "k3s"):
        component = stored.get("components", {}).get(name, {})
        # Recover the final state object from legacy PowerShell pipeline output.
        if isinstance(component, list):
            component = next(
                (item for item in reversed(component) if isinstance(item, dict)),
                {},
            )
        if not isinstance(component, dict):
            component = {}
        payload["components"][name].update(
            {key: component.get(key, default) for key, default in payload["components"][name].items()}
        )
    return payload


def write_mirror_state(payload):
    MIRROR_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    temporary_path = MIRROR_STATE_PATH.with_suffix(".json.tmp")
    temporary_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temporary_path.replace(MIRROR_STATE_PATH)


def mark_mirror_prewarm_queued():
    state = read_mirror_state()
    for component in state["components"].values():
        if component["status"] not in {"running", "checking"}:
            component["status"] = "queued"
            component["error"] = ""
    write_mirror_state(state)
    return state


def mark_mirror_prewarm_failed(message):
    state = read_mirror_state()
    for component in state["components"].values():
        if component["status"] in {"queued", "checking", "running"}:
            component["status"] = "failed"
            component["error"] = str(message)
    write_mirror_state(state)
    return state


def mirror_status_payload():
    state = read_mirror_state()
    return {
        "enabled": bool(settings.LINDEPLOY_MIRROR_ENABLED),
        "automatic": True,
        "interval_hours": settings.LINDEPLOY_MIRROR_PREWARM_INTERVAL_HOURS,
        **state,
    }


def _mirror_server_host():
    candidates = [
        settings.LINDEPLOY_PACKAGE_MIRROR_BASE_URL,
        *settings.LINDEPLOY_REGISTRY_MIRRORS.values(),
    ]
    for candidate in candidates:
        hostname = urlparse(str(candidate)).hostname
        if hostname:
            return hostname
    raise RuntimeError("No LinDeploy mirror server address is configured.")


def _acquire_lock():
    MIRROR_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    if MIRROR_LOCK_PATH.exists():
        age = time.time() - MIRROR_LOCK_PATH.stat().st_mtime
        lock_content = MIRROR_LOCK_PATH.read_text(encoding="utf-8", errors="replace")
        pid_match = re.search(r"^pid=(\d+)$", lock_content, flags=re.MULTILINE)
        owner_running = _process_is_running(int(pid_match.group(1))) if pid_match else False
        if not owner_running or age > settings.LINDEPLOY_MIRROR_PREWARM_TIMEOUT_SECONDS + 300:
            MIRROR_LOCK_PATH.unlink(missing_ok=True)
    try:
        descriptor = os.open(MIRROR_LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    with os.fdopen(descriptor, "w", encoding="utf-8") as lock_file:
        lock_file.write(f"pid={os.getpid()}\nstarted_at={datetime.now(timezone.utc).isoformat()}\n")
    return True


def _process_is_running(pid):
    if pid <= 0:
        return False
    if os.name == "nt":
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.returncode == 0 and f'"{pid}"' in result.stdout
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return False
    return True


def run_automatic_mirror_prewarm(force=False):
    if not settings.LINDEPLOY_MIRROR_ENABLED:
        return {"status": "skipped", "message": "LinDeploy mirror is disabled."}
    script_path = MIRROR_ROOT / "auto-prewarm.ps1"
    if not script_path.is_file():
        raise RuntimeError(f"Automatic prewarm script not found at {script_path}.")
    if not _acquire_lock():
        return {"status": "already_running", "message": "A mirror prewarm is already running."}

    command = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
        "-ServerIp",
        _mirror_server_host(),
    ]
    if force:
        command.append("-Force")

    try:
        result = subprocess.run(
            command,
            cwd=MIRROR_ROOT,
            capture_output=True,
            text=True,
            timeout=settings.LINDEPLOY_MIRROR_PREWARM_TIMEOUT_SECONDS,
            check=False,
        )
        MIRROR_LOG_PATH.write_text(
            f"STDOUT\n{result.stdout}\n\nSTDERR\n{result.stderr}",
            encoding="utf-8",
        )
        if result.returncode != 0:
            raise RuntimeError(
                "Automatic mirror prewarm failed. "
                f"Review {MIRROR_LOG_PATH}. Return code: {result.returncode}."
            )
        return {
            "status": "success",
            "message": "Stable Kubernetes and K3s content is ready.",
            "state": read_mirror_state(),
        }
    except subprocess.TimeoutExpired as exc:
        message = (
            "Automatic mirror prewarm exceeded the configured timeout of "
            f"{settings.LINDEPLOY_MIRROR_PREWARM_TIMEOUT_SECONDS} seconds."
        )
        mark_mirror_prewarm_failed(message)
        raise RuntimeError(message) from exc
    except Exception as exc:
        mark_mirror_prewarm_failed(exc)
        raise
    finally:
        MIRROR_LOCK_PATH.unlink(missing_ok=True)
