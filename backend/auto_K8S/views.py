import ipaddress
import time

from django.conf import settings
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response
from celery.result import AsyncResult

from backend.celery import app as celery_app
from .models import Credential, Host, Installation, InstallationTarget, InstallationTemplate
from .openshift_secrets import (
    OpenShiftSecretError,
    create_secret_bundle,
    validate_secret_reference,
)
from .serializers import (
    CredentialSerializer,
    HostSerializer,
    InstallationLaunchSerializer,
    InstallationSerializer,
    InstallationTemplateSerializer,
    OpenShiftRetrySerializer,
    OpenShiftSecretBundleSerializer,
)
from .services import (
    build_inventory_file,
    detect_hosts_baseline,
    get_ansible_repo_root,
    normalize_host_overrides,
    normalize_cluster_name,
    redact_inventory_secrets,
    read_live_output_lines,
    request_installation_cancellation,
    run_connectivity_check,
    select_installation_template,
)
from .mirror import mirror_status_payload, queue_mirror_prewarm, read_mirror_state
from .tasks import run_installation_task, run_mirror_prewarm_task


@api_view(["POST"])
def create_openshift_secret_bundle(request):
    serializer = OpenShiftSecretBundleSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    if not settings.OPENSHIFT_MIRROR_PASSWORD:
        return Response(
            {"message": "The server-managed OpenShift mirror password is not configured."},
            status=503,
        )
    secret_data = {
        **serializer.validated_data,
        "mirror_username": settings.OPENSHIFT_MIRROR_USERNAME,
        "mirror_password": settings.OPENSHIFT_MIRROR_PASSWORD,
        "mirror_ca_bundle": "",
    }
    bundle = create_secret_bundle(secret_data)
    return Response(
        {
            "secret_reference": str(bundle.reference),
            "expires_at": bundle.expires_at.isoformat(),
        },
        status=201,
    )


@api_view(["GET"])
def openshift_configuration(request):
    return Response(
        {
            "mirror_configured": bool(
                settings.OPENSHIFT_MIRROR_REGISTRY
                and settings.OPENSHIFT_MIRROR_VERSION == "4.20.3"
                and settings.OPENSHIFT_MIRROR_USERNAME
                and settings.OPENSHIFT_MIRROR_PASSWORD
            ),
            "mirror_registry": settings.OPENSHIFT_MIRROR_REGISTRY,
            "openshift_version": settings.OPENSHIFT_MIRROR_VERSION,
        },
        status=200,
    )


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


def cancel_stale_pre_execution_installations(host_ids):
    cutoff = timezone.now() - timezone.timedelta(
        seconds=settings.INSTALLATION_PRE_EXECUTION_STALE_SECONDS
    )
    stale_installations = (
        Installation.objects.filter(
            targets__host_id__in=host_ids,
            status__in=(Installation.Status.PENDING, Installation.Status.RUNNING),
            phase__in=(Installation.Phase.QUEUED, Installation.Phase.SSH_CHECK),
            runner_pid__isnull=True,
            updated_at__lt=cutoff,
        )
        .distinct()
    )

    for installation in stale_installations:
        request_installation_cancellation(installation)
        installation.summary_message = (
            "Execution automatically cancelled because it stopped reporting "
            "progress before Ansible started. The selected hosts were released."
        )
        installation.save(update_fields=["summary_message", "updated_at"])


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


def build_cleanup_confirmation(hosts, cluster_name):
    stable_ids = sorted(str(host.stable_id) for host in hosts)
    return f"CLEAN {cluster_name} ON " + ",".join(stable_ids)


def normalize_cluster_config(cluster_config, system_type, host_overrides, topology=None):
    if cluster_config in (None, ""):
        cluster_config = {}

    if not isinstance(cluster_config, dict):
        raise ValueError("cluster_config must be an object.")

    cluster_name_explicit = bool(str(cluster_config.get("cluster_name") or "").strip())
    merged = {
        **build_default_cluster_config(system_type),
        **cluster_config,
    }

    merged["cluster_name"] = normalize_cluster_name(
        merged.get("cluster_name"),
        fallback=build_default_cluster_config(system_type)["cluster_name"],
    )
    merged["cluster_name_explicit"] = cluster_name_explicit
    merged["version"] = str(merged.get("version") or "stable").strip()
    merged["topology_mode"] = (
        topology or str(merged.get("topology_mode") or Installation.Topology.SINGLE_NODE).strip()
    )
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
            payload["meta"] = {**result.info}
        elif result.info:
            payload["meta"] = {"detail": str(result.info)}

        live_output = read_live_output_lines(installation.id)
        if not live_output and installation.status not in {
            Installation.Status.PENDING,
            Installation.Status.RUNNING,
        }:
            timestamp = (
                installation.finished_at.isoformat()
                if installation.finished_at
                else installation.updated_at.isoformat()
            )
            fallback_lines = [
                {
                    "channel": channel,
                    "line": line,
                    "timestamp": timestamp,
                }
                for channel, content in (
                    ("stdout", installation.stdout),
                    ("stderr", installation.stderr),
                )
                for line in (content or "").splitlines()
            ]
            live_output = fallback_lines[-5000:]
        if live_output:
            payload.setdefault("meta", {})["output_lines"] = live_output

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


@api_view(["GET"])
def mirror_status(request):
    return Response(mirror_status_payload())


@api_view(["POST"])
def prewarm_mirror(request):
    if not settings.LINDEPLOY_MIRROR_ENABLED:
        return Response(
            {
                "message": (
                    "The LinDeploy mirror is disabled. Configure and start the "
                    "mirror before requesting a prewarm."
                )
            },
            status=409,
        )

    force = request.data.get("force", False)
    if not isinstance(force, bool):
        return Response({"message": "force must be a boolean."}, status=400)

    job, created = queue_mirror_prewarm(force=force)
    if created:
        task = run_mirror_prewarm_task.delay(job_id=str(job.job_id), force=force)
        job.celery_task_id = task.id
        job.save(update_fields=["celery_task_id", "updated_at"])
    return Response(
        {
            "message": "Mirror prewarm queued." if created else "An equivalent mirror prewarm is already active.",
            "task_id": job.celery_task_id,
            "job_id": str(job.job_id),
            "deduplicated": not created,
            "state": read_mirror_state(),
        },
        status=202,
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
    inventory_content = redact_inventory_secrets(
        inventory_path.read_text(encoding="utf-8")
    )
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
    request_serializer = InstallationLaunchSerializer(data=request.data)
    if not request_serializer.is_valid():
        return Response(
            {
                "message": "The installation request is invalid.",
                "errors": request_serializer.errors,
            },
            status=400,
        )

    request_data = request_serializer.validated_data
    template_id = request_data.get("template_id")
    host_ids = request_data["host_ids"]
    deployment_mode = request_data["deployment_mode"]
    system_type = request_data["system_type"]
    topology = request_data["topology"]
    cluster_config = request_data["cluster_config"]
    host_overrides = request_data["host_overrides"]
    control_plane_host_ids = request_data["control_plane_host_ids"]
    worker_host_ids = request_data["worker_host_ids"]
    bootstrap_host_id = request_data.get("bootstrap_host_id")

    if system_type == InstallationTemplate.SystemType.OPENSHIFT_SNO:
        requested_template = None
        if template_id:
            requested_template = InstallationTemplate.objects.filter(
                id=template_id,
                system_type=InstallationTemplate.SystemType.OPENSHIFT_SNO,
            ).first()
        if requested_template is None:
            return Response(
                {"message": "The requested OpenShift workflow is not registered."},
                status=400,
            )
        playbook_path = requested_template.playbook_path
        is_disconnected_install = playbook_path == "playbooks/openshift_sno_disconnected.yml"
        is_cleanup = playbook_path == "playbooks/openshift_sno_cleanup.yml"

        if not any((is_disconnected_install, is_cleanup)):
            return Response(
                {"message": "Only the managed disconnected OpenShift SNO workflow is supported."},
                status=400,
            )

        if deployment_mode != "manual" or not template_id:
            return Response(
                {"message": "OpenShift SNO requires a registered manual template."},
                status=400,
            )
        if topology != Installation.Topology.SINGLE_NODE or len(host_ids) != 1:
            return Response(
                {"message": "OpenShift SNO requires exactly one KVM provisioning host."},
                status=400,
            )
        disconnected = bool(cluster_config.get("disconnected"))
        if is_disconnected_install and not disconnected:
            return Response(
                {"message": "This OpenShift workflow requires disconnected mode."},
                status=400,
            )
        if is_disconnected_install:
            if settings.OPENSHIFT_MIRROR_VERSION != "4.20.3" or not settings.OPENSHIFT_MIRROR_PASSWORD:
                return Response(
                    {"message": "The managed OpenShift 4.20.3 mirror is not configured on the server."},
                    status=503,
                )
            cluster_config.update(
                {
                    "disconnected": True,
                    "openshift_version": "4.20.3",
                    "mirror_registry": settings.OPENSHIFT_MIRROR_REGISTRY,
                    "mirror_storage_path": settings.OPENSHIFT_MIRROR_STORAGE_PATH,
                    "mirror_registry_archive_path": "",
                    "mirror_registry_archive_url": "",
                    "mirror_registry_archive_checksum": "",
                    "mirror_include_graph": False,
                }
            )
        if not is_cleanup:
            try:
                machine_network = ipaddress.ip_network(
                    cluster_config.get("machine_network_cidr", ""), strict=True
                )
                node_address = ipaddress.ip_address(
                    (host_overrides[0] if host_overrides else {}).get("node_ip", "")
                )
                rendezvous_address = ipaddress.ip_address(
                    cluster_config.get("rendezvous_ip", "")
                )
            except ValueError:
                return Response(
                    {"message": "OpenShift machine network, node IP, or rendezvous IP is invalid."},
                    status=400,
                )
            if (
                node_address not in machine_network.hosts()
                or rendezvous_address not in machine_network.hosts()
            ):
                return Response(
                    {
                        "message": (
                            "OpenShift node and rendezvous IPs must be usable host "
                            "addresses, not the network or broadcast address."
                        )
                    },
                    status=400,
                )
        if not is_cleanup:
            secret_reference = cluster_config.get("secret_reference")
            try:
                validate_secret_reference(secret_reference)
            except OpenShiftSecretError as exc:
                return Response({"message": str(exc)}, status=400)
        if not is_cleanup:
            requested_disk = str((host_overrides[0] if host_overrides else {}).get("installation_disk") or "")
            if (
                not cluster_config.get("target_modification_approved")
                or cluster_config.get("install_confirmation") != f"ERASE {requested_disk}"
            ):
                return Response(
                    {"message": f"Confirm the destructive target by entering ERASE {requested_disk}."},
                    status=400,
                )

    selected_hosts = Host.objects.filter(id__in=host_ids).select_related("credential")
    hosts_by_id = {host.id: host for host in selected_hosts}
    missing_host_ids = [host_id for host_id in host_ids if host_id not in hosts_by_id]
    disabled_host_ids = [
        host_id for host_id in host_ids if host_id in hosts_by_id and not hosts_by_id[host_id].enabled
    ]
    if missing_host_ids or disabled_host_ids:
        return Response(
            {
                "message": "Some selected hosts cannot be used for installation.",
                "errors": {
                    "missing_host_ids": missing_host_ids,
                    "disabled_host_ids": disabled_host_ids,
                },
            },
            status=400,
        )

    hosts = [hosts_by_id[host_id] for host_id in host_ids]

    cancel_stale_pre_execution_installations(host_ids)

    busy_targets = InstallationTarget.objects.filter(
        host_id__in=host_ids,
        installation__status__in=(
            Installation.Status.PENDING,
            Installation.Status.RUNNING,
        ),
    ).select_related("host", "installation")
    busy_hosts = [
        {
            "host_id": target.host_id,
            "host_name": target.host.name,
            "installation_id": target.installation_id,
            "installation_status": target.installation.status,
        }
        for target in busy_targets
    ]
    if busy_hosts:
        return Response(
            {
                "message": "Some selected hosts are already used by an active execution.",
                "errors": {"busy_hosts": busy_hosts},
            },
            status=409,
        )

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

    if topology == Installation.Topology.MULTI_NODE:
        node_names = [item["node_name"] for item in normalized_host_overrides]
        duplicate_node_names = sorted(
            {node_name for node_name in node_names if node_names.count(node_name) > 1}
        )
        if duplicate_node_names:
            return Response(
                {
                    "message": "Each node in a multi-node cluster must have a unique node name.",
                    "errors": {
                        "host_overrides": (
                            "Duplicate node names after DNS normalization: "
                            f"{', '.join(duplicate_node_names)}."
                        )
                    },
                },
                status=400,
            )

    control_plane_ids = set(control_plane_host_ids)
    worker_ids = set(worker_host_ids)
    if topology == Installation.Topology.MULTI_NODE:
        ansible_control_plane_role = (
            "server" if system_type == InstallationTemplate.SystemType.K3S else "control_plane"
        )
        ansible_worker_role = (
            "agent" if system_type == InstallationTemplate.SystemType.K3S else "worker"
        )
        normalized_host_overrides = [
            {
                **item,
                "node_role": (
                    ansible_control_plane_role
                    if item["host_id"] in control_plane_ids
                    else ansible_worker_role
                ),
            }
            for item in normalized_host_overrides
        ]

    bootstrap_host = hosts_by_id.get(bootstrap_host_id) if bootstrap_host_id else None
    if topology == Installation.Topology.MULTI_NODE and not cluster_config.get(
        "control_plane_endpoint"
    ):
        cluster_config = {
            **cluster_config,
            "control_plane_endpoint": f"{bootstrap_host.ip_address}:6443",
        }

    try:
        normalized_cluster_config = normalize_cluster_config(
            cluster_config,
            system_type,
            normalized_host_overrides,
            topology=topology,
        )
    except ValueError as exc:
        return Response({"message": str(exc)}, status=400)

    if topology == Installation.Topology.MULTI_NODE:
        normalized_host_overrides = [
            {**item, "cluster_name": normalized_cluster_config["cluster_name"]}
            for item in normalized_host_overrides
        ]

    try:
        selection = select_installation_template(
            hosts,
            deployment_mode=deployment_mode,
            template_id=template_id,
            system_type=system_type,
            topology=topology,
        )
    except InstallationTemplate.DoesNotExist:
        return Response(
            {"message": "Required installation template was not found."},
            status=400,
        )
    except ValueError as exc:
        return Response({"message": str(exc)}, status=400)

    template = selection["template"]
    if (
        template.deployment_type == InstallationTemplate.DeploymentType.CLEANUP
        and system_type
        in {
            InstallationTemplate.SystemType.KUBERNETES,
            InstallationTemplate.SystemType.K3S,
        }
    ):
        expected_confirmation = build_cleanup_confirmation(
            hosts, normalized_cluster_config["cluster_name"]
        )
        if (
            not normalized_cluster_config.get("target_modification_approved")
            or normalized_cluster_config.get("cleanup_confirmation")
            != expected_confirmation
        ):
            return Response(
                {
                    "message": (
                        "Cleanup requires explicit cluster- and target-bound approval. "
                        "Enter the confirmation exactly as displayed before retrying."
                    ),
                    "errors": {
                        "cleanup_confirmation": (
                            "The cleanup confirmation does not match the selected cluster and targets."
                        ),
                        "expected_confirmation": expected_confirmation,
                    },
                },
                status=400,
            )
        normalized_cluster_config["cleanup_expected_confirmation"] = expected_confirmation
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

    overrides_by_host_id = {
        item["host_id"]: item for item in normalized_host_overrides
    }
    with transaction.atomic():
        installation = Installation.objects.create(
            template=template,
            topology=topology,
            cluster_name=normalized_cluster_config["cluster_name"],
            control_plane_endpoint=normalized_cluster_config["control_plane_endpoint"],
            bootstrap_host=bootstrap_host,
            status=Installation.Status.PENDING,
            phase=Installation.Phase.QUEUED,
            progress=0,
            summary_message=queued_message,
            cluster_config=normalized_cluster_config,
            host_overrides=normalized_host_overrides,
        )

        for host in hosts:
            is_multi_node = topology == Installation.Topology.MULTI_NODE
            is_bootstrap = not is_multi_node or host.id == bootstrap_host_id
            desired_role = (
                InstallationTarget.DesiredRole.WORKER
                if is_multi_node and host.id in worker_ids
                else InstallationTarget.DesiredRole.CONTROL_PLANE
            )
            InstallationTarget.objects.create(
                installation=installation,
                host=host,
                status=InstallationTarget.Status.PENDING,
                desired_role=desired_role,
                is_bootstrap=is_bootstrap,
                join_status=(
                    InstallationTarget.JoinStatus.NOT_STARTED
                    if is_multi_node and not is_bootstrap
                    else InstallationTarget.JoinStatus.NOT_APPLICABLE
                ),
                node_name=overrides_by_host_id[host.id]["node_name"],
                cluster_name=overrides_by_host_id[host.id]["cluster_name"],
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
            "topology": installation.topology,
            "cluster_name": installation.cluster_name,
            "control_plane_endpoint": installation.control_plane_endpoint,
            "bootstrap_host_id": installation.bootstrap_host_id,
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
def retry_openshift_installation(request, id):
    source = get_object_or_404(
        Installation.objects.select_related("template", "bootstrap_host").prefetch_related(
            "targets__host__credential"
        ),
        id=id,
    )
    if source.template.system_type != InstallationTemplate.SystemType.OPENSHIFT_SNO:
        return Response(
            {"message": "This retry endpoint is only available for OpenShift SNO."},
            status=400,
        )
    if source.status != Installation.Status.FAILED:
        return Response(
            {"message": "Only a failed OpenShift SNO installation can be restarted."},
            status=409,
        )
    source_playbook = source.template.playbook_path
    if (
        source_playbook == "playbooks/openshift_sno.yml"
        and not settings.OPENSHIFT_RED_HAT_OFFLINE_TOKEN
    ):
        return Response(
            {"message": "The controller is missing OPENSHIFT_RED_HAT_OFFLINE_TOKEN."},
            status=503,
        )

    serializer = OpenShiftRetrySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    secret_reference = serializer.validated_data["secret_reference"]
    try:
        validate_secret_reference(secret_reference)
    except OpenShiftSecretError as exc:
        return Response({"message": str(exc)}, status=400)

    source_targets = list(source.targets.select_related("host", "host__credential"))
    if not source_targets:
        return Response({"message": "The failed installation has no target to restart."}, status=400)

    unavailable_hosts = [
        target.host.name
        for target in source_targets
        if not target.host.enabled or target.host.credential_id is None
    ]
    if unavailable_hosts:
        return Response(
            {
                "message": (
                    "The original target is disabled or missing SSH credentials: "
                    + ", ".join(unavailable_hosts)
                )
            },
            status=409,
        )

    host_ids = [target.host_id for target in source_targets]
    busy_targets = InstallationTarget.objects.filter(
        host_id__in=host_ids,
        installation__status__in=(Installation.Status.PENDING, Installation.Status.RUNNING),
    ).exclude(installation=source)
    if busy_targets.exists():
        return Response(
            {"message": "The original target is already used by another active execution."},
            status=409,
        )

    cluster_config = {
        **(source.cluster_config or {}),
        "secret_reference": str(secret_reference),
    }
    host_overrides = [dict(item) for item in (source.host_overrides or [])]
    requested_disk = str((host_overrides[0] if host_overrides else {}).get("installation_disk") or "")
    requires_disk_confirmation = source_playbook not in {
        "playbooks/openshift_mirror_prepare.yml",
        "playbooks/openshift_sno_cleanup.yml",
    }
    if requires_disk_confirmation and (
        not cluster_config.get("target_modification_approved")
        or cluster_config.get("install_confirmation") != f"ERASE {requested_disk}"
    ):
        return Response(
            {"message": f"The original execution does not contain approval for ERASE {requested_disk}."},
            status=400,
        )

    with transaction.atomic():
        restarted = Installation.objects.create(
            template=source.template,
            topology=source.topology,
            cluster_name=source.cluster_name,
            control_plane_endpoint=source.control_plane_endpoint,
            bootstrap_host=source.bootstrap_host,
            status=Installation.Status.PENDING,
            phase=Installation.Phase.QUEUED,
            progress=0,
            summary_message=f"Restarted from failed OpenShift execution #{source.id}.",
            cluster_config=cluster_config,
            host_overrides=host_overrides,
        )
        for target in source_targets:
            InstallationTarget.objects.create(
                installation=restarted,
                host=target.host,
                status=InstallationTarget.Status.PENDING,
                desired_role=target.desired_role,
                is_bootstrap=target.is_bootstrap,
                join_status=InstallationTarget.JoinStatus.NOT_STARTED
                if target.join_status != InstallationTarget.JoinStatus.NOT_APPLICABLE
                else InstallationTarget.JoinStatus.NOT_APPLICABLE,
                node_name=target.node_name,
                cluster_name=target.cluster_name,
            )

    celery_result = run_installation_task.delay(restarted.id)
    restarted.celery_task_id = celery_result.id
    restarted.save(update_fields=["celery_task_id", "updated_at"])

    return Response(
        {
            "installation_id": restarted.id,
            "retried_installation_id": source.id,
            "celery_task_id": celery_result.id,
            "status": restarted.status,
            "phase": restarted.phase,
            "progress": restarted.progress,
            "message": restarted.summary_message,
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
