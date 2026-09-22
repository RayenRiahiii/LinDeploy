import hashlib
import json
import re
import subprocess
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import MirrorPrewarmJob, MirrorProfile


PROJECT_ROOT = Path(settings.BASE_DIR).parent
MIRROR_ROOT = PROJECT_ROOT / "infra" / "mirror"
MIRROR_STATE_PATH = MIRROR_ROOT / "runtime" / "prewarm-state.json"
MIRROR_LOG_PATH = MIRROR_ROOT / "runtime" / "prewarm.log"
ACTIVE_JOB_STATES = {"queued", "running", "verifying"}


def _empty_component():
    return {
        "profile": "", "status": "idle", "active_version": "",
        "available_version": "", "last_checked_at": "", "last_prewarm_at": "",
        "manifest_path": "", "manifest_sha256": "", "error": "",
    }


def read_mirror_state():
    payload = {"updated_at": "", "components": {"kubernetes": _empty_component(), "k3s": _empty_component()}}
    try:
        stored = json.loads(MIRROR_STATE_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return payload
    payload["updated_at"] = stored.get("updated_at", "")
    for name in payload["components"]:
        component = stored.get("components", {}).get(name, {})
        if isinstance(component, list):
            component = next((item for item in reversed(component) if isinstance(item, dict)), {})
        if isinstance(component, dict):
            payload["components"][name].update(
                {key: component.get(key, default) for key, default in payload["components"][name].items()}
            )
    return payload


def write_mirror_state(payload):
    MIRROR_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload["updated_at"] = datetime.now(dt_timezone.utc).isoformat()
    temporary = MIRROR_STATE_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temporary.replace(MIRROR_STATE_PATH)


def mark_mirror_prewarm_queued():
    state = read_mirror_state()
    for component in state["components"].values():
        if component["status"] not in {"running", "checking"}:
            component.update(status="queued", error="")
    write_mirror_state(state)
    return state


def mark_mirror_prewarm_failed(message):
    state = read_mirror_state()
    for component in state["components"].values():
        if component["status"] in {"queued", "checking", "running"}:
            component.update(status="failed", error=str(message))
    write_mirror_state(state)
    return state


def mirror_status_payload():
    profiles = list(MirrorProfile.objects.order_by("platform", "-created_at").values(
        "profile_id", "platform", "exact_version", "architecture", "os_family",
        "os_release", "size_bytes", "verification_state", "pinned", "verified_at",
    )[:50])
    active_job = MirrorPrewarmJob.objects.filter(state__in=ACTIVE_JOB_STATES).first()
    return {
        "enabled": bool(settings.LINDEPLOY_MIRROR_ENABLED), "automatic": True,
        "interval_hours": settings.LINDEPLOY_MIRROR_PREWARM_INTERVAL_HOURS,
        "profiles": profiles, "active_job_id": str(active_job.job_id) if active_job else "",
        **read_mirror_state(),
    }


def _mirror_server_host():
    for candidate in [settings.LINDEPLOY_PACKAGE_MIRROR_BASE_URL, *settings.LINDEPLOY_REGISTRY_MIRRORS.values()]:
        hostname = urlparse(str(candidate)).hostname
        if hostname:
            return hostname
    raise RuntimeError("No LinDeploy mirror server address is configured.")


def queue_mirror_prewarm(force=False):
    dedupe_key = "stable-kubernetes-k3s-amd64"
    try:
        with transaction.atomic():
            active = MirrorPrewarmJob.objects.select_for_update().filter(
                dedupe_key=dedupe_key, state__in=ACTIVE_JOB_STATES
            ).first()
            if active:
                return active, False
                is_stuck = False
                if active.state == "queued" and (timezone.now() - active.created_at).total_seconds() > 180:
                    is_stuck = True
                elif active.lease_expires_at and active.lease_expires_at < timezone.now():
                    is_stuck = True

                if force or is_stuck:
                    active.state = "cancelled" if force else "failed"
                    active.error = "Superseded by forced request." if force else "Job lease expired or stuck in queue."
                    active.finished_at = timezone.now()
                    active.owner_token = None
                    active.save(update_fields=["state", "error", "finished_at", "owner_token", "updated_at"])
                else:
                    return active, False
            job = MirrorPrewarmJob.objects.create(
                dedupe_key=dedupe_key, requested_components=["kubernetes", "k3s"],
                result={"force": bool(force)},
            )
    except IntegrityError:
        # The partial unique index closes the race where two workers both
        # observe no active row before either transaction inserts one.
        return MirrorPrewarmJob.objects.get(
            dedupe_key=dedupe_key, state__in=ACTIVE_JOB_STATES
        ), False
    mark_mirror_prewarm_queued()
    return job, True


def _claim_job(job_id):
    with transaction.atomic():
        job = MirrorPrewarmJob.objects.select_for_update().get(job_id=job_id)
        if job.owner_token and job.lease_expires_at and job.lease_expires_at > timezone.now() and job.state != "queued":
            return None
        job.owner_token = uuid.uuid4()
        job.lease_expires_at = timezone.now() + timedelta(
            seconds=settings.LINDEPLOY_MIRROR_PREWARM_TIMEOUT_SECONDS + 300
        )
        job.state = "running"
        job.started_at = job.started_at or timezone.now()
        job.attempts += 1
        job.progress = 5
        job.error = ""
        job.save()
        return job


def _validated_profile(component, state):
    manifest_path = Path(state.get("manifest_path", ""))
    if not manifest_path.is_file():
        raise RuntimeError(f"{component} profile manifest is missing: {manifest_path}")
    raw = manifest_path.read_bytes()
    manifest_sha256 = hashlib.sha256(raw).hexdigest()
    if manifest_sha256 != state.get("manifest_sha256"):
        raise RuntimeError(f"{component} profile manifest hash does not match its recorded hash")
    manifest = json.loads(raw.decode("utf-8-sig"))
    assets = manifest.get("assets", [])
    if (
        manifest.get("schema_version") != 1 or manifest.get("component") != component
        or manifest.get("version") != state.get("active_version")
        or not re.fullmatch(r"v\d+\.\d+\.\d+(?:\+k3s\d+)?", manifest.get("version", ""))
        or manifest.get("asset_count") != len(assets) or not assets
    ):
        raise RuntimeError(f"{component} profile manifest identity or asset count is invalid")
    for asset in assets:
        if not re.fullmatch(r"[0-9a-f]{64}", str(asset.get("sha256", ""))) or int(asset.get("size", -1)) < 0:
            raise RuntimeError(f"{component} profile contains an unverified asset")
    architecture = manifest.get("architecture", "")
    return {
        "profile_id": f"{component}-{manifest['version']}-{architecture}-all-supported",
        "platform": component, "exact_version": manifest["version"], "architecture": architecture,
        "os_family": "supported", "os_release": "pinned-by-manifest",
        "package_set": [a for a in assets if a["url"].endswith((".rpm", ".deb"))],
        "oci_images": [a for a in assets if "/v2/" in a["url"]], "artifacts": assets,
        "provenance": {"manifest": str(manifest_path), "generated_at": manifest.get("generated_at", "")},
        "manifest_sha256": manifest_sha256, "content_generation": manifest_sha256,
        "size_bytes": sum(int(a["size"]) for a in assets),
    }


def _persist_profiles(state, job):
    profile_ids = []
    with transaction.atomic():
        for component in ("kubernetes", "k3s"):
            component_state = state["components"][component]
            if component_state.get("status") != "ready":
                raise RuntimeError(f"{component} did not reach ready state")
            values = _validated_profile(component, component_state)
            profile_id = values.pop("profile_id")
            profile, created = MirrorProfile.objects.get_or_create(profile_id=profile_id, defaults=values)
            if not created and any(
                getattr(profile, field) != values[field]
                for field in ("manifest_sha256", "content_generation", "exact_version", "architecture")
            ):
                raise RuntimeError(f"immutable profile {profile_id} conflicts with existing content")
            profile.verification_state = "ready"
            profile.verified_at = timezone.now()
            profile.verification_error = ""
            profile.save(update_fields=["verification_state", "verified_at", "verification_error", "updated_at"])
            profile_ids.append(profile_id)
        job.requested_profiles = profile_ids
        job.save(update_fields=["requested_profiles", "updated_at"])
    return profile_ids


def run_automatic_mirror_prewarm(job_id=None, force=False):
    if not settings.LINDEPLOY_MIRROR_ENABLED:
        if job_id:
            try:
                job = MirrorPrewarmJob.objects.get(job_id=job_id)
                job.state = "skipped"
                job.error = "LinDeploy mirror is disabled."
                job.finished_at = timezone.now()
                job.save(update_fields=["state", "error", "finished_at", "updated_at"])
            except Exception:
                pass
        mark_mirror_prewarm_failed("LinDeploy mirror is disabled.")
        return {"status": "skipped", "message": "LinDeploy mirror is disabled."}
    if job_id is None:
        queued, created = queue_mirror_prewarm(force=force)
        if not created and queued.state != "queued":
            return {"status": "already_running", "job_id": str(queued.job_id)}
        job_id = queued.job_id
    job = _claim_job(job_id)
    if job is None:
        return {"status": "already_running", "job_id": str(job_id)}
    script_path = MIRROR_ROOT / "auto-prewarm.ps1"
    command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script_path), "-ServerIp", _mirror_server_host()]
    if force or job.result.get("force"):
        command.append("-Force")
    try:
        result = subprocess.run(
            command, cwd=MIRROR_ROOT, capture_output=True, text=True,
            timeout=settings.LINDEPLOY_MIRROR_PREWARM_TIMEOUT_SECONDS, check=False,
        )
        MIRROR_LOG_PATH.write_text(
            f"CORRELATION {job.correlation_id}\nSTDOUT\n{result.stdout}\n\nSTDERR\n{result.stderr}", encoding="utf-8"
        )
        if result.returncode != 0:
            raise RuntimeError(f"Automatic mirror prewarm failed. Review {MIRROR_LOG_PATH}. Return code: {result.returncode}.")
        job.state, job.progress = "verifying", 90
        job.save(update_fields=["state", "progress", "updated_at"])
        state = read_mirror_state()
        profile_ids = _persist_profiles(state, job)
        job.state, job.progress = "ready", 100
        job.result = {"profile_ids": profile_ids, "state": state}
        job.finished_at, job.owner_token, job.lease_expires_at = timezone.now(), None, None
        job.save()
        return {"status": "success", "job_id": str(job.job_id), "profile_ids": profile_ids, "state": state}
    except Exception as exc:
        mark_mirror_prewarm_failed(exc)
        job.state, job.error, job.finished_at = "failed", str(exc), timezone.now()
        job.owner_token, job.lease_expires_at = None, None
        job.save()
        raise
