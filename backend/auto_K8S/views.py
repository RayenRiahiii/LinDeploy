import time

from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response
from celery.result import AsyncResult

from backend.celery import app as celery_app
from .models import Credential, Host, Installation, InstallationTarget, InstallationTemplate
from .serializers import (
    CredentialSerializer,
    HostSerializer,
    InstallationSerializer,
    InstallationTemplateSerializer,
)
from .services import (
    build_inventory_file,
    detect_hosts_baseline,
    get_ansible_repo_root,
    normalize_host_overrides,
    request_installation_cancellation,
    run_connectivity_check,
    select_installation_template,
)
from .tasks import run_installation_task


def get_hosts_missing_credentials(hosts):
    return [
        {
            "id": host.id,
            "name": host.name,
            "ip_address": host.ip_address,
        }
        for host in hosts
        if not host.credential or not host.credential.username
    ]


def build_default_cluster_config(system_type):
    if system_type == InstallationTemplate.SystemType.K3S:
        return {
            "cluster_name": "k3s-cluster-01",
            "version": "stable",
            "topology_mode": "single_node",
            "pod_cidr": "10.42.0.0/16",
            "service_cidr": "10.43.0.0/16",
            "cluster_domain": "cluster.local",
            "control_plane_endpoint": "",
            "cni_plugin": "flannel",
            "disable_ingress": False,
        }

    return {
        "cluster_name": "kubernetes-cluster-01",
        "version": "stable",
        "topology_mode": "single_node",
        "pod_cidr": "192.168.0.0/16",
        "service_cidr": "10.96.0.0/12",
        "cluster_domain": "cluster.local",
        "control_plane_endpoint": "",
        "cni_plugin": "calico",
        "disable_ingress": False,
    }


def normalize_cluster_config(cluster_config, system_type, host_overrides):
    if cluster_config in (None, ""):
        cluster_config = {}

    if not isinstance(cluster_config, dict):
        raise ValueError("cluster_config must be an object.")

    merged = {
        **build_default_cluster_config(system_type),
        **cluster_config,
    }

    merged["cluster_name"] = str(merged.get("cluster_name") or build_default_cluster_config(system_type)["cluster_name"]).strip()
    merged["version"] = str(merged.get("version") or "stable").strip()
    merged["topology_mode"] = str(merged.get("topology_mode") or "single_node").strip()
    merged["pod_cidr"] = str(merged.get("pod_cidr") or "").strip()
    merged["service_cidr"] = str(merged.get("service_cidr") or "").strip()
    merged["cluster_domain"] = str(merged.get("cluster_domain") or "cluster.local").strip()
    merged["control_plane_endpoint"] = str(merged.get("control_plane_endpoint") or "").strip()
    merged["cni_plugin"] = str(merged.get("cni_plugin") or "").strip()
    merged["disable_ingress"] = bool(merged.get("disable_ingress"))

    control_plane_roles = {"control_plane", "server"}
    worker_roles = {"worker", "agent"}
    merged["control_plane_count"] = sum(1 for item in host_overrides if item["node_role"] in control_plane_roles)
    merged["worker_count"] = sum(1 for item in host_overrides if item["node_role"] in worker_roles)

    return merged


def annotate_host_overrides_with_detection(host_overrides, detections, system_type):
    if system_type != InstallationTemplate.SystemType.KUBERNETES:
        return host_overrides

    detections_by_id = {item["id"]: item for item in detections if item.get("id") is not None}
    annotated = []

    for item in host_overrides:
        detection = detections_by_id.get(item["host_id"])
        next_item = {
            **item,
            "execution_allowed": True,
            "validation_error": "",
            "baseline_state": detection["baseline_state"] if detection else "",
            "reachable": detection["reachable"] if detection else None,
        }

        if not detection:
            annotated.append(next_item)
            continue

        if not detection["reachable"]:
            next_item["execution_allowed"] = False
            next_item["validation_error"] = (
                "Baseline detection failed for this target. Fix SSH or network access, then retry."
            )
        elif detection["baseline_state"] == Host.BaselineState.INITIALIZED:
            next_item["execution_allowed"] = False
            next_item["validation_error"] = (
                "Kubernetes already appears initialized on this target. Run cleanup before reinstalling."
            )

        annotated.append(next_item)

    return annotated


def get_celery_progress(installation):
    if not installation.celery_task_id:
        return None

    try:
        result = AsyncResult(installation.celery_task_id, app=celery_app)
        payload = {
            "task_id": installation.celery_task_id,
            "state": result.state,
        }

        if isinstance(result.info, dict):
            payload["meta"] = result.info
        elif result.info:
            payload["meta"] = {"detail": str(result.info)}

        return payload
    except Exception as exc:
        return {
            "task_id": installation.celery_task_id,
            "state": "UNAVAILABLE",
            "meta": {"detail": str(exc)},
        }


@api_view(["GET", "POST"])
def hosts_list_create(request):
    if request.method == "GET":
        hosts = Host.objects.select_related("credential").all()
        serializer = HostSerializer(hosts, many=True)
        return Response(serializer.data)

    serializer = HostSerializer(data=request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=201)
    return Response(serializer.errors, status=400)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
def host_detail(request, id):
    host = get_object_or_404(Host.objects.select_related("credential"), id=id)

    if request.method == "GET":
        serializer = HostSerializer(host)
        return Response(serializer.data)

    if request.method == "PUT":
        serializer = HostSerializer(host, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=400)

    if request.method == "PATCH":
        serializer = HostSerializer(host, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=400)

    try:
        host.delete()
    except IntegrityError:
        return Response(
            {
                "message": "This host cannot be deleted because it is still referenced by related records."
            },
            status=409,
        )
    except Exception as exc:
        return Response(
            {"message": f"Unable to delete host cleanly: {exc}"},
            status=409,
        )

    return Response(status=204)


@api_view(["GET"])
def templates_list(request):
    system_type = (request.query_params.get("system_type") or "").strip().lower()
    templates = InstallationTemplate.objects.all().order_by("name")

    if system_type:
        templates = templates.filter(system_type=system_type)

    serializer = InstallationTemplateSerializer(templates, many=True)
    return Response(serializer.data)


@api_view(["GET"])
def installations_list(request):
    limit = min(int(request.query_params.get("limit", 20)), 100)
    installations = (
        Installation.objects.select_related("template")
        .prefetch_related("targets__host")
        .order_by("-created_at")[:limit]
    )
    serializer = InstallationSerializer(installations, many=True)
    return Response(serializer.data)


@api_view(["POST"])
def clear_installation_history(request):
    finished_statuses = (
        Installation.Status.SUCCESS,
        Installation.Status.PARTIAL_SUCCESS,
        Installation.Status.FAILED,
        Installation.Status.CANCELLED,
    )
    deleted_count = Installation.objects.filter(status__in=finished_statuses).count()
    Installation.objects.filter(status__in=finished_statuses).delete()
    return Response(
        {
            "message": f"Deleted {deleted_count} finished installation(s).",
            "deleted_count": deleted_count,
        },
        status=200,
    )


@api_view(["GET", "DELETE"])
def installation_detail(request, id):
    installation = get_object_or_404(
        Installation.objects.select_related("template").prefetch_related("targets__host"),
        id=id,
    )

    if request.method == "DELETE":
        if installation.status not in (
            Installation.Status.SUCCESS,
            Installation.Status.PARTIAL_SUCCESS,
            Installation.Status.FAILED,
            Installation.Status.CANCELLED,
        ):
            return Response(
                {"message": "Only finished installations can be deleted from history."},
                status=409,
            )

        installation.delete()
        return Response(status=204)

    serializer = InstallationSerializer(installation)
    response_data = serializer.data
    response_data["celery_progress"] = get_celery_progress(installation)
    return Response(response_data)


@api_view(["GET"])
def dashboard_summary(request):
    installations = Installation.objects.all()
    hosts = Host.objects.all()

    latest_installation = installations.order_by("-created_at").first()

    return Response(
        {
            "hosts": {
                "total": hosts.count(),
                "enabled": hosts.filter(enabled=True).count(),
                "control_plane": hosts.filter(node_role=Host.NodeRole.CONTROL_PLANE).count(),
                "worker": hosts.filter(node_role=Host.NodeRole.WORKER).count(),
                "unknown": hosts.filter(baseline_state=Host.BaselineState.UNKNOWN).count(),
                "fresh": hosts.filter(baseline_state=Host.BaselineState.FRESH).count(),
                "prepared": hosts.filter(baseline_state=Host.BaselineState.PREPARED).count(),
                "initialized": hosts.filter(baseline_state=Host.BaselineState.INITIALIZED).count(),
            },
            "credentials": {
                "total": Credential.objects.count(),
                "password": Credential.objects.filter(auth_type=Credential.AuthType.PASSWORD).count(),
                "ssh_key": Credential.objects.filter(auth_type=Credential.AuthType.SSH_KEY).count(),
            },
            "installations": {
                "total": installations.count(),
                "success": installations.filter(status=Installation.Status.SUCCESS).count(),
                "partial_success": installations.filter(status=Installation.Status.PARTIAL_SUCCESS).count(),
                "failed": installations.filter(status=Installation.Status.FAILED).count(),
                "cancelled": installations.filter(status=Installation.Status.CANCELLED).count(),
                "running": installations.filter(status=Installation.Status.RUNNING).count(),
                "pending": installations.filter(status=Installation.Status.PENDING).count(),
            },
            "latest_installation": InstallationSerializer(latest_installation).data
            if latest_installation
            else None,
        }
    )


@api_view(["POST"])
def detect_host_state(request, id):
    host = get_object_or_404(Host.objects.select_related("credential"), id=id, enabled=True)

    if not host.credential or not host.credential.username:
        return Response(
            {"message": "This host is missing credentials."},
            status=400,
        )

    detection_result = detect_hosts_baseline([host])
    detection = detection_result["detections"][0]

    response_status = 200 if detection["reachable"] else 400
    return Response(
        {
            "message": "Host state detection completed."
            if detection["reachable"]
            else "Host state detection failed.",
            "command": detection_result["command"],
            "timings": {"detection_seconds": detection_result["execution_seconds"]},
            "host": detection,
        },
        status=response_status,
    )


@api_view(["POST"])
def precheck_installation_hosts(request):
    request_started_at = time.perf_counter()
    host_ids = request.data.get("host_ids", [])
    host_overrides = request.data.get("host_overrides", [])

    if not host_ids:
        return Response({"message": "host_ids is required."}, status=400)

    hosts = list(Host.objects.filter(id__in=host_ids, enabled=True).select_related("credential"))

    if not hosts:
        return Response({"message": "No valid enabled hosts found."}, status=400)

    hosts_missing_credentials = get_hosts_missing_credentials(hosts)
    if hosts_missing_credentials:
        return Response(
            {
                "message": "Some selected hosts are missing credentials.",
                "hosts_missing_credentials": hosts_missing_credentials,
            },
            status=400,
        )

    system_type = (
        request.data.get("system_type")
        or InstallationTemplate.SystemType.KUBERNETES
    ).strip().lower()
    normalized_host_overrides = normalize_host_overrides(
        hosts,
        host_overrides,
        system_type,
    )
    inventory_path = build_inventory_file(hosts, host_overrides=normalized_host_overrides)
    inventory_content = inventory_path.read_text(encoding="utf-8")
    ansible_repo_root = get_ansible_repo_root()

    result, metadata = run_connectivity_check(
        repo_root=ansible_repo_root,
        inventory_path=inventory_path,
        expected_hosts=[host.name for host in hosts],
    )

    total_request_seconds = round(time.perf_counter() - request_started_at, 3)
    connectivity = metadata["connectivity"]
    reachable_hosts = [item for item in connectivity if item["status"] == "success"]
    unreachable_hosts = [item for item in connectivity if item["status"] != "success"]

    response_status = 200 if result.returncode == 0 else 400

    return Response(
        {
            "message": "SSH connectivity check completed."
            if result.returncode == 0
            else "SSH connectivity check failed for one or more hosts.",
            "command": metadata["command"],
            "repo_root": str(ansible_repo_root),
            "inventory_path": str(inventory_path),
            "inventory_content": inventory_content,
            "host_overrides": normalized_host_overrides,
            "timings": {
                "ssh_check_seconds": metadata["execution_seconds"],
                "total_request_seconds": total_request_seconds,
            },
            "summary": {
                "selected_hosts": len(hosts),
                "reachable_hosts": len(reachable_hosts),
                "failed_hosts": len(unreachable_hosts),
            },
            "connectivity": connectivity,
            "stdout": result.stdout,
            "stderr": result.stderr,
        },
        status=response_status,
    )


@api_view(["POST"])
def launch_installation(request):
    template_id = request.data.get("template_id")
    host_ids = request.data.get("host_ids", [])
    deployment_mode = request.data.get("deployment_mode", "auto")
    system_type = (request.data.get("system_type") or InstallationTemplate.SystemType.KUBERNETES).strip().lower()
    cluster_config = request.data.get("cluster_config", {})
    host_overrides = request.data.get("host_overrides", [])

    if not host_ids:
        return Response({"message": "host_ids is required."}, status=400)

    hosts = list(Host.objects.filter(id__in=host_ids, enabled=True).select_related("credential"))

    if not hosts:
        return Response({"message": "No valid enabled hosts found."}, status=400)

    hosts_missing_credentials = get_hosts_missing_credentials(hosts)
    if hosts_missing_credentials:
        return Response(
            {
                "message": "Some selected hosts are missing credentials.",
                "hosts_missing_credentials": hosts_missing_credentials,
            },
            status=400,
        )

    normalized_host_overrides = normalize_host_overrides(
        hosts,
        host_overrides,
        system_type,
    )

    try:
        normalized_cluster_config = normalize_cluster_config(
            cluster_config,
            system_type,
            normalized_host_overrides,
        )
    except ValueError as exc:
        return Response({"message": str(exc)}, status=400)

    try:
        selection = select_installation_template(
            hosts,
            deployment_mode=deployment_mode,
            template_id=template_id,
            system_type=system_type,
        )
    except InstallationTemplate.DoesNotExist:
        return Response(
            {"message": "Required installation template was not found."},
            status=400,
        )
    except ValueError as exc:
        return Response({"message": str(exc)}, status=400)

    template = selection["template"]
    normalized_host_overrides = annotate_host_overrides_with_detection(
        normalized_host_overrides,
        selection.get("detections", []),
        system_type,
    )

    excluded_targets = [
        item for item in normalized_host_overrides if not item.get("execution_allowed", True)
    ]
    queued_message = f"Installation queued successfully using {template.playbook_path}."
    if excluded_targets:
        queued_message = (
            f"Installation queued using {template.playbook_path}. "
            f"{len(excluded_targets)} target(s) were excluded before execution."
        )

    installation = Installation.objects.create(
        template=template,
        status=Installation.Status.PENDING,
        phase=Installation.Phase.QUEUED,
        progress=0,
        summary_message=queued_message,
        cluster_config=normalized_cluster_config,
        host_overrides=normalized_host_overrides,
    )

    for host in hosts:
        InstallationTarget.objects.create(
            installation=installation,
            host=host,
            status=InstallationTarget.Status.PENDING,
        )

    celery_result = run_installation_task.delay(installation.id)
    installation.celery_task_id = celery_result.id
    installation.save(update_fields=["celery_task_id", "updated_at"])

    return Response(
        {
            "installation_id": installation.id,
            "celery_task_id": celery_result.id,
            "status": installation.status,
            "phase": installation.phase,
            "progress": installation.progress,
            "message": installation.summary_message,
            "cluster_config": installation.cluster_config,
            "host_overrides": installation.host_overrides,
            "selected_strategy": selection["strategy"],
            "selected_playbook": template.playbook_path,
            "detected_hosts": selection.get("detections", []),
            "eligible_host_names": selection.get("eligible_host_names", []),
            "detection_command": selection.get("detection_command"),
            "detection_seconds": selection.get("detection_seconds"),
        },
        status=202,
    )


@api_view(["POST"])
def cancel_installation(request, id):
    installation = get_object_or_404(
        Installation.objects.select_related("template").prefetch_related("targets__host"),
        id=id,
    )

    if installation.status in (
        Installation.Status.SUCCESS,
        Installation.Status.PARTIAL_SUCCESS,
        Installation.Status.FAILED,
        Installation.Status.CANCELLED,
    ):
        serializer = InstallationSerializer(installation)
        response_data = serializer.data
        response_data["celery_progress"] = get_celery_progress(installation)
        return Response(
            {
                "message": "Installation is already finished.",
                "installation": response_data,
            },
            status=200,
        )

    request_installation_cancellation(installation)
    installation.refresh_from_db()
    serializer = InstallationSerializer(installation)
    response_data = serializer.data
    response_data["celery_progress"] = get_celery_progress(installation)

    return Response(
        {
            "message": installation.summary_message,
            "installation": response_data,
        },
        status=200,
    )


@api_view(["GET", "POST"])
def credentials_list(request):
    if request.method == "GET":
        credentials = Credential.objects.all().order_by("name")
        serializer = CredentialSerializer(credentials, many=True)
        return Response(serializer.data, status=200)

    serializer = CredentialSerializer(data=request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=201)
    return Response(serializer.errors, status=400)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
def credential_detail(request, id):
    credential = get_object_or_404(Credential, id=id)

    if request.method == "GET":
        serializer = CredentialSerializer(credential)
        return Response(serializer.data, status=200)

    if request.method == "PUT":
        serializer = CredentialSerializer(credential, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=200)
        return Response(serializer.errors, status=400)

    if request.method == "PATCH":
        serializer = CredentialSerializer(credential, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=200)
        return Response(serializer.errors, status=400)

    try:
        credential.delete()
    except IntegrityError:
        return Response(
            {
                "message": "This credential cannot be deleted because it is still referenced by related records."
            },
            status=409,
        )
    except Exception as exc:
        return Response(
            {"message": f"Unable to delete credential cleanly: {exc}"},
            status=409,
        )

    return Response(status=204)
