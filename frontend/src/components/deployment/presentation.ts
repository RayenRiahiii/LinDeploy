import {
  type CleanupMode,
  type CleanupTemplateMap,
  type ClusterConfig,
  type ConnectivityStatus,
  type Host,
  type HostOverrideForm,
  type InstallationDetailResponse,
  type InstallationTarget,
  type LaunchResult,
  type PrecheckResult,
  type Template,
} from "./types";
import { type InstallerId } from "../../features/installers/catalog";
import {
  type ExecutionStage,
  formatPhaseLabel as formatExecutionPhaseLabel,
} from "../../features/executions/presentation";

export const stageMap: ExecutionStage[] = [
  {
    phase: "queued",
    label: "Queued for execution",
    detail: "The request is stored and waiting for the worker to start the installation task.",
  },
  {
    phase: "ssh_check",
    label: "Verifying SSH connectivity",
    detail: "The backend is building inventory and validating access to each selected machine.",
  },
  {
    phase: "running_playbook",
    label: "Running Ansible playbook",
    detail: "Node preparation, runtime configuration, and cluster bootstrap tasks are currently executing.",
  },
  {
    phase: "finalizing",
    label: "Finalizing result",
    detail: "The backend is collecting logs, timings, and final Ansible status.",
  },
  {
    phase: "completed",
    label: "Completed",
    detail: "The installation finished successfully and the final output is stored.",
  },
  {
    phase: "failed",
    label: "Failed",
    detail: "The installation stopped with an error. Inspect the captured output below.",
  },
  {
    phase: "cancelled",
    label: "Cancelled",
    detail: "The installation was stopped by the user before completion.",
  },
];

export const pipelineStageMap: ExecutionStage[] = stageMap.filter(
  (stage) => stage.phase !== "failed" && stage.phase !== "cancelled"
);

export function formatPhaseLabel(phase?: string) {
  return formatExecutionPhaseLabel(stageMap, phase);
}


export function formatHistoryDate(value?: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

export function getLiveExecutionHeading(
  executionKind: "install" | "cleanup",
  deploymentType?: string,
  templateName?: string
): string {
  if (executionKind === "cleanup" || deploymentType === "cleanup") {
    const normalizedName = (templateName || "").toLowerCase();

    if (normalizedName.includes("reset")) {
      return "Reset in Progress";
    }

    return "Cleanup in Progress";
  }

  return "Installation in Progress";
}

export function getExecutionPresentation(
  status?: string | null,
  isCleanupExecution?: boolean,
  installerLabel?: string
) {
  if (isCleanupExecution && status === "failed") {
    return {
      title: "Cleanup failed",
      summary: "The cleanup workflow stopped before the selected target state was fully removed.",
      recommendation: "Review each affected host below, correct the reported issue, then retry cleanup only on those targets.",
    };
  }

  if (isCleanupExecution && status === "partial_success") {
    return {
      title: "Cleanup completed with issues",
      summary: "Cleanup succeeded on at least one target, but other machines still require attention.",
      recommendation: "Validate cleaned hosts and retry only the targets that remain in a failed state.",
    };
  }

  if (isCleanupExecution) {
    return {
      title: "Cleanup completed successfully",
      summary:
        "The cleanup workflow finished successfully and the selected target state was removed without blocking errors.",
      recommendation:
        "Run the post-cleanup checks on the processed hosts to confirm that cluster state and runtime artifacts were removed as expected.",
    };
  }

  if (status === "partial_success") {
    return {
      title: "Installation completed with partial success",
      summary:
        "At least one selected target completed successfully, but one or more hosts still require operator intervention.",
      recommendation:
        "Review the failed hosts first, correct the reported issue, then retry only the affected targets.",
    };
  }

  if (status === "failed") {
    return {
      title: "Installation failed",
      summary:
        "The workflow did not reach a successful final state on the selected targets.",
      recommendation:
        "Use the host-level output below to identify the root cause before retrying.",
    };
  }

  return {
    title: "Installation completed successfully",
    summary: `${installerLabel || "The selected installer"} completed successfully and the target nodes should now be ready for validation.`,
    recommendation:
      "Run the validation commands on each successful host, then proceed with workload onboarding.",
  };
}

export function getFailureStage(message?: string): string {
  const normalized = (message || "").toLowerCase();
  if (normalized.includes("baseline detection")) return "Target eligibility check";
  if (normalized.includes("ssh") || normalized.includes("unreachable")) return "SSH connectivity";
  if (normalized.includes("cleanup")) return "Cleanup launch";
  if (normalized.includes("inventory")) return "Inventory generation";
  if (normalized.includes("bootstrap") || normalized.includes("rendezvous") || normalized.includes("agent_install")) return "OpenShift Agent bootstrap";
  if (normalized.includes("target_boot") || normalized.includes("discovery iso") || normalized.includes("running vm")) return "Target VM Boot";
  if (normalized.includes("mirror") || normalized.includes("dns") || normalized.includes("preflight")) return "Preflight verification";
  return "Playbook launch or execution";
}

export function getPrecheckPresentation(precheck?: PrecheckResult | null) {
  const failedHosts = precheck?.summary?.failed_hosts ?? 0;

  if (failedHosts === 0) {
    return {
      title: "SSH verification completed successfully",
      summary:
        "All selected targets accepted the SSH validation and are ready for playbook execution.",
      recommendation:
        "You can start the installation now. Keep this report for traceability if needed.",
      color: "teal" as const,
    };
  }

  return {
    title: "SSH verification completed with issues",
    summary:
      "At least one selected target failed the SSH validation. Healthy hosts are still identified below.",
    recommendation:
      "Correct SSH access, privilege escalation, or network reachability on the failing hosts before retrying them.",
    color: "yellow" as const,
  };
}

export function getConnectivityOperatorAction(item: ConnectivityStatus): string {
  if (item.status === "success") {
    return "This host is ready for playbook execution.";
  }

  if (item.status === "unreachable") {
    return "Check network reachability, host address, and SSH service availability before retrying.";
  }

  return "Check credentials, sudo configuration, and remote access policy before retrying.";
}

export function getTargetOperatorAction(target: InstallationTarget): string {
  if (target.status === "success") {
    return "Run the validation checks on this host and confirm cluster health.";
  }

  if (target.operator_issue?.recommended_action) {
    return target.operator_issue.recommended_action;
  }

  if (target.status === "failed" || target.status === "unreachable") {
    const diagnostics = `${target.output || ""} ${target.stderr || ""}`.toLowerCase();
    if (diagnostics.includes("baseline detection")) {
      return "Verify SSH access, sudo privileges, the detected operating system, and conflicting cluster artifacts, then retry this host.";
    }
    return "Review the captured output, correct the underlying issue, then retry this host only.";
  }

  return "Review the captured output for this host before deciding on the next action.";
}

export function isInstallationActive(installation?: InstallationDetailResponse | null): boolean {
  return installation?.status === "pending" || installation?.status === "running";
}

export function buildResultFromInstallation(installation: InstallationDetailResponse): LaunchResult {
  const combinedOutputs = installation.targets
    .map((target) => {
      if (target.output) {
        return `[${target.host_name}] ${target.output}`;
      }

      return `[${target.host_name}] No output captured.`;
    })
    .join("\n\n");

  return {
    installation_id: installation.id,
    status: installation.status,
    message:
      installation.summary_message ||
      (installation.status === "success"
        ? "Playbook executed successfully."
        : installation.status === "partial_success"
          ? "Playbook completed with issues on one or more targets."
        : installation.status === "cancelled"
          ? "Installation cancelled by user."
          : "Playbook execution failed."),
    template_name: installation.template_name,
    template_system_type: installation.template_system_type,
    deployment_type: installation.deployment_type,
    topology: installation.topology,
    target_hosts: installation.targets.map((target) => target.host_name),
    target_host_ids: installation.targets.map((target) => target.host),
    command: installation.command,
    stdout: installation.stdout || "",
    stderr: installation.stderr || "",
    rawOutput: combinedOutputs,
    return_code: installation.return_code,
    timings: installation.timings,
    task_profile: installation.task_profile,
    bottleneck_hints: installation.bottleneck_hints,
    connectivity: installation.connectivity,
    duration_seconds: installation.duration_seconds,
    cluster_config: installation.cluster_config,
    host_overrides: installation.host_overrides,
    targets: installation.targets,
  };
}

export function getTargetStatusSummary(targets: InstallationTarget[]): Record<string, number> {
  return targets.reduce(
    (acc, target) => {
      acc[target.status] = (acc[target.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

export function extractTargetDiagnostics(target: InstallationTarget): string {
  const sources = [target.output, target.stderr, target.stdout].filter(Boolean) as string[];
  const relevantLines: string[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const rawLine of source.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const matchesTarget =
        line.includes(`[${target.host_name}]`) ||
        line.startsWith(`${target.host_name} |`) ||
        line.startsWith(`fatal: [${target.host_name}]`) ||
        line.includes(`${target.host_name}:`) ||
        line.includes(`-${target.host_name}`) ||
        line.includes(` ${target.host_name} `);

      if (!matchesTarget) {
        continue;
      }

      if (!seen.has(line)) {
        seen.add(line);
        relevantLines.push(line);
      }
    }
  }

  if (relevantLines.length > 0) {
    return relevantLines.join("\n");
  }

  return target.output || target.stderr || target.stdout || "No target-specific playbook output was captured.";
}

export function getCleanupMode(template: Template): CleanupMode {
  if (template.system_type === "k3s" && template.deployment_type === "cleanup") {
    return "full_uninstall";
  }

  const normalizedName = template.name.toLowerCase();
  const normalizedPath = template.playbook_path.toLowerCase();

  if (
    normalizedName.includes("full-uninstall") ||
    normalizedName.includes("full uninstall") ||
    normalizedPath.includes("full_uninstall")
  ) {
    return "full_uninstall";
  }

  return "reset";
}

export function getCleanupTemplatesForInstaller(templates: Template[]): CleanupTemplateMap {
  return templates
    .filter((template) => template.deployment_type === "cleanup")
    .reduce<CleanupTemplateMap>((acc, template) => {
      acc[getCleanupMode(template)] = template;
      return acc;
    }, {});
}

export function getInstallationCleanupSystem(
  installation: InstallationDetailResponse
): InstallerId | null {
  const requiredCleanupSystem = installation.targets.find(
    (target) => target.operator_issue?.cleanup_system
  )?.operator_issue?.cleanup_system;

  return requiredCleanupSystem || installation.template_system_type || null;
}

export function getInstallationCleanupTargets(
  installation: InstallationDetailResponse
): InstallationTarget[] {
  const actionableTargets = installation.targets.filter(
    (target) => target.operator_issue?.cleanup_system
  );

  return actionableTargets.length > 0 ? actionableTargets : installation.targets;
}

export function normalizeNodeName(value: string, fallback = "node"): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63)
    .replace(/-$/g, "");

  return normalized || fallback;
}

export function buildDefaultHostOverride(host: Host, installer: InstallerId): HostOverrideForm {
  if (installer === "openshift_sno") {
    return {
      host_id: host.id,
      host_name: host.name,
      ip_address: host.ip_address,
      ssh_port: host.ssh_port,
      ansible_user: host.credential_username || "",
      vm_name: "single",
      node_name: "single-node",
      node_ip: "192.168.130.10",
      prefix_length: 24,
      gateway: "192.168.130.1",
      interface_name: "enp1s0",
      installation_disk: "/dev/vda",
      libvirt_network: "sno-workshop",
      storage_pool: "sno-pool",
      vcpu: 8,
      memory_gib: 24,
      disk_gib: 150,
      network_mode: "dhcp_reservation",
      cluster_name: "single",
      node_role: "master",
      advertise_address: host.ip_address,
      labels: "",
      taints: "",
    };
  }

  const defaultRole = installer === "k3s" ? "server" : "control_plane";

  return {
    host_id: host.id,
    host_name: host.name,
    ip_address: host.ip_address,
    ssh_port: host.ssh_port,
    ansible_user: host.credential_username || "",
    node_name: normalizeNodeName(host.hostname || host.name, `node-${host.id}`),
    cluster_name: "",
    node_role: defaultRole,
    advertise_address: host.ip_address,
    labels: "",
    taints: "",
  };
}

export function splitListInput(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildDefaultClusterConfig(installer: InstallerId): ClusterConfig {
  if (installer === "k3s") {
    return {
      cluster_name: "",
      version: "stable",
      topology_mode: "single_node",
      pod_cidr: "10.42.0.0/16",
      service_cidr: "10.43.0.0/16",
      cluster_domain: "cluster.local",
      control_plane_endpoint: "",
      cni_plugin: "flannel",
      disable_ingress: false,
    };
  }

  if (installer === "openshift_sno") {
    return {
      cluster_name: "single",
      base_domain: "lab.test",
      version: "4.20.3",
      topology_mode: "single_node",
      pod_cidr: "10.128.0.0/14",
      service_cidr: "172.30.0.0/16",
      cluster_domain: "cluster.local",
      control_plane_endpoint: "",
      cni_plugin: "OVNKubernetes",
      disable_ingress: false,
      machine_network_cidr: "192.168.130.0/24",
      rendezvous_ip: "192.168.130.10",
      cluster_network_cidr: "10.128.0.0/14",
      service_network_cidr: "172.30.0.0/16",
      host_prefix: 23,
      dns_servers: ["192.168.130.1"],
      target_modification_approved: true,
      disconnected: true,
    };
  }

  return {
    cluster_name: "",
    version: "stable",
    topology_mode: "single_node",
    pod_cidr: "192.168.0.0/16",
    service_cidr: "10.96.0.0/12",
    cluster_domain: "cluster.local",
    control_plane_endpoint: "",
    cni_plugin: "calico",
    disable_ingress: false,
  };
}
