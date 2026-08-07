import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Container,
  Divider,
  Group,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronUp,
  IconClockHour4,
  IconHistory,
  IconLink,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlugConnected,
  IconRefresh,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import DeploymentMonitor from "../components/deployment/DeploymentMonitor";
import InstallerLabel from "../components/installers/InstallerLabel";
import {
  type ExecutionStage,
  formatDurationDetailed,
  formatPhaseLabel as formatExecutionPhaseLabel,
  getStatusColor,
} from "../features/executions/presentation";
import {
  type InstallerId,
  getInstallerLogo,
  getInstallerOption,
  installerOptions,
} from "../features/installers/catalog";
import { parseJsonResponse } from "../lib/api";

type Host = {
  id: number;
  name: string;
  hostname?: string;
  ip_address: string;
  ssh_port: number;
  enabled: boolean;
  node_role: string;
  credential_username?: string | null;
};

type Template = {
  id: number;
  name: string;
  system_type: "kubernetes" | "k3s" | "openshift_sno";
  playbook_path: string;
  description: string;
  deployment_type: "prepare_node" | "single_node" | "cleanup";
};

type CleanupMode = "reset" | "full_uninstall";

type CleanupTemplateMap = Partial<Record<CleanupMode, Template>>;

type TimingBlock = {
  inventory_build_seconds?: number;
  repo_discovery_seconds?: number;
  playbook_execution_seconds?: number;
  total_request_seconds?: number;
  ssh_check_seconds?: number;
};

type ConnectivityStatus = {
  host: string;
  status: "success" | "failed" | "unreachable";
  detail: string;
};

type PrecheckResult = {
  message: string;
  command?: string;
  inventory_content?: string;
  timings?: TimingBlock;
  summary?: {
    selected_hosts: number;
    reachable_hosts: number;
    failed_hosts: number;
  };
  connectivity?: ConnectivityStatus[];
  stdout?: string;
  stderr?: string;
};

type LaunchQueuedResponse = {
  installation_id: number;
  celery_task_id?: string;
  status: string;
  phase: string;
  progress: number;
  message: string;
  cluster_config?: ClusterConfig;
  host_overrides?: HostOverridePayload[];
};

type ClusterConfig = {
  cluster_name: string;
  version: string;
  topology_mode: "single_node";
  pod_cidr: string;
  service_cidr: string;
  cluster_domain: string;
  control_plane_endpoint: string;
  cni_plugin: string;
  disable_ingress: boolean;
  control_plane_count?: number;
  worker_count?: number;
};

type HostOverrideForm = {
  host_id: number;
  host_name: string;
  ip_address: string;
  ssh_port: number;
  ansible_user: string;
  node_name: string;
  node_role: string;
  advertise_address: string;
  labels: string;
  taints: string;
};

type HostOverridePayload = Omit<HostOverrideForm, "labels" | "taints"> & {
  labels: string[];
  taints: string[];
};

type InstallationTarget = {
  id: number;
  host: number;
  host_name: string;
  status: string;
  output: string;
  stdout: string;
  stderr: string;
  return_code?: number | null;
  operator_issue?: {
    code: string;
    title: string;
    detail: string;
    recommended_action: string;
    cleanup_system?: InstallerId;
    artifacts?: string[];
  } | null;
};

type InstallationDetailResponse = {
  id: number;
  status: "pending" | "running" | "success" | "partial_success" | "failed" | "cancelled";
  phase: string;
  progress: number;
  template: number;
  template_name: string;
  template_system_type?: InstallerId;
  deployment_type: string;
  summary_message?: string;
  command?: string;
  inventory_content?: string;
  stdout?: string;
  stderr?: string;
  return_code?: number | null;
  timings?: TimingBlock;
  task_profile?: Array<{ name: string; seconds: number }>;
  bottleneck_hints?: string[];
  connectivity?: ConnectivityStatus[];
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
  updated_at?: string;
  duration_seconds?: number | null;
  celery_progress?: {
    task_id: string;
    state: string;
    meta?: {
      installation_id?: number;
      status?: string;
      phase?: string;
      progress?: number;
      summary_message?: string;
      current_step?: number | null;
      total_steps?: number | null;
      current_play?: string;
      current_role?: string;
      current_task?: string;
      seen_tasks?: number;
      completed_tasks?: number;
      recent_events?: Array<{
        kind: "play_started" | "task_started" | "task_result";
        play?: string;
        role?: string;
        task?: string;
        host?: string;
        status?: string;
        line?: string;
        channel?: string;
        timestamp?: string;
      }>;
      started_at?: string | null;
      updated_at?: string | null;
      detail?: string;
    };
  } | null;
  cluster_config?: ClusterConfig;
  host_overrides?: HostOverridePayload[];
  targets: InstallationTarget[];
};

type DashboardSummary = {
  hosts: {
    total: number;
    enabled: number;
    control_plane: number;
    worker: number;
  };
  credentials: {
    total: number;
    password: number;
    ssh_key: number;
  };
  installations: {
    total: number;
    success: number;
    partial_success?: number;
    failed: number;
    cancelled?: number;
    running: number;
    pending: number;
  };
  latest_installation: InstallationDetailResponse | null;
};

type LaunchResult = {
  installation_id: number;
  status: string;
  message: string;
  template_name?: string;
  template_system_type?: InstallerId;
  deployment_type?: string;
  target_hosts?: string[];
  target_host_ids?: number[];
  command?: string;
  stdout?: string;
  stderr?: string;
  rawOutput?: string;
  return_code?: number | null;
  timings?: TimingBlock;
  task_profile?: Array<{ name: string; seconds: number }>;
  bottleneck_hints?: string[];
  connectivity?: ConnectivityStatus[];
  duration_seconds?: number | null;
  cluster_config?: ClusterConfig;
  host_overrides?: HostOverridePayload[];
  targets?: InstallationTarget[];
};

type CleanupRequest = {
  systemType: InstallerId;
  hostIds: number[];
  clusterConfig: ClusterConfig;
  hostOverrides: HostOverridePayload[];
  title: string;
  purpose?: "maintenance" | "platform_switch";
};

const BASE_URL = import.meta.env.VITE_DJANGO_BASE_URL;
const ACTIVE_INSTALLATION_STORAGE_KEY = "lindeploy-active-installation-id";
const DISMISSED_INSTALLATION_STORAGE_KEY = "lindeploy-dismissed-installation-id";

function buildDefaultClusterConfig(installer: InstallerId): ClusterConfig {
  if (installer === "k3s") {
    return {
      cluster_name: "k3s-cluster-01",
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

  return {
    cluster_name: "kubernetes-cluster-01",
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

function buildDefaultHostOverride(host: Host, installer: InstallerId): HostOverrideForm {
  const defaultRole = installer === "k3s" ? "server" : "control_plane";

  return {
    host_id: host.id,
    host_name: host.name,
    ip_address: host.ip_address,
    ssh_port: host.ssh_port,
    ansible_user: host.credential_username || "",
    node_name: host.name,
    node_role: defaultRole,
    advertise_address: host.ip_address,
    labels: "",
    taints: "",
  };
}

function splitListInput(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const stageMap: ExecutionStage[] = [
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

const pipelineStageMap: ExecutionStage[] = stageMap.filter(
  (stage) => stage.phase !== "failed" && stage.phase !== "cancelled"
);

function formatPhaseLabel(phase?: string) {
  return formatExecutionPhaseLabel(stageMap, phase);
}

const installerWorkflowSteps = [
  {
    title: "Choose the target hosts",
    detail: "Pick one or more prepared machines from the inventory. Each selected target receives its own single-node installation.",
  },
  {
    title: "Verify SSH access",
    detail: "Confirm the stored host credential and network reachability before any playbook execution starts.",
  },
  {
    title: "Run the playbook",
    detail: "Launch the selected installer workflow on every selected target and follow the live execution monitor below.",
  },
  {
    title: "Use cleanup when needed",
    detail: "Reset cluster state or fully uninstall the system from the same page after deployment.",
  },
] as const;

function getLiveExecutionHeading(
  executionKind: "install" | "cleanup",
  deploymentType?: string,
  templateName?: string
) {
  if (executionKind === "cleanup" || deploymentType === "cleanup") {
    const normalizedName = (templateName || "").toLowerCase();

    if (normalizedName.includes("reset")) {
      return "Reset in Progress";
    }

    return "Cleanup in Progress";
  }

  return "Installation in Progress";
}


function getExecutionPresentation(
  status?: string | null,
  isCleanupExecution?: boolean,
  installerLabel?: string
) {
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
        "Use the host-level output and controller diagnostics below to identify the root cause before retrying.",
    };
  }

  return {
    title: "Installation completed successfully",
    summary: `${installerLabel || "The selected installer"} completed successfully and the target nodes should now be ready for validation.`,
    recommendation:
      "Run the validation commands on each successful host, then proceed with workload onboarding.",
  };
}

function getPrecheckPresentation(precheck?: PrecheckResult | null) {
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

function getConnectivityOperatorAction(item: ConnectivityStatus) {
  if (item.status === "success") {
    return "This host is ready for playbook execution.";
  }

  if (item.status === "unreachable") {
    return "Check network reachability, host address, and SSH service availability before retrying.";
  }

  return "Check credentials, sudo configuration, and remote access policy before retrying.";
}

function getTargetOperatorAction(target: InstallationTarget) {
  if (target.status === "success") {
    return "Run the validation checks on this host and confirm cluster health.";
  }

  if (target.status === "failed" || target.status === "unreachable") {
    return "Review the captured output, correct the underlying issue, then retry this host only.";
  }

  return "Review the captured output for this host before deciding on the next action.";
}

function isInstallationActive(installation?: InstallationDetailResponse | null) {
  return installation?.status === "pending" || installation?.status === "running";
}

function buildResultFromInstallation(installation: InstallationDetailResponse): LaunchResult {
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

function getTargetStatusSummary(targets: InstallationTarget[]) {
  return targets.reduce(
    (acc, target) => {
      acc[target.status] = (acc[target.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}

function extractTargetDiagnostics(target: InstallationTarget) {
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

function getCleanupMode(template: Template): CleanupMode {
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

function getCleanupTemplatesForInstaller(templates: Template[]): CleanupTemplateMap {
  return templates
    .filter((template) => template.deployment_type === "cleanup")
    .reduce<CleanupTemplateMap>((acc, template) => {
      acc[getCleanupMode(template)] = template;
      return acc;
    }, {});
}

function getInstallationCleanupSystem(
  installation: InstallationDetailResponse
): InstallerId | null {
  const requiredCleanupSystem = installation.targets.find(
    (target) => target.operator_issue?.cleanup_system
  )?.operator_issue?.cleanup_system;

  return requiredCleanupSystem || installation.template_system_type || null;
}

function getInstallationCleanupTargets(
  installation: InstallationDetailResponse
): InstallationTarget[] {
  const actionableTargets = installation.targets.filter(
    (target) => target.operator_issue?.cleanup_system
  );

  return actionableTargets.length > 0 ? actionableTargets : installation.targets;
}

type RunDeploymentMode = "full" | "installer" | "execution" | "history";

type RunDeploymentProps = {
  forcedInstaller?: InstallerId;
  mode?: RunDeploymentMode;
};

export default function RunDeployment({
  forcedInstaller,
  mode = "full",
}: RunDeploymentProps) {
  const navigate = useNavigate();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [cleanupTemplatesBySystem, setCleanupTemplatesBySystem] = useState<
    Partial<Record<InstallerId, CleanupTemplateMap>>
  >({});
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [installations, setInstallations] = useState<InstallationDetailResponse[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<number[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedInstaller, setSelectedInstaller] = useState<InstallerId>(forcedInstaller ?? "kubernetes");
  const [clusterConfig, setClusterConfig] = useState<ClusterConfig>(
    buildDefaultClusterConfig(forcedInstaller ?? "kubernetes")
  );
  const [hostOverrides, setHostOverrides] = useState<Record<number, HostOverrideForm>>({});
  const [deploymentMode] = useState<"auto" | "manual">("auto");
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showFailureModal, setShowFailureModal] = useState(false);
  const [showPlatformConflictModal, setShowPlatformConflictModal] = useState(false);
  const [showSshSuccessModal, setShowSshSuccessModal] = useState(false);
  const [cleanupRequest, setCleanupRequest] = useState<CleanupRequest | null>(null);
  const [resumeCandidate, setResumeCandidate] = useState<InstallationDetailResponse | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [deletingHistoryInstallationId, setDeletingHistoryInstallationId] = useState<number | null>(null);
  const [checkingConnectivity, setCheckingConnectivity] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [precheckResult, setPrecheckResult] = useState<PrecheckResult | null>(null);
  const [activeInstallationId, setActiveInstallationId] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<InstallationDetailResponse["status"] | null>(null);
  const [livePhase, setLivePhase] = useState<string | null>(null);
  const [liveSummaryMessage, setLiveSummaryMessage] = useState<string>("");
  const [liveCurrentPlay, setLiveCurrentPlay] = useState<string>("");
  const [liveCurrentRole, setLiveCurrentRole] = useState<string>("");
  const [liveCurrentTask, setLiveCurrentTask] = useState<string>("");
  const [liveSeenTasks, setLiveSeenTasks] = useState<number>(0);
  const [liveCompletedTasks, setLiveCompletedTasks] = useState<number>(0);
  const [liveExecutionTitle, setLiveExecutionTitle] = useState("Installation in Progress");
  const loadingStartedAtRef = useRef<number | null>(null);
  const lastSuccessModalInstallationIdRef = useRef<number | null>(null);
  const lastFailureModalInstallationIdRef = useRef<number | null>(null);
  const showDashboardSummary = mode !== "history";
  const showResumeAlert = mode !== "history";
  const showInstallerChooser = mode === "full";
  const showInstallerConfiguration = mode === "full" || mode === "installer";
  const showExecutionMonitoring = mode !== "history";
  const showHistoryPage = mode === "history";
  const showHistoryButton = mode !== "history";
  const pageTitle =
    mode === "installer"
      ? `${getInstallerOption(forcedInstaller ?? selectedInstaller).label} Deployment`
      : mode === "execution"
        ? "Execution Center"
        : mode === "history"
          ? "Installation History"
          : "Run Playbook";
  const pageDescription =
    mode === "installer"
      ? "Configure the selected installer, validate access, and launch the automation workflow from its dedicated page."
      : mode === "execution"
        ? "Monitor active runs, inspect the pipeline, and review the latest execution result."
        : mode === "history"
          ? "Review completed installation runs outside the live execution view and remove obsolete records."
          : "Choose the target installer, validate SSH access, and run the selected automation workflow with live execution feedback.";

  const selectionSignature = useMemo(
    () => [...selectedHostIds].sort((a, b) => a - b).join(","),
    [selectedHostIds]
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => String(template.id) === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const cleanupTemplatesForSelectedInstaller = useMemo(
    () => cleanupTemplatesBySystem[selectedInstaller] || getCleanupTemplatesForInstaller(templates),
    [cleanupTemplatesBySystem, selectedInstaller, templates]
  );

  const hasCleanupOption = useMemo(
    () => Object.keys(cleanupTemplatesForSelectedInstaller).length > 0,
    [cleanupTemplatesForSelectedInstaller]
  );

  const selectedInstallerOption = useMemo(
    () => getInstallerOption(selectedInstaller),
    [selectedInstaller]
  );

  const selectedHosts = useMemo(
    () =>
      selectedHostIds
        .map((hostId) => hosts.find((host) => host.id === hostId))
        .filter((host): host is Host => Boolean(host)),
    [hosts, selectedHostIds]
  );

  const selectedHostOverrideList = useMemo(
    () =>
      selectedHosts.map(
        (host) => hostOverrides[host.id] || buildDefaultHostOverride(host, selectedInstaller)
      ),
    [hostOverrides, selectedHosts, selectedInstaller]
  );

  const plannedControlPlaneCount = useMemo(() => {
    const controlRoles = selectedInstaller === "k3s" ? ["server"] : ["control_plane"];
    return selectedHostOverrideList.filter((host) => controlRoles.includes(host.node_role)).length;
  }, [selectedHostOverrideList, selectedInstaller]);

  const plannedWorkerCount = useMemo(() => {
    const workerRoles = selectedInstaller === "k3s" ? ["agent"] : ["worker"];
    return selectedHostOverrideList.filter((host) => workerRoles.includes(host.node_role)).length;
  }, [selectedHostOverrideList, selectedInstaller]);

  const resultTargetSummary = useMemo(
    () => getTargetStatusSummary(result?.targets || []),
    [result?.targets]
  );

  const historyInstallations = useMemo(
    () =>
      installations.filter(
        (installation) =>
          installation.status === "success" ||
          installation.status === "partial_success" ||
          installation.status === "failed" ||
          installation.status === "cancelled"
      ),
    [installations]
  );

  const precheckSucceeded = useMemo(
    () =>
      Boolean(
        precheckResult &&
          (precheckResult.summary?.failed_hosts ?? 0) === 0 &&
          (precheckResult.summary?.reachable_hosts ?? 0) > 0
      ),
    [precheckResult]
  );

  const activeStage = useMemo(() => {
    return stageMap.find((stage) => stage.phase === livePhase) || stageMap[0];
  }, [livePhase]);

  const pipelinePhase = useMemo(() => {
    if (livePhase && livePhase !== "failed" && livePhase !== "cancelled") {
      return livePhase;
    }

    if (!loading && (result?.status === "success" || result?.status === "partial_success")) {
      return "completed";
    }

    return null;
  }, [livePhase, loading, result]);

  const pipelineStageIndex = useMemo(() => {
    if (!pipelinePhase) {
      return -1;
    }

    return pipelineStageMap.findIndex((stage) => stage.phase === pipelinePhase);
  }, [pipelinePhase]);

  const clusterTargetHosts = useMemo(() => {
    if (result?.target_hosts && result.target_hosts.length > 0) {
      return result.target_hosts;
    }

    return hosts
      .filter((host) => selectedHostIds.includes(host.id))
      .map((host) => host.name);
  }, [result, hosts, selectedHostIds]);

  const clusterSelectedHosts = useMemo(
    () => hosts.filter((host) => clusterTargetHosts.includes(host.name)),
    [hosts, clusterTargetHosts]
  );

  const activeInstallerSystem = useMemo<InstallerId>(() => {
    return result?.template_system_type || selectedTemplate?.system_type || selectedInstaller;
  }, [result?.template_system_type, selectedTemplate?.system_type, selectedInstaller]);

  const activeInstallerLabel = useMemo(() => {
    return installerOptions.find((installer) => installer.id === activeInstallerSystem)?.label || "Installer";
  }, [activeInstallerSystem]);

  const activeCleanupTemplates = useMemo(
    () => cleanupTemplatesBySystem[activeInstallerSystem] || null,
    [activeInstallerSystem, cleanupTemplatesBySystem]
  );

  const canCleanupResult = useMemo(
    () =>
      Boolean(
        result &&
          result.deployment_type !== "cleanup" &&
          activeCleanupTemplates &&
          Object.keys(activeCleanupTemplates).length > 0 &&
          result.target_host_ids &&
          result.target_host_ids.length > 0
      ),
    [activeCleanupTemplates, result]
  );

  const failedResultTargets = useMemo(
    () => (result?.targets || []).filter((target) => target.status === "failed"),
    [result?.targets]
  );

  const platformConflictTargets = useMemo(
    () =>
      (result?.targets || []).filter(
        (target) =>
          target.operator_issue?.code === "k3s_conflict" ||
          target.operator_issue?.code === "kubernetes_conflict"
      ),
    [result?.targets]
  );

  const conflictCleanupSystem = useMemo<InstallerId | null>(
    () => platformConflictTargets[0]?.operator_issue?.cleanup_system || null,
    [platformConflictTargets]
  );

  const conflictCleanupLabel = conflictCleanupSystem
    ? getInstallerOption(conflictCleanupSystem).label
    : "existing platform";
  const blockedInstallerLabel = result?.template_system_type
    ? getInstallerOption(result.template_system_type).label
    : activeInstallerLabel;
  const hasConflictCleanupOption = Boolean(
    conflictCleanupSystem &&
      cleanupTemplatesBySystem[conflictCleanupSystem] &&
      Object.keys(cleanupTemplatesBySystem[conflictCleanupSystem] || {}).length > 0
  );

  const succeededResultTargets = useMemo(
    () => (result?.targets || []).filter((target) => target.status === "success"),
    [result?.targets]
  );

  const canRetryFailedTargets = useMemo(
    () =>
      Boolean(
        result &&
          result.deployment_type !== "cleanup" &&
          result.template_system_type &&
          failedResultTargets.length > 0
      ),
    [failedResultTargets.length, result]
  );

  const cleanupRequestTemplates = useMemo(
    () => (cleanupRequest ? cleanupTemplatesBySystem[cleanupRequest.systemType] || {} : {}),
    [cleanupRequest, cleanupTemplatesBySystem]
  );

  const clusterControlPlaneCount = useMemo(() => {
    const explicitCount = clusterSelectedHosts.filter((host) => host.node_role === "control_plane").length;
    if (explicitCount > 0) {
      return explicitCount;
    }
    return clusterTargetHosts.length > 0 ? 1 : 0;
  }, [clusterSelectedHosts, clusterTargetHosts]);

  const clusterWorkerCount = useMemo(() => {
    const explicitWorkers = clusterSelectedHosts.filter((host) => host.node_role === "worker").length;
    if (result?.deployment_type === "single_node") {
      return Math.max(clusterControlPlaneCount, explicitWorkers);
    }
    return explicitWorkers;
  }, [clusterSelectedHosts, clusterControlPlaneCount, clusterTargetHosts, result]);

  const isCleanupExecution = result?.deployment_type === "cleanup";

  const clusterTopologyLabel = useMemo(() => {
    if (result?.deployment_type === "cleanup") {
      return "Cluster state removed from the selected host";
    }
    if (result?.deployment_type === "single_node") {
      return activeInstallerSystem === "k3s"
        ? "Single-node K3s server with workload scheduling enabled"
        : "Single-node control plane with workload scheduling enabled";
    }
    return "Multi-node topology";
  }, [activeInstallerSystem, result]);

  const postInstallChecks = useMemo(
    () => {
      if (isCleanupExecution) {
        return activeInstallerSystem === "k3s"
          ? [
              "sudo systemctl status k3s --no-pager",
              "test ! -e /etc/rancher/k3s/k3s.yaml && echo 'k3s kubeconfig removed'",
              "test ! -e /var/lib/rancher/k3s && echo 'k3s state removed'",
            ]
          : [
              "sudo systemctl status kubelet --no-pager",
              "test ! -e /etc/kubernetes/admin.conf && echo 'kubernetes admin.conf removed'",
              "test ! -e /var/lib/etcd && echo 'etcd state removed'",
            ];
      }

      return activeInstallerSystem === "k3s"
        ? [
            "kubectl get nodes",
            "kubectl get pods -A",
            "sudo systemctl status k3s --no-pager",
            "sudo /usr/local/bin/k3s kubectl get --raw=/readyz",
            "kubectl top nodes",
          ]
        : [
            "export KUBECONFIG=/etc/kubernetes/admin.conf",
            "kubectl get nodes",
            "kubectl get pods -A",
            "sudo systemctl status kubelet --no-pager",
            "sudo systemctl status containerd --no-pager",
          ];
    },
    [activeInstallerSystem, isCleanupExecution]
  );

  async function fetchHosts() {
    const response = await fetch(`${BASE_URL}/api/hosts/`);
    if (!response.ok) {
      throw new Error("Failed to load hosts.");
    }

    setHosts(await parseJsonResponse<Host[]>(response));
  }

  async function fetchTemplates(installer: InstallerId = selectedInstaller) {
    const response = await fetch(`${BASE_URL}/api/templates/?system_type=${installer}`);
    if (!response.ok) {
      throw new Error("Failed to load templates.");
    }

    const data = await parseJsonResponse<Template[]>(response);
    setTemplates(data);
    setCleanupTemplatesBySystem((prev) => {
      const cleanupTemplatesForInstaller = getCleanupTemplatesForInstaller(data);

      if (Object.keys(cleanupTemplatesForInstaller).length === 0) {
        return prev;
      }

      return {
        ...prev,
        [installer]: cleanupTemplatesForInstaller,
      };
    });
    const defaultInstallTemplate = data.find((template) => template.deployment_type !== "cleanup");
    if (
      defaultInstallTemplate &&
      (!selectedTemplateId || !data.some((template) => String(template.id) === selectedTemplateId))
    ) {
      setSelectedTemplateId(String(defaultInstallTemplate.id));
      return data;
    }

    if (data.length === 0) {
      setSelectedTemplateId("");
    }

    return data;
  }

  async function fetchCleanupTemplates() {
    const cleanupEntries = await Promise.all(
      installerOptions.map(async (installer) => {
        const response = await fetch(`${BASE_URL}/api/templates/?system_type=${installer.id}`);
        if (!response.ok) {
          return null;
        }

        const data = await parseJsonResponse<Template[]>(response);
        const cleanupTemplatesForInstaller = getCleanupTemplatesForInstaller(data);

        if (Object.keys(cleanupTemplatesForInstaller).length === 0) {
          return null;
        }

        return [installer.id, cleanupTemplatesForInstaller] as const;
      })
    );

    setCleanupTemplatesBySystem(
      cleanupEntries.reduce<Partial<Record<InstallerId, CleanupTemplateMap>>>((acc, entry) => {
        if (entry) {
          acc[entry[0]] = entry[1];
        }
        return acc;
      }, {})
    );
  }

  async function fetchDashboard() {
    const response = await fetch(`${BASE_URL}/api/dashboard/`);
    if (!response.ok) {
      throw new Error("Failed to load dashboard summary.");
    }

    const data = await parseJsonResponse<DashboardSummary>(response);
    setDashboard(data);
    return data;
  }

  async function fetchInstallations() {
    const response = await fetch(`${BASE_URL}/api/installations/?limit=50`);
    if (!response.ok) {
      throw new Error("Failed to load installation history.");
    }

    const data = await parseJsonResponse<InstallationDetailResponse[]>(response);
    setInstallations(data);
    return data;
  }

  function persistActiveInstallationId(installationId: number | null) {
    if (installationId === null) {
      window.localStorage.removeItem(ACTIVE_INSTALLATION_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ACTIVE_INSTALLATION_STORAGE_KEY, String(installationId));
  }

  function persistDismissedInstallationId(installationId: number | null) {
    if (installationId === null) {
      window.localStorage.removeItem(DISMISSED_INSTALLATION_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(DISMISSED_INSTALLATION_STORAGE_KEY, String(installationId));
  }

  function clearLiveInstallationState() {
    setLoading(false);
    setActiveInstallationId(null);
    setLiveStatus(null);
    setLivePhase(null);
    setLiveSummaryMessage("");
    setLiveCurrentPlay("");
    setLiveCurrentRole("");
    setLiveCurrentTask("");
    setLiveSeenTasks(0);
    setLiveCompletedTasks(0);
    setProgress(0);
    loadingStartedAtRef.current = null;
    persistActiveInstallationId(null);
  }

  async function resumeInstallationMonitoring(installationId: number) {
    const response = await fetch(`${BASE_URL}/api/installations/${installationId}/`);
    if (!response.ok) {
      persistActiveInstallationId(null);
      throw new Error("Failed to resume installation status.");
    }

    const data = await parseJsonResponse<InstallationDetailResponse>(response);

    if (data.started_at) {
      loadingStartedAtRef.current = new Date(data.started_at).getTime();
    }

    if (data.status === "pending" || data.status === "running") {
      setResumeCandidate(null);
      setLoading(true);
      setActiveInstallationId(data.id);
      setLiveStatus(data.status);
      setLivePhase(data.celery_progress?.meta?.phase || data.phase);
      setProgress(data.celery_progress?.meta?.progress ?? data.progress ?? 0);
      setLiveSummaryMessage(data.celery_progress?.meta?.summary_message || data.summary_message || "");
      setLiveCurrentPlay(data.celery_progress?.meta?.current_play || "");
      setLiveCurrentRole(data.celery_progress?.meta?.current_role || "");
      setLiveCurrentTask(data.celery_progress?.meta?.current_task || "");
      setLiveSeenTasks(data.celery_progress?.meta?.seen_tasks || 0);
      setLiveCompletedTasks(data.celery_progress?.meta?.completed_tasks || 0);
      persistActiveInstallationId(data.id);
      return;
    }

    setResult(buildResultFromInstallation(data));
    clearLiveInstallationState();
  }

  async function refreshOperationalData() {
    const [dashboardData, installationsData] = await Promise.all([
      fetchDashboard(),
      fetchInstallations(),
    ]);
    return { dashboardData, installationsData };
  }

  useEffect(() => {
    async function initializePage() {
      const [, , , operationalData] = await Promise.all([
        fetchHosts(),
        fetchTemplates(selectedInstaller),
        fetchCleanupTemplates(),
        refreshOperationalData(),
      ]);

      const persistedId = window.localStorage.getItem(ACTIVE_INSTALLATION_STORAGE_KEY);
      const dismissedId = window.localStorage.getItem(DISMISSED_INSTALLATION_STORAGE_KEY);

      if (persistedId) {
        const response = await fetch(`${BASE_URL}/api/installations/${persistedId}/`);

        if (!response.ok) {
          persistActiveInstallationId(null);
        } else {
          const installation = await parseJsonResponse<InstallationDetailResponse>(response);

          if (isInstallationActive(installation)) {
            if (dismissedId !== String(installation.id)) {
              setResumeCandidate(installation);
            }
            return;
          }

          persistActiveInstallationId(null);
        }
      }

      const latestActiveInstallation = operationalData.installationsData.find(
        (installation) => isInstallationActive(installation)
      );

      if (latestActiveInstallation && dismissedId !== String(latestActiveInstallation.id)) {
        setResumeCandidate(latestActiveInstallation);
      }
    }

    void initializePage().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to initialize page.")
    );
  }, []);

  useEffect(() => {
    if (!forcedInstaller || selectedInstaller === forcedInstaller) {
      return;
    }

    setSelectedInstaller(forcedInstaller);
  }, [forcedInstaller, selectedInstaller]);

  useEffect(() => {
    setPrecheckResult(null);
  }, [selectionSignature]);

  useEffect(() => {
    void fetchTemplates(selectedInstaller).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load installer templates.")
    );
  }, [selectedInstaller]);

  useEffect(() => {
    setClusterConfig(buildDefaultClusterConfig(selectedInstaller));
  }, [selectedInstaller]);

  useEffect(() => {
    setHostOverrides((prev) => {
      const next: Record<number, HostOverrideForm> = {};

      selectedHosts.forEach((host) => {
        const defaults = buildDefaultHostOverride(host, selectedInstaller);
        const existing = prev[host.id];
        next[host.id] = existing
          ? {
              ...defaults,
              host_id: host.id,
              host_name: host.name,
              ip_address: host.ip_address,
              ssh_port: existing.ssh_port,
              ansible_user: existing.ansible_user,
              node_name: existing.node_name,
              advertise_address: existing.advertise_address,
              labels: existing.labels,
              taints: existing.taints,
            }
          : defaults;
      });

      return next;
    });
  }, [selectedHosts, selectedInstaller]);

  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      loadingStartedAtRef.current = null;
      return;
    }

    if (loadingStartedAtRef.current === null) {
      loadingStartedAtRef.current = Date.now();
    }

    const timer = window.setInterval(() => {
      const startedAt = loadingStartedAtRef.current ?? Date.now();
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!loading || activeInstallationId === null) {
      return;
    }

    let cancelled = false;

    async function pollInstallation() {
      try {
        const response = await fetch(`${BASE_URL}/api/installations/${activeInstallationId}/`);
        if (!response.ok) {
          throw new Error("Failed to fetch installation status.");
        }

        const data = await parseJsonResponse<InstallationDetailResponse>(response);
        if (cancelled) {
          return;
        }

        if (data.started_at) {
          loadingStartedAtRef.current = new Date(data.started_at).getTime();
        }

        setLiveStatus(data.status);
        setLivePhase(data.celery_progress?.meta?.phase || data.phase);
        setProgress(data.celery_progress?.meta?.progress ?? data.progress ?? 0);
        setLiveSummaryMessage(
          data.celery_progress?.meta?.summary_message || data.summary_message || ""
        );
        setLiveCurrentPlay(data.celery_progress?.meta?.current_play || "");
        setLiveCurrentRole(data.celery_progress?.meta?.current_role || "");
        setLiveCurrentTask(data.celery_progress?.meta?.current_task || "");
        setLiveSeenTasks(data.celery_progress?.meta?.seen_tasks || 0);
        setLiveCompletedTasks(data.celery_progress?.meta?.completed_tasks || 0);
        if (
          data.status === "success" ||
          data.status === "partial_success" ||
          data.status === "failed" ||
          data.status === "cancelled"
        ) {
          setResult(buildResultFromInstallation(data));
          clearLiveInstallationState();
          await refreshOperationalData();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Polling failed.");
          clearLiveInstallationState();
        }
      }
    }

    void pollInstallation();
    const intervalId = window.setInterval(() => {
      void pollInstallation();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loading, activeInstallationId]);

  useEffect(() => {
    if (mode === "history") {
      return;
    }

    if (result?.status !== "success") {
      return;
    }

    if (lastSuccessModalInstallationIdRef.current === result.installation_id) {
      return;
    }

    lastSuccessModalInstallationIdRef.current = result.installation_id;
    setShowSuccessModal(true);
  }, [result]);

  useEffect(() => {
    if (mode === "history") {
      return;
    }

    if (result?.status !== "failed" && result?.status !== "partial_success") {
      return;
    }

    if (lastFailureModalInstallationIdRef.current === result.installation_id) {
      return;
    }

    lastFailureModalInstallationIdRef.current = result.installation_id;

    if (platformConflictTargets.length > 0) {
      setShowFailureModal(false);
      setShowPlatformConflictModal(true);
      return;
    }

    setShowFailureModal(true);
  }, [platformConflictTargets.length, result]);

  function toggleHost(hostId: number, checked: boolean) {
    if (checked) {
      setSelectedHostIds((prev) => [...prev, hostId]);
      return;
    }

    setSelectedHostIds((prev) => prev.filter((id) => id !== hostId));
  }

  function buildClusterPayload(): ClusterConfig {
    return {
      ...clusterConfig,
      control_plane_count: plannedControlPlaneCount,
      worker_count: plannedWorkerCount,
    };
  }

  function buildHostOverridesPayload(): HostOverridePayload[] {
    return selectedHostOverrideList.map((hostOverride) => ({
      ...hostOverride,
      labels: splitListInput(hostOverride.labels),
      taints: splitListInput(hostOverride.taints),
    }));
  }

  async function runPrecheck(showSuccessState: boolean) {
    if (selectedHostIds.length === 0) {
      setError("Select at least one host before running the SSH verification.");
      return false;
    }

    setCheckingConnectivity(true);
    setError("");
    setShowSshSuccessModal(false);

    try {
      const response = await fetch(`${BASE_URL}/api/installations/precheck/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          host_ids: selectedHostIds,
          host_overrides: buildHostOverridesPayload(),
        }),
      });

      const data = await parseJsonResponse<PrecheckResult>(response);
      setPrecheckResult(data);
      setShowSshSuccessModal(true);

      if (showSuccessState) {
        setResult(null);
      }

      if (!response.ok) {
        throw new Error(data.message || "SSH verification failed.");
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSH verification failed.");
      return false;
    } finally {
      setCheckingConnectivity(false);
    }
  }

  async function queueInstallation(options?: {
    deploymentMode?: "auto" | "manual";
    templateId?: number;
    executionKind?: "install" | "cleanup";
    systemType?: InstallerId;
    hostIds?: number[];
    clusterConfigOverride?: ClusterConfig;
    hostOverridesOverride?: HostOverridePayload[];
  }) {
    const effectiveMode = options?.deploymentMode || deploymentMode;
    const effectiveTemplateId =
      options?.templateId ?? (selectedTemplateId ? Number(selectedTemplateId) : undefined);
    const executionKind = options?.executionKind || "install";
    const effectiveSystemType = options?.systemType || selectedInstaller;
    const effectiveHostIds = options?.hostIds || selectedHostIds;
    const effectiveClusterConfig = options?.clusterConfigOverride || buildClusterPayload();
    const effectiveHostOverrides = options?.hostOverridesOverride || buildHostOverridesPayload();
    const effectiveTemplate =
      typeof effectiveTemplateId === "number"
        ? templates.find((template) => template.id === effectiveTemplateId) || null
        : null;

    setLoading(true);
    setResumeCandidate(null);
    persistDismissedInstallationId(null);
    setProgress(0);
    setError("");
    setResult(null);
    setLiveStatus("pending");
    setLivePhase("queued");
    setLiveSummaryMessage(
      executionKind === "cleanup" ? "Cleanup queued successfully." : "Installation queued successfully."
    );
    setLiveCurrentPlay("");
    setLiveCurrentRole("");
    setLiveCurrentTask("");
    setLiveSeenTasks(0);
    setLiveCompletedTasks(0);
    setLiveExecutionTitle(
      getLiveExecutionHeading(executionKind, effectiveTemplate?.deployment_type, effectiveTemplate?.name)
    );

    try {
      const response = await fetch(`${BASE_URL}/api/installations/launch/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          effectiveMode === "manual"
            ? {
                system_type: effectiveSystemType,
                deployment_mode: "manual",
                template_id: effectiveTemplateId,
                host_ids: effectiveHostIds,
                cluster_config: effectiveClusterConfig,
                host_overrides: effectiveHostOverrides,
              }
            : {
                system_type: effectiveSystemType,
                deployment_mode: "auto",
                host_ids: effectiveHostIds,
                cluster_config: effectiveClusterConfig,
                host_overrides: effectiveHostOverrides,
              }
        ),
      });

      const data = await parseJsonResponse<LaunchQueuedResponse>(response);

      if (!response.ok) {
        throw new Error(data.message || (executionKind === "cleanup" ? "Cleanup launch failed." : "Launch failed."));
      }

      setActiveInstallationId(data.installation_id);
      setLivePhase(data.phase);
      setProgress(data.progress);
      setLiveSummaryMessage(data.message);
      persistActiveInstallationId(data.installation_id);
      await refreshOperationalData();
    } catch (err) {
      const failureMessage =
        err instanceof Error
          ? err.message
          : executionKind === "cleanup"
            ? "Cleanup launch failed."
            : "Launch failed.";
      setError(failureMessage);
      setResult({
        installation_id: activeInstallationId ?? 0,
        status: "failed",
        message: failureMessage,
        stderr: failureMessage,
      });
      clearLiveInstallationState();
    }
  }

  async function handleLaunch() {
    if (selectedHostIds.length === 0) {
      setError("Select at least one host.");
      return;
    }

    if (!clusterConfig.cluster_name.trim()) {
      setError("Cluster name is required.");
      return;
    }

    if (deploymentMode === "manual" && !selectedTemplateId) {
      setError("Select a template in manual mode.");
      return;
    }

    await queueInstallation({
      deploymentMode,
      templateId: selectedTemplateId ? Number(selectedTemplateId) : undefined,
      executionKind: "install",
    });
  }

  function openCleanupDialog(request: CleanupRequest) {
    setCleanupRequest(request);
    setShowSuccessModal(false);
    setShowFailureModal(false);
    setShowPlatformConflictModal(false);
  }

  function handlePlatformConflictCleanupLaunch() {
    const conflictHostIds = platformConflictTargets.map((target) => target.host);

    if (!conflictCleanupSystem || !hasConflictCleanupOption) {
      setError("The required cleanup workflow is not registered. Refresh installer data and try again.");
      return;
    }

    if (conflictHostIds.length === 0) {
      setError("No target requiring platform cleanup was found in this deployment result.");
      return;
    }

    const conflictHostOverrides = hosts
      .filter((host) => conflictHostIds.includes(host.id))
      .map((host) => {
        const hostOverride = buildDefaultHostOverride(host, conflictCleanupSystem);
        return {
          ...hostOverride,
          labels: splitListInput(hostOverride.labels),
          taints: splitListInput(hostOverride.taints),
        };
      });

    setSelectedHostIds(conflictHostIds);
    openCleanupDialog({
      systemType: conflictCleanupSystem,
      hostIds: conflictHostIds,
      clusterConfig: buildDefaultClusterConfig(conflictCleanupSystem),
      hostOverrides: conflictHostOverrides,
      title:
        conflictHostIds.length === 1
          ? `Cleanup ${conflictCleanupLabel} on ${platformConflictTargets[0].host_name}`
          : `Cleanup ${conflictCleanupLabel} on ${conflictHostIds.length} affected targets`,
      purpose: "platform_switch",
    });
  }

  async function launchCleanupRequest(request: CleanupRequest, cleanupMode: CleanupMode) {
    const cleanupTemplate = cleanupTemplatesBySystem[request.systemType]?.[cleanupMode] || null;

    if (!cleanupTemplate) {
      setError(
        cleanupMode === "full_uninstall"
          ? `No Full Uninstall template is registered yet for ${getInstallerOption(request.systemType).label}.`
          : `No Reset Cluster template is registered yet for ${getInstallerOption(request.systemType).label}.`
      );
      return;
    }

    setCleanupRequest(null);

    await queueInstallation({
      deploymentMode: "manual",
      templateId: cleanupTemplate.id,
      executionKind: "cleanup",
      systemType: request.systemType,
      hostIds: request.hostIds,
      clusterConfigOverride: request.clusterConfig,
      hostOverridesOverride: request.hostOverrides,
    });

    if (mode === "history") {
      navigate("/executions");
    }
  }

  async function handleCleanupLaunch() {
    if (selectedHostIds.length === 0) {
      setError("Select at least one target host before running cleanup.");
      return;
    }

    if (!hasCleanupOption) {
      setError(`No cleanup template is registered yet for ${selectedInstallerOption.label}.`);
      return;
    }

    openCleanupDialog({
      systemType: selectedInstaller,
      hostIds: selectedHostIds,
      clusterConfig,
      hostOverrides: buildHostOverridesPayload(),
      title:
        selectedHostIds.length === 1
          ? `Cleanup ${selectedInstallerOption.label} on 1 target`
          : `Cleanup ${selectedInstallerOption.label} on ${selectedHostIds.length} targets`,
    });
  }

  async function handleInstallationCleanupLaunch(installation: InstallationDetailResponse) {
    const systemType = getInstallationCleanupSystem(installation);
    const cleanupTargets = getInstallationCleanupTargets(installation);
    const cleanupTemplatesForInstallation =
      (systemType ? cleanupTemplatesBySystem[systemType] : null) || null;
    const hostIds = cleanupTargets.map((target) => target.host);

    if (!systemType || !cleanupTemplatesForInstallation || Object.keys(cleanupTemplatesForInstallation).length === 0) {
      setError("No cleanup template is registered for this installation.");
      return;
    }

    if (hostIds.length === 0) {
      setError("This installation has no recorded target hosts to clean.");
      return;
    }

    setSelectedInstaller(systemType);
    setSelectedHostIds(hostIds);
    setShowHistory(false);
    openCleanupDialog({
      systemType,
      hostIds,
      clusterConfig:
        systemType === installation.template_system_type
          ? (installation.cluster_config as ClusterConfig | undefined) || buildDefaultClusterConfig(systemType)
          : buildDefaultClusterConfig(systemType),
      hostOverrides: (installation.host_overrides || []).filter((override) =>
        hostIds.includes(override.host_id)
      ),
      title:
        hostIds.length === 1
          ? `Cleanup ${getInstallerOption(systemType).label} on ${cleanupTargets[0]?.host_name || "selected host"}`
          : `Cleanup ${getInstallerOption(systemType).label} on ${hostIds.length} targets`,
    });
  }

  async function handleResultCleanupLaunch() {
    if (!result?.template_system_type || !result.target_host_ids || result.target_host_ids.length === 0) {
      setError("The current execution result does not expose any target hosts for cleanup.");
      return;
    }

    const cleanupTemplatesForResult = cleanupTemplatesBySystem[result.template_system_type];
    if (!cleanupTemplatesForResult || Object.keys(cleanupTemplatesForResult).length === 0) {
      setError("No cleanup template is registered for this system.");
      return;
    }

    setSelectedInstaller(result.template_system_type);
    setSelectedHostIds(result.target_host_ids);
    openCleanupDialog({
      systemType: result.template_system_type,
      hostIds: result.target_host_ids,
      clusterConfig:
        (result.cluster_config as ClusterConfig | undefined) ||
        buildDefaultClusterConfig(result.template_system_type),
      hostOverrides: result.host_overrides || [],
      title: `Cleanup ${activeInstallerLabel}`,
    });
  }

  async function handleRetryFailedTargets() {
    if (!result?.template_system_type || failedResultTargets.length === 0) {
      setError("No failed targets are available for retry.");
      return;
    }

    const failedHostIds = failedResultTargets.map((target) => target.host);
    const filteredHostOverrides = (result.host_overrides || []).filter((override) =>
      failedHostIds.includes(override.host_id)
    );

    setShowFailureModal(false);
    setSelectedInstaller(result.template_system_type);
    setSelectedHostIds(failedHostIds);
    setPrecheckResult(null);

    await queueInstallation({
      deploymentMode: "auto",
      executionKind: "install",
      systemType: result.template_system_type,
      hostIds: failedHostIds,
      clusterConfigOverride:
        (result.cluster_config as ClusterConfig | undefined) ||
        buildDefaultClusterConfig(result.template_system_type),
      hostOverridesOverride: filteredHostOverrides,
    });
  }

  async function handleCancelInstallation() {
    if (activeInstallationId === null) {
      return;
    }

    setError("");

    try {
      const response = await fetch(`${BASE_URL}/api/installations/${activeInstallationId}/cancel/`, {
        method: "POST",
      });

      const data = await parseJsonResponse<{
        message?: string;
        installation?: InstallationDetailResponse;
      }>(response);

      if (!response.ok || !data.installation) {
        throw new Error(data.message || "Cancellation failed.");
      }

      setResult(buildResultFromInstallation(data.installation));
      setResumeCandidate(null);
      persistDismissedInstallationId(null);
      clearLiveInstallationState();
      await refreshOperationalData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancellation failed.");
    }
  }

  async function handleClearHistory() {
    setClearingHistory(true);
    setError("");

    try {
      const response = await fetch(`${BASE_URL}/api/installations/clear-history/`, {
        method: "POST",
      });

      const data = await parseJsonResponse<{
        message?: string;
        deleted_count?: number;
      }>(response);

      if (!response.ok) {
        throw new Error(data.message || "Failed to clear installation history.");
      }

      await refreshOperationalData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear installation history.");
    } finally {
      setClearingHistory(false);
    }
  }

  async function handleDeleteHistoryInstallation(installationId: number) {
    setDeletingHistoryInstallationId(installationId);
    setError("");

    try {
      const response = await fetch(`${BASE_URL}/api/installations/${installationId}/`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await parseJsonResponse<{ message?: string }>(response);
        throw new Error(data.message || "Failed to delete installation history item.");
      }

      await refreshOperationalData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete installation history item.");
    } finally {
      setDeletingHistoryInstallationId(null);
    }
  }

  async function handleResumeCandidate() {
    if (!resumeCandidate) {
      return;
    }

    persistDismissedInstallationId(null);
    await resumeInstallationMonitoring(resumeCandidate.id);
  }

  function handleDismissResumeCandidate() {
    if (!resumeCandidate) {
      return;
    }

    persistDismissedInstallationId(resumeCandidate.id);
    persistActiveInstallationId(null);
    setResumeCandidate(null);
  }

  const historyPanel = (
    <Card className="console-panel" padding="lg">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <div>
            <Title order={3}>Installation History</Title>
            <Text size="sm" c="dimmed" mt={4}>
              Stored runs are kept outside the live monitor and can be deleted permanently from here.
            </Text>
          </div>
          <Group gap="sm">
            <Badge color="red" variant="light">
              saved {historyInstallations.length}
            </Badge>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={() => void handleClearHistory()}
              loading={clearingHistory}
              disabled={historyInstallations.length === 0}
            >
              Delete All History
            </Button>
          </Group>
        </Group>

        {historyInstallations.length === 0 ? (
          <Alert color="gray" variant="light">
            No saved installation history remains.
          </Alert>
        ) : (
          <ScrollArea.Autosize mah={mode === "history" ? 640 : 460}>
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Template</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Phase</Table.Th>
                  <Table.Th>Progress</Table.Th>
                  <Table.Th>Targets</Table.Th>
                  <Table.Th>Duration</Table.Th>
                  <Table.Th>Action</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {historyInstallations.map((installation) => {
                  const cleanupSystem = getInstallationCleanupSystem(installation);
                  const requiresDifferentSystemCleanup = Boolean(
                    cleanupSystem && cleanupSystem !== installation.template_system_type
                  );
                  const hasRegisteredCleanup = Boolean(
                    cleanupSystem &&
                      cleanupTemplatesBySystem[cleanupSystem] &&
                      Object.keys(cleanupTemplatesBySystem[cleanupSystem] || {}).length > 0
                  );

                  return (
                  <Table.Tr key={installation.id}>
                    <Table.Td>{installation.id}</Table.Td>
                    <Table.Td>{installation.template_name}</Table.Td>
                    <Table.Td>
                      <Badge color={getStatusColor(installation.status)} variant="light">
                        {installation.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatPhaseLabel(installation.phase)}</Table.Td>
                    <Table.Td>{installation.progress}%</Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Badge color="gray" variant="light">
                          total {installation.targets.length}
                        </Badge>
                        <Badge color="teal" variant="light">
                          ok {installation.targets.filter((target) => target.status === "success").length}
                        </Badge>
                        <Badge color="red" variant="light">
                          failed {installation.targets.filter((target) => target.status === "failed").length}
                        </Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>{formatDurationDetailed(installation.duration_seconds)}</Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        {installation.deployment_type !== "cleanup" &&
                          installation.targets.length > 0 &&
                          hasRegisteredCleanup && (
                            <Button
                              size="xs"
                              color={requiresDifferentSystemCleanup ? "red" : "orange"}
                              variant="light"
                              disabled={loading}
                              onClick={() => void handleInstallationCleanupLaunch(installation)}
                            >
                              {requiresDifferentSystemCleanup ? `Cleanup ${getInstallerOption(cleanupSystem).label}` : "Cleanup"}
                            </Button>
                          )}
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          leftSection={<IconTrash size={14} />}
                          loading={deletingHistoryInstallationId === installation.id}
                          onClick={() => void handleDeleteHistoryInstallation(installation.id)}
                        >
                          Delete
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        )}
      </Stack>
    </Card>
  );

  return (
    <Container size="xl" px={0}>
      <Stack gap="lg">
        <Card className="console-panel" padding="lg">
          <Group justify="space-between" align="center">
            <div>
              <Group gap="sm" mb={6}>
                {mode === "execution" ? (
                  <>
                    <ThemeIcon color="red" variant="light" size="lg" radius="md">
                      <IconTerminal2 size={18} />
                    </ThemeIcon>
                    <Title order={2}>{pageTitle}</Title>
                  </>
                ) : (
                  <Title order={2}>
                    <InstallerLabel
                      label={pageTitle}
                      withLogo
                      installerId={forcedInstaller ?? selectedInstaller}
                      className="page-installer-heading"
                    />
                  </Title>
                )}
              </Group>
              <Text c="dimmed" mt={4}>
                {pageDescription}
              </Text>
            </div>
            <Group>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={() => void refreshOperationalData()}
              >
                Refresh
              </Button>
              {showHistoryButton && (
                <Button
                  variant={showHistory ? "filled" : "default"}
                  color="red"
                  leftSection={showHistory ? <IconChevronUp size={16} /> : <IconHistory size={16} />}
                  onClick={() => setShowHistory(true)}
                >
                  {showHistory ? "History Open" : `History (${historyInstallations.length})`}
                </Button>
              )}
            </Group>
          </Group>
        </Card>

        {showDashboardSummary && dashboard && (
          <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md">
            <Card className="console-panel" padding="md">
              <Text c="dimmed" size="sm">Hosts</Text>
              <Title order={3}>{dashboard.hosts.total}</Title>
              <Text size="sm" c="dimmed">
                enabled {dashboard.hosts.enabled} | cp {dashboard.hosts.control_plane} | workers {dashboard.hosts.worker}
              </Text>
              <Text size="sm" c="dimmed">
                installer-ready inventory overview
              </Text>
            </Card>
            <Card className="console-panel" padding="md">
              <Text c="dimmed" size="sm">Credentials</Text>
              <Title order={3}>{dashboard.credentials.total}</Title>
              <Text size="sm" c="dimmed">
                password {dashboard.credentials.password} | ssh key {dashboard.credentials.ssh_key}
              </Text>
            </Card>
            <Card className="console-panel" padding="md">
              <Text c="dimmed" size="sm">Installations</Text>
              <Title order={3}>{dashboard.installations.total}</Title>
              <Text size="sm" c="dimmed">
                success {dashboard.installations.success} | failed {dashboard.installations.failed} | cancelled {dashboard.installations.cancelled ?? 0}
              </Text>
            </Card>
            <Card className="console-panel" padding="md">
              <Text c="dimmed" size="sm">Active Queue</Text>
              <Title order={3}>{dashboard.installations.running + dashboard.installations.pending}</Title>
              <Text size="sm" c="dimmed">
                running {dashboard.installations.running} | pending {dashboard.installations.pending}
              </Text>
            </Card>
          </SimpleGrid>
        )}

        {error && (
          <Alert color="red" title="Error" variant="light">
            {error}
          </Alert>
        )}

        {showResumeAlert && resumeCandidate && !loading && (
          <Alert color="yellow" title="Active installation detected" variant="light" icon={<IconClockHour4 size={16} />}>
            <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
              <div>
                <Text fw={600}>
                  {resumeCandidate.template_name} is still marked {resumeCandidate.status} on the backend.
                </Text>
                <Text size="sm" c="dimmed" mt={4}>
                  Phase: {formatPhaseLabel(resumeCandidate.phase)} | installation #{resumeCandidate.id}
                  {resumeCandidate.updated_at ? ` | updated ${new Date(resumeCandidate.updated_at).toLocaleString()}` : ""}
                </Text>
              </div>
              <Group gap="xs">
                <Button color="red" size="xs" onClick={() => void handleResumeCandidate()}>
                  Resume monitor
                </Button>
                <Button variant="default" size="xs" onClick={handleDismissResumeCandidate}>
                  Dismiss
                </Button>
              </Group>
            </Group>
          </Alert>
        )}

        {showInstallerConfiguration && (
          <>
            {showInstallerChooser && (
              <Card className="console-panel" padding="lg">
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <div>
                      <Title order={3}>Choose Installer</Title>
                      <Text size="sm" c="dimmed" mt={4}>
                        Choose the system you want to install, then configure the required options and start the deployment.
                      </Text>
                    </div>
                    <Badge color="red" variant="light">
                      current: {selectedInstallerOption.label}
                    </Badge>
                  </Group>

                  <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
                    {installerOptions.map((installer) => {
                      const isSelected = installer.id === selectedInstaller;
                      const isAvailable = installer.availability === "available";

                      return (
                        <Card
                          key={installer.id}
                          className={`installer-card${isSelected ? " is-selected" : ""}${!isAvailable ? " is-disabled" : ""}`}
                          padding="md"
                          onClick={() => {
                            if (isAvailable) {
                              setSelectedInstaller(installer.id);
                            }
                          }}
                        >
                          <Stack gap="xs">
                            <Group justify="space-between" align="flex-start">
                              <div>
                                <Text fw={700}>
                                  <InstallerLabel
                                    label={installer.label}
                                    withLogo={installer.id === "kubernetes" || installer.id === "k3s"}
                                    installerId={installer.id}
                                  />
                                </Text>
                                <Text size="sm" c="dimmed" mt={4}>
                                  {installer.description}
                                </Text>
                              </div>
                              <Badge
                                color={isAvailable ? "teal" : "gray"}
                                variant={isSelected ? "filled" : "light"}
                              >
                                {isAvailable ? "available" : "coming soon"}
                              </Badge>
                            </Group>
                          </Stack>
                        </Card>
                      );
                    })}
                  </SimpleGrid>
                </Stack>
              </Card>
            )}

            <Card className="console-panel" padding="lg">
              <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Title order={3}>Deployment Flow</Title>
                    <Text size="sm" c="dimmed" mt={4}>
                      This page only keeps the controls that matter for the active workflow. Host access stays managed from the Hosts inventory.
                    </Text>
                  </div>
                  <Badge color="red" variant="light">
                    single-node per target
                  </Badge>
                </Group>

                <div className="workflow-grid">
                  {installerWorkflowSteps.map((step, index) => (
                    <div key={step.title} className="workflow-step-card">
                      <div className="workflow-step-index">{index + 1}</div>
                      <Text fw={700}>{step.title}</Text>
                      <Text size="sm" c="dimmed" mt={6}>
                        {step.detail}
                      </Text>
                    </div>
                  ))}
                </div>

                <SimpleGrid cols={{ base: 1, md: 4 }} spacing="sm">
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Installer</Text>
                    <Text fw={700}>{selectedInstallerOption.label}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Selected Hosts</Text>
                    <Text fw={700}>{selectedHostIds.length}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Control Plane Nodes</Text>
                    <Text fw={700}>{plannedControlPlaneCount}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Worker Nodes</Text>
                    <Text fw={700}>{plannedWorkerCount}</Text>
                  </Card>
                </SimpleGrid>

                {selectedHostIds.length > 0 && (
                  <Alert color="blue" variant="light" title="Execution mode">
                    Every selected host will receive an independent {selectedInstallerOption.label} single-node deployment.
                  </Alert>
                )}
              </Stack>
            </Card>

            <Card className="console-panel" padding="lg">
              <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                  <Group gap="sm">
                    <ThemeIcon color="red" variant="light">
                      <IconPlugConnected size={16} />
                    </ThemeIcon>
                    <div>
                      <Title order={3}>Select Hosts</Title>
                      <Text size="sm" c="dimmed" mt={4}>
                        Choose one or more enabled targets from the inventory. SSH user and port are taken directly from the host record.
                      </Text>
                    </div>
                  </Group>
                  <Badge color="gray" variant="light">
                    hosts inventory
                  </Badge>
                </Group>

                {hosts.filter((host) => host.enabled).length === 0 ? (
                  <Text c="dimmed">No enabled hosts are available. Add or enable a host before launching an installation.</Text>
                ) : (
                  <div className="host-selection-grid">
                    {hosts
                      .filter((host) => host.enabled)
                      .map((host) => {
                        const isSelected = selectedHostIds.includes(host.id);

                        return (
                          <div
                            key={host.id}
                            className={`host-selection-card${isSelected ? " is-selected" : ""}`}
                            onClick={() => toggleHost(host.id, !isSelected)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleHost(host.id, !isSelected);
                              }
                            }}
                          >
                            <Group justify="space-between" align="flex-start">
                              <div>
                                <Text fw={700}>{host.name}</Text>
                                <Text size="sm" c="dimmed" mt={4}>
                                  {host.ip_address}
                                </Text>
                              </div>
                              <Badge color={isSelected ? "red" : "gray"} variant={isSelected ? "filled" : "light"}>
                                {isSelected ? "selected" : "available"}
                              </Badge>
                            </Group>

                            <div className="host-selection-metrics">
                              <div className="host-selection-metric">
                                <Text size="xs" c="dimmed">SSH User</Text>
                                <Text fw={700}>{host.credential_username || "-"}</Text>
                              </div>
                              <div className="host-selection-metric">
                                <Text size="xs" c="dimmed">SSH Port</Text>
                                <Text fw={700}>{host.ssh_port}</Text>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </Stack>
            </Card>

            <Card className="console-panel" padding="lg">
              <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Title order={3}>Execution Readiness</Title>
                    <Text size="sm" c="dimmed" mt={4}>
                      Review the selected targets, verify SSH access, then launch the installer on all of them.
                    </Text>
                  </div>
                  <Badge color={selectedHostIds.length > 0 ? "teal" : "gray"} variant="light">
                    {selectedHostIds.length > 0 ? "ready to verify" : "target required"}
                  </Badge>
                </Group>

                <div className="action-command-grid">
                  <div className="action-command-panel">
                    <Stack gap="md">
                      <Title order={4}>Current Targets</Title>

                      {selectedHostIds.length > 0 ? (
                        <>
                          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                            <Card className="host-panel" padding="sm">
                              <Text size="sm" c="dimmed">Selected Hosts</Text>
                              <Text fw={700}>{selectedHostIds.length}</Text>
                            </Card>
                            <Card className="host-panel" padding="sm">
                              <Text size="sm" c="dimmed">Execution Model</Text>
                              <Text fw={700}>Independent single-node run on each selected host</Text>
                            </Card>
                          </SimpleGrid>

                          <Alert color="blue" variant="light">
                            The playbook will run on every selected target in the generated inventory. Host access settings remain managed from the Hosts inventory.
                          </Alert>
                        </>
                      ) : (
                        <Text c="dimmed">Select at least one host to unlock SSH verification and playbook execution.</Text>
                      )}
                    </Stack>
                  </div>

                  <div className="action-command-panel">
                    <Stack gap="md">
                      <Title order={4}>Operator Checklist</Title>
                      <div className="action-checklist">
                        <div className="action-check-item">
                          <ThemeIcon color="red" variant="light" radius="xl" size={26}>
                            <IconLink size={14} />
                          </ThemeIcon>
                          <div>
                            <Text fw={700}>Run Verify SSH first</Text>
                            <Text size="sm" c="dimmed">
                              Confirm connectivity before any playbook execution starts.
                            </Text>
                          </div>
                        </div>
                        <div className="action-check-item">
                          <ThemeIcon color="red" variant="light" radius="xl" size={26}>
                            <IconPlayerPlay size={14} />
                          </ThemeIcon>
                          <div>
                            <Text fw={700}>Run Playbook after access validation</Text>
                            <Text size="sm" c="dimmed">
                              The execution monitor below captures the live Ansible state, timings, and final result.
                            </Text>
                          </div>
                        </div>
                        <div className="action-check-item">
                          <ThemeIcon color="orange" variant="light" radius="xl" size={26}>
                            <IconRefresh size={14} />
                          </ThemeIcon>
                          <div>
                            <Text fw={700}>Use Cleanup Options when needed</Text>
                            <Text size="sm" c="dimmed">
                              Reset cluster state for a fast reinstall or fully uninstall the platform from the target host.
                            </Text>
                          </div>
                        </div>
                      </div>
                    </Stack>
                  </div>
                </div>

                <Group>
                  <Button
                    variant="default"
                    onClick={() => void runPrecheck(true)}
                    loading={checkingConnectivity}
                    disabled={selectedHostIds.length === 0 || loading}
                    leftSection={<IconLink size={16} />}
                  >
                    Verify SSH
                  </Button>

                  <Button
                    onClick={handleLaunch}
                    loading={loading}
                    disabled={
                      selectedHostIds.length === 0 ||
                      checkingConnectivity ||
                      (deploymentMode === "manual" && !selectedTemplateId)
                    }
                    leftSection={<IconPlayerPlay size={16} />}
                  >
                    Run Playbook
                  </Button>

                  {hasCleanupOption && (
                    <Button
                      color="orange"
                      variant="light"
                      onClick={() => void handleCleanupLaunch()}
                      disabled={selectedHostIds.length === 0 || checkingConnectivity || loading}
                    >
                      Cleanup Options
                    </Button>
                  )}

                  {loading && activeInstallationId !== null && (
                    <Button
                      color="red"
                      onClick={() => void handleCancelInstallation()}
                      leftSection={<IconPlayerStop size={16} />}
                    >
                      Cancel Installation
                    </Button>
                  )}
                </Group>
              </Stack>
            </Card>

          </>
        )}

        {showExecutionMonitoring && (loading || result) && (
          <DeploymentMonitor
            loading={loading}
            live={{
              status: liveStatus || undefined,
              phase: livePhase || undefined,
              title: liveExecutionTitle,
              summaryMessage: liveSummaryMessage,
              currentPlay: liveCurrentPlay,
              currentRole: liveCurrentRole,
              currentTask: liveCurrentTask,
              seenTasks: liveSeenTasks,
              completedTasks: liveCompletedTasks,
              progress,
              elapsedSeconds,
              installationId: activeInstallationId,
            }}
            result={result ? {
              status: result.status,
              message: result.message,
              durationSeconds: result.duration_seconds,
              installationId: result.installation_id,
            } : undefined}
            activeStage={activeStage}
            stages={pipelineStageMap}
            pipelineStageIndex={pipelineStageIndex}
          />
        )}

        {showExecutionMonitoring && result && (
          <Card className="console-panel" padding="lg">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Title order={3}>Execution Result</Title>
                <Badge
                  color={getStatusColor(result.status)}
                  variant="filled"
                  size="lg"
                >
                  {result.status}
                </Badge>
              </Group>

              <Text c="dimmed" size="sm">
                This section summarizes the last execution. Use the success or failure report window for host-by-host diagnostics and next actions.
              </Text>

              <Group gap="xl">
                <Text>Installation ID: {result.installation_id}</Text>
                <Text>Message: {result.message}</Text>
                <Text>Return code: {result.return_code ?? "-"}</Text>
                <Text>Execution Time: {formatDurationDetailed(result.duration_seconds)}</Text>
              </Group>

              {result.targets && result.targets.length > 0 && (
                <>
                  <SimpleGrid cols={{ base: 1, md: 4 }} spacing="sm">
                    <Card className="host-panel" padding="sm">
                      <Text size="sm" c="dimmed">Selected Targets</Text>
                      <Text fw={700}>{result.targets.length}</Text>
                    </Card>
                    <Card className="host-panel" padding="sm">
                      <Text size="sm" c="dimmed">Succeeded</Text>
                      <Text fw={700}>{resultTargetSummary.success || 0}</Text>
                    </Card>
                    <Card className="host-panel" padding="sm">
                      <Text size="sm" c="dimmed">Failed</Text>
                      <Text fw={700}>{resultTargetSummary.failed || 0}</Text>
                    </Card>
                    <Card className="host-panel" padding="sm">
                      <Text size="sm" c="dimmed">Other States</Text>
                      <Text fw={700}>
                        {(resultTargetSummary.pending || 0) + (resultTargetSummary.running || 0) + (resultTargetSummary.cancelled || 0)}
                      </Text>
                    </Card>
                  </SimpleGrid>

                  <Table withTableBorder striped>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Target</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Return Code</Table.Th>
                        <Table.Th>Detail</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.targets.map((target) => (
                        <Table.Tr key={target.id}>
                          <Table.Td>{target.host_name}</Table.Td>
                          <Table.Td>
                            <Badge color={getStatusColor(target.status)} variant="light">
                              {target.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td>{target.return_code ?? "-"}</Table.Td>
                          <Table.Td>{target.output || "-"}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </>
              )}

              {canCleanupResult && (
                <Group>
                  <Button color="red" variant="light" onClick={() => void handleResultCleanupLaunch()}>
                    Cleanup Options
                  </Button>
                  {canRetryFailedTargets && (
                    <Button variant="light" onClick={() => void handleRetryFailedTargets()}>
                      Retry Failed Targets Only
                    </Button>
                  )}
                </Group>
              )}

              {!canCleanupResult && canRetryFailedTargets && (
                <Group>
                  <Button variant="light" onClick={() => void handleRetryFailedTargets()}>
                    Retry Failed Targets Only
                  </Button>
                </Group>
              )}

              {result.timings && (
                <SimpleGrid cols={{ base: 1, md: 4 }} spacing="sm">
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Inventory</Text>
                    <Text fw={700}>{formatDurationDetailed(result.timings.inventory_build_seconds)}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Repo Discovery</Text>
                    <Text fw={700}>{formatDurationDetailed(result.timings.repo_discovery_seconds)}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">SSH Check</Text>
                    <Text fw={700}>{formatDurationDetailed(result.timings.ssh_check_seconds)}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Playbook</Text>
                    <Text fw={700}>{formatDurationDetailed(result.timings.playbook_execution_seconds)}</Text>
                  </Card>
                </SimpleGrid>
              )}

              {result.bottleneck_hints && result.bottleneck_hints.length > 0 && (
                <>
                  <Divider />
                  <Title order={5}>Likely Bottlenecks</Title>
                  <Stack gap="xs">
                    {result.bottleneck_hints.map((hint) => (
                      <Alert key={hint} color="red" variant="light" icon={<IconAlertCircle size={16} />}>
                        {hint}
                      </Alert>
                    ))}
                  </Stack>
                </>
              )}

              {result.task_profile && result.task_profile.length > 0 && (
                <>
                  <Divider />
                  <Title order={5}>Slowest Tasks</Title>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Task</Table.Th>
                        <Table.Th>Duration</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.task_profile.slice(0, 5).map((task) => (
                        <Table.Tr key={task.name}>
                          <Table.Td>{task.name}</Table.Td>
                          <Table.Td>{formatDurationDetailed(task.seconds)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </>
              )}

              {result.command && (
                <>
                  <Divider />
                  <Title order={5}>Command</Title>
                  <Code block>{result.command}</Code>
                </>
              )}

              {result.rawOutput && (
                <>
                  <Divider />
                  <Title order={5}>Raw Output</Title>
                  <ScrollArea.Autosize mah={220}>
                    <Code block>{result.rawOutput}</Code>
                  </ScrollArea.Autosize>
                </>
              )}

              {result.stdout && (
                <>
                  <Divider />
                  <Title order={5}>Stdout</Title>
                  <ScrollArea.Autosize mah={320}>
                    <Code block>{result.stdout}</Code>
                  </ScrollArea.Autosize>
                </>
              )}

              {result.stderr && (
                <>
                  <Divider />
                  <Title order={5}>Stderr</Title>
                  <ScrollArea.Autosize mah={220}>
                    <Code block>{result.stderr}</Code>
                  </ScrollArea.Autosize>
                </>
              )}
            </Stack>
          </Card>
        )}

        {showHistoryPage && historyPanel}

        {showHistoryButton && (
          <Modal
            opened={showHistory}
            onClose={() => setShowHistory(false)}
            title="Installation History"
            size="xl"
            centered
            classNames={{ content: "history-modal-content", header: "terminal-modal-header" }}
          >
            {historyPanel}
          </Modal>
        )}

        <Modal
          opened={Boolean(cleanupRequest)}
          onClose={() => setCleanupRequest(null)}
          title="Cleanup Options"
          size="md"
          centered
          classNames={{ content: "success-modal-content", header: "terminal-modal-header" }}
        >
          <Stack gap="lg">
            <div>
              <Title order={3}>{cleanupRequest?.title || "Cleanup Options"}</Title>
              <Text c="dimmed" size="sm" mt={6}>
                Choose how much of the selected target system state should be removed.
              </Text>
            </div>

            {cleanupRequestTemplates.reset && (
              <Card className="host-panel" padding="md">
                <Stack gap="xs">
                  <Group justify="space-between" align="center">
                    <Text fw={700}>Reset Cluster</Text>
                    {cleanupRequest?.purpose !== "platform_switch" && (
                      <Badge color="yellow" variant="light">Recommended</Badge>
                    )}
                  </Group>
                  <Text size="sm" c="dimmed">
                    Removes cluster state and CNI artifacts, but keeps installed packages for a faster reinstall of the same platform.
                  </Text>
                  <Button
                    color="orange"
                    variant="light"
                    onClick={() => void (cleanupRequest ? launchCleanupRequest(cleanupRequest, "reset") : Promise.resolve())}
                    disabled={loading}
                  >
                    Reset Cluster
                  </Button>
                </Stack>
              </Card>
            )}

            {cleanupRequestTemplates.full_uninstall && (
              <Card className="host-panel" padding="md">
                <Stack gap="xs">
                  <Group justify="space-between" align="center">
                    <Text fw={700}>Full Uninstall</Text>
                    {cleanupRequest?.purpose === "platform_switch" && (
                      <Badge color="red" variant="light">Recommended for platform switch</Badge>
                    )}
                  </Group>
                  <Text size="sm" c="dimmed">
                    Removes the cluster state and uninstalls the platform packages from the selected target hosts.
                  </Text>
                  <Button
                    color="red"
                    variant="light"
                    onClick={() => void (cleanupRequest ? launchCleanupRequest(cleanupRequest, "full_uninstall") : Promise.resolve())}
                    disabled={loading}
                  >
                    Full Uninstall
                  </Button>
                </Stack>
              </Card>
            )}

            {!cleanupRequestTemplates.reset && !cleanupRequestTemplates.full_uninstall && (
              <Alert color="red" variant="light">
                No cleanup template is registered for this installer.
              </Alert>
            )}
          </Stack>
        </Modal>

        {mode !== "history" && (
        <Modal
          opened={showSshSuccessModal}
          onClose={() => setShowSshSuccessModal(false)}
          title="SSH Verification Report"
          size="72rem"
          centered
          classNames={{ content: "success-modal-content", header: "terminal-modal-header" }}
        >
          <Stack gap="lg">
            <Stack gap="md" align="center" className="modal-status-hero">
              <ThemeIcon
                size={72}
                radius={18}
                color={precheckSucceeded ? "teal" : "red"}
                variant="light"
              >
                {precheckSucceeded ? <IconCheck size={42} /> : <IconAlertCircle size={42} />}
              </ThemeIcon>
              <div>
                <Title order={2}>
                  {getPrecheckPresentation(precheckResult).title}
                </Title>
                <Text c="dimmed" size="sm" mt={4}>
                  {getPrecheckPresentation(precheckResult).summary}
                </Text>
              </div>
            </Stack>

            <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md" className="modal-summary-grid">
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Selected Hosts</Text>
                <Text fw={700}>{precheckResult?.summary?.selected_hosts ?? 0}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Reachable Hosts</Text>
                <Text fw={700}>{precheckResult?.summary?.reachable_hosts ?? 0}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Failed Hosts</Text>
                <Text fw={700}>{precheckResult?.summary?.failed_hosts ?? 0}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">SSH Check Duration</Text>
                <Text fw={700}>{formatDurationDetailed(precheckResult?.timings?.ssh_check_seconds)}</Text>
              </Card>
            </SimpleGrid>

            <Alert color={getPrecheckPresentation(precheckResult).color} variant="light" title="Operational next step">
              {getPrecheckPresentation(precheckResult).recommendation}
            </Alert>

            {precheckResult?.connectivity && precheckResult.connectivity.length > 0 && (
              <Stack gap="sm">
                <div>
                  <Title order={4}>Host Connectivity Summary</Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    Review each selected host below before launching the installer.
                  </Text>
                </div>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  {precheckResult.connectivity.map((item) => (
                    <Card key={item.host} className="host-panel target-result-card" padding="lg">
                      <Stack gap="md">
                        <Group justify="space-between" align="center">
                          <Text fw={700}>{item.host}</Text>
                          <Badge color={getStatusColor(item.status)} variant="light">
                            {item.status}
                          </Badge>
                        </Group>
                        <Alert color={getStatusColor(item.status)} variant="light">
                          {item.detail}
                        </Alert>
                        <div className="target-output-panel">
                          <Text fw={600} mb="sm">
                            Recommended action
                          </Text>
                          <Text size="sm">{getConnectivityOperatorAction(item)}</Text>
                        </div>
                      </Stack>
                    </Card>
                  ))}
                </SimpleGrid>
              </Stack>
            )}

            <Group justify="flex-end">
              <Button onClick={() => setShowSshSuccessModal(false)}>
                {precheckSucceeded ? "Continue" : "Close"}
              </Button>
            </Group>
          </Stack>
        </Modal>
        )}

        {mode !== "history" && (
        <Modal
          opened={showPlatformConflictModal}
          onClose={() => setShowPlatformConflictModal(false)}
          title={`Action required before ${blockedInstallerLabel} installation`}
          size="64rem"
          centered
          closeOnClickOutside={false}
          classNames={{ content: "failure-modal-content", header: "terminal-modal-header" }}
        >
          <Stack gap="lg">
            <Stack gap="md" align="center" className="modal-status-hero">
              <div className="success-logo-shell">
                <img
                  src={getInstallerLogo(conflictCleanupSystem)}
                  alt={`${conflictCleanupLabel} logo`}
                  className="success-logo"
                />
              </div>
              <div>
                <Title order={2}>{conflictCleanupLabel} is already installed</Title>
                <Text c="dimmed" size="sm" mt={4}>
                  {blockedInstallerLabel} cannot safely share this target with the existing {conflictCleanupLabel} cluster.
                </Text>
              </div>
            </Stack>

            <Alert
              color="yellow"
              variant="light"
              icon={<IconAlertCircle size={18} />}
              title={`${blockedInstallerLabel} installation was safely stopped`}
            >
              No {blockedInstallerLabel} system changes were applied to the affected targets. Cleanup {conflictCleanupLabel} first,
              then retry the {blockedInstallerLabel} installation.
            </Alert>

            {result?.status === "partial_success" && (
              <Alert color="teal" variant="light" icon={<IconCheck size={18} />}>
                {blockedInstallerLabel} completed on {succeededResultTargets.length} other target(s). Cleanup will
                run only on the targets listed below.
              </Alert>
            )}

            <div>
              <Title order={4}>Targets requiring {conflictCleanupLabel} cleanup</Title>
              <Text size="sm" c="dimmed" mt={4}>
                {platformConflictTargets.length} target(s) are blocked by an existing {conflictCleanupLabel} installation.
              </Text>
            </div>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              {platformConflictTargets.map((target) => (
                <Card key={`platform-conflict-${target.id}`} className="host-panel target-result-card" padding="lg">
                  <Stack gap="sm">
                    <Group justify="space-between" align="center">
                      <Text fw={700}>{target.host_name}</Text>
                      <Badge color="yellow" variant="light">{conflictCleanupLabel} detected</Badge>
                    </Group>
                    <Text size="sm">
                      {target.operator_issue?.detail ||
                        `An existing ${conflictCleanupLabel} installation is preventing a safe ${blockedInstallerLabel} deployment.`}
                    </Text>
                    {Boolean(target.operator_issue?.artifacts?.length) && (
                      <div className="target-output-panel">
                        <Text size="sm" fw={600} mb="xs">Detected {conflictCleanupLabel} artifacts</Text>
                        <Stack gap={4}>
                          {target.operator_issue?.artifacts?.map((artifact) => (
                            <Code key={`${target.id}-${artifact}`} block>{artifact}</Code>
                          ))}
                        </Stack>
                      </div>
                    )}
                    <Text size="sm" c="dimmed">
                      {target.operator_issue?.recommended_action}
                    </Text>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>

            <Alert color="red" variant="light" title="Cleanup impact">
              The next step opens the registered {conflictCleanupLabel} cleanup options and explains
              what will be removed. Cleanup starts only after your confirmation.
            </Alert>

            <Group justify="space-between" align="center" wrap="wrap">
              <Button
                variant="subtle"
                onClick={() => {
                  setShowPlatformConflictModal(false);
                  setShowFailureModal(true);
                }}
              >
                View full deployment report
              </Button>
              <Group>
                <Button variant="default" onClick={() => setShowPlatformConflictModal(false)}>
                  Close
                </Button>
                <Button
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={handlePlatformConflictCleanupLaunch}
                  disabled={!hasConflictCleanupOption}
                >
                  Cleanup {conflictCleanupLabel}
                </Button>
              </Group>
            </Group>
          </Stack>
        </Modal>
        )}

        {mode !== "history" && (
        <Modal
          opened={showSuccessModal}
          onClose={() => setShowSuccessModal(false)}
          title={isCleanupExecution ? "Cleanup Report" : "Deployment Report"}
          size="78rem"
          centered
          classNames={{ content: "success-modal-content", header: "terminal-modal-header" }}
        >
          <Stack gap="lg">
            <Stack gap="md" align="center" className="modal-status-hero">
              <div className="success-logo-shell">
                <img
                  src={getInstallerLogo(activeInstallerSystem)}
                  alt={`${activeInstallerLabel} logo`}
                  className="success-logo"
                />
              </div>
              <div>
                <Title order={2}>{getExecutionPresentation(result?.status, isCleanupExecution, activeInstallerLabel).title}</Title>
                <Text c="dimmed" size="sm" mt={4}>
                  {isCleanupExecution ? (
                    <>
                      <InstallerLabel
                        label={activeInstallerSystem === "k3s" ? "K3s" : "Kubernetes"}
                        withLogo
                        installerId={activeInstallerSystem}
                      />{" "}
                      state was removed successfully from the selected targets.
                    </>
                  ) : activeInstallerSystem === "kubernetes" ? (
                    <>
                      <InstallerLabel label="Kubernetes" withLogo installerId="kubernetes" /> completed successfully and the selected nodes should now be ready for validation.
                    </>
                  ) : activeInstallerSystem === "k3s" ? (
                    <>
                      <InstallerLabel label="K3s" withLogo installerId="k3s" /> completed successfully and the selected nodes should now be ready for validation.
                    </>
                  ) : (
                    `${activeInstallerLabel} completed successfully and the selected nodes should now be ready for validation.`
                  )}
                </Text>
              </div>
            </Stack>

            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" className="modal-summary-grid">
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">{isCleanupExecution ? "Operation" : "Cluster Name"}</Text>
                <Text fw={700}>{isCleanupExecution ? "Cluster cleanup" : result?.cluster_config?.cluster_name || clusterConfig.cluster_name}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Template</Text>
                <Text fw={700}>
                  <InstallerLabel
                    label={
                      result?.template_name ||
                      (isCleanupExecution
                        ? activeInstallerSystem === "k3s"
                          ? "K3s cleanup"
                          : "Kubernetes cleanup"
                        : activeInstallerSystem === "k3s"
                          ? "K3s single node"
                          : "Kubernetes single node")
                    }
                    withLogo={activeInstallerSystem === "kubernetes" || activeInstallerSystem === "k3s"}
                    installerId={activeInstallerSystem}
                  />
                </Text>
              </Card>
              {isCleanupExecution ? (
                <Card className="host-panel" padding="sm">
                  <Text size="sm" c="dimmed">Target Machines</Text>
                  <Text fw={700}>{clusterTargetHosts.length}</Text>
                </Card>
              ) : (
                <>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Control Plane Nodes</Text>
                    <Text fw={700}>{result?.cluster_config?.control_plane_count ?? clusterControlPlaneCount}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Worker Nodes</Text>
                    <Text fw={700}>{result?.cluster_config?.worker_count ?? clusterWorkerCount}</Text>
                  </Card>
                </>
              )}
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" className="modal-summary-grid">
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">{isCleanupExecution ? "Result" : "Cluster Topology"}</Text>
                <Text fw={700}>{clusterTopologyLabel}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Target Machines</Text>
                <Text fw={700}>{clusterTargetHosts.length}</Text>
              </Card>
              {!isCleanupExecution && (
                <Card className="host-panel" padding="sm">
                  <Text size="sm" c="dimmed">Primary Control Plane</Text>
                  <Text fw={700}>{clusterTargetHosts[0] || "-"}</Text>
                </Card>
              )}
            </SimpleGrid>

            <Card className="host-panel" padding="sm">
              <Text size="sm" c="dimmed">Target Hostnames</Text>
              <Text fw={700}>{clusterTargetHosts.join(", ") || "-"}</Text>
            </Card>

            {result?.targets && result.targets.length > 0 && (
              <Stack gap="sm">
                <div>
                  <Title order={4}>{isCleanupExecution ? "Processed Targets" : "Installed Targets"}</Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    Review each target independently. Validation commands and captured playbook output are grouped per machine.
                  </Text>
                </div>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  {result.targets.map((target) => (
                    <Card key={`result-success-${target.id}`} className="host-panel target-result-card" padding="lg">
                      <Stack gap="md">
                        <Group justify="space-between" align="center">
                          <Text fw={700}>{target.host_name}</Text>
                          <Badge color={getStatusColor(target.status)} variant="light">
                            {target.status}
                          </Badge>
                        </Group>
                        <SimpleGrid cols={2} spacing="sm" className="target-result-metrics">
                          <div>
                            <Text size="sm" c="dimmed">Return Code</Text>
                            <Text fw={700}>{target.return_code ?? 0}</Text>
                          </div>
                          <div>
                            <Text size="sm" c="dimmed">Result</Text>
                            <Text fw={700}>
                              {isCleanupExecution ? "Cleanup completed" : `${activeInstallerLabel} installed`}
                            </Text>
                          </div>
                        </SimpleGrid>
                        <Alert color={isCleanupExecution ? "yellow" : "teal"} variant="light">
                          {target.output || (isCleanupExecution ? "Cleanup completed on this target." : "Installation completed on this target.")}
                        </Alert>
                        <Alert color={isCleanupExecution ? "yellow" : "teal"} variant="light" title="Recommended action">
                          {isCleanupExecution
                            ? "Run the cleanup validation checks on this host to confirm that cluster state was removed."
                            : getTargetOperatorAction(target)}
                        </Alert>
                        <div className="success-checks-panel">
                          <Text fw={600} mb="sm">
                            Checks to run on {target.host_name}
                          </Text>
                          <Stack gap="xs">
                            {postInstallChecks.map((command) => (
                              <Code key={`success-${target.id}-${command}`} block>
                                {command}
                              </Code>
                            ))}
                          </Stack>
                        </div>
                        <div className="target-output-panel">
                          <Text fw={600} mb="sm">
                            Captured Playbook Output
                          </Text>
                          <ScrollArea.Autosize mah={220}>
                            <Code block>{extractTargetDiagnostics(target)}</Code>
                          </ScrollArea.Autosize>
                        </div>
                      </Stack>
                    </Card>
                  ))}
                </SimpleGrid>
              </Stack>
            )}

            <Alert color={isCleanupExecution ? "yellow" : "teal"} variant="light" title="Operational next step">
              {getExecutionPresentation(result?.status, isCleanupExecution, activeInstallerLabel).recommendation}
            </Alert>

            <Group gap="xl">
              <Text>Installation ID: {result?.installation_id ?? "-"}</Text>
              <Text>Duration: {formatDurationDetailed(result?.duration_seconds)}</Text>
            </Group>

            {canCleanupResult && (
              <Group>
                <Button color="red" onClick={() => void handleResultCleanupLaunch()}>
                  Cleanup Options
                </Button>
              </Group>
            )}
          </Stack>
        </Modal>
        )}

        {mode !== "history" && (
        <Modal
          opened={showFailureModal}
          onClose={() => setShowFailureModal(false)}
          title="Deployment Report"
          size="78rem"
          centered
          classNames={{ content: "failure-modal-content", header: "terminal-modal-header" }}
        >
          <Stack gap="lg">
            <Stack gap="md" align="center" className="modal-status-hero">
              <ThemeIcon
                size={72}
                radius={18}
                color={result?.status === "partial_success" ? "yellow" : "red"}
                variant="light"
              >
                <IconAlertCircle size={42} />
              </ThemeIcon>
              <div>
                <Title order={2}>
                  {getExecutionPresentation(result?.status, false, activeInstallerLabel).title}
                </Title>
                <Text c="dimmed" size="sm" mt={4}>
                  {getExecutionPresentation(result?.status, false, activeInstallerLabel).summary}
                </Text>
              </div>
            </Stack>

            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" className="modal-summary-grid">
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Installation ID</Text>
                <Text fw={700}>{result?.installation_id || "-"}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Status</Text>
                <Text fw={700}>{result?.status || "-"}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Return Code</Text>
                <Text fw={700}>{result?.return_code ?? "-"}</Text>
              </Card>
            </SimpleGrid>

            <Alert
              color={result?.status === "partial_success" ? "yellow" : "red"}
              variant="light"
              icon={<IconAlertCircle size={16} />}
              title="Execution summary"
            >
              {result?.message || "The backend reported a failed installation."}
            </Alert>

            {result?.status === "partial_success" && (
              <Alert color="teal" variant="light" icon={<IconCheck size={16} />}>
                The workflow continued on reachable and eligible targets. Review the failed targets below, then retry only those hosts if needed.
              </Alert>
            )}

            {result?.targets && result.targets.length > 0 && (
              <>
                <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md" className="modal-summary-grid">
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Selected Targets</Text>
                    <Text fw={700}>{result.targets.length}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Succeeded</Text>
                    <Text fw={700}>{resultTargetSummary.success || 0}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Failed</Text>
                    <Text fw={700}>{resultTargetSummary.failed || 0}</Text>
                  </Card>
                  <Card className="host-panel" padding="sm">
                    <Text size="sm" c="dimmed">Other States</Text>
                    <Text fw={700}>
                      {(resultTargetSummary.pending || 0) + (resultTargetSummary.running || 0) + (resultTargetSummary.cancelled || 0)}
                    </Text>
                  </Card>
                </SimpleGrid>

                <Table withTableBorder striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Target</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Return Code</Table.Th>
                      <Table.Th>Detail</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {result.targets.map((target) => (
                      <Table.Tr key={target.id}>
                        <Table.Td>{target.host_name}</Table.Td>
                        <Table.Td>
                          <Badge color={getStatusColor(target.status)} variant="light">
                            {target.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{target.return_code ?? "-"}</Table.Td>
                        <Table.Td>{target.output || "-"}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </>
            )}

            {failedResultTargets.length > 0 && (
              <Stack gap="sm">
                <div>
                  <Title order={4}>Failed Targets</Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    These hosts did not complete the installation. Each one needs correction before retry.
                  </Text>
                </div>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  {failedResultTargets.map((target) => (
                    <Card key={`failed-${target.id}`} className="host-panel target-result-card" padding="lg">
                      <Stack gap="md">
                        <Group justify="space-between" align="center">
                          <Text fw={700}>{target.host_name}</Text>
                          <Badge color="red" variant="light">failed</Badge>
                        </Group>
                        <SimpleGrid cols={2} spacing="sm" className="target-result-metrics">
                          <div>
                            <Text size="sm" c="dimmed">Return Code</Text>
                            <Text fw={700}>{target.return_code ?? "-"}</Text>
                          </div>
                          <div>
                            <Text size="sm" c="dimmed">Failure Type</Text>
                            <Text fw={700}>Execution blocked</Text>
                          </div>
                        </SimpleGrid>
                        <Alert color="red" variant="light">
                          {target.output || target.stderr || "No target-specific error detail was captured."}
                        </Alert>
                        <Alert color="red" variant="light" icon={<IconAlertCircle size={14} />} title="Recommended action">
                          {getTargetOperatorAction(target)}
                        </Alert>
                        <div className="target-output-panel">
                          <Text fw={600} mb="sm">
                            Captured Playbook Output
                          </Text>
                          <ScrollArea.Autosize mah={220}>
                            <Code block>{extractTargetDiagnostics(target)}</Code>
                          </ScrollArea.Autosize>
                        </div>
                      </Stack>
                    </Card>
                  ))}
                </SimpleGrid>
              </Stack>
            )}

            {succeededResultTargets.length > 0 && (
              <Stack gap="sm">
                <div>
                  <Title order={4}>Succeeded Targets</Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    These hosts completed the installation. Run the checks below on each successful target to confirm cluster health.
                  </Text>
                </div>
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                  {succeededResultTargets.map((target) => (
                    <Card key={`success-${target.id}`} className="host-panel target-result-card" padding="lg">
                      <Stack gap="md">
                        <Group justify="space-between" align="center">
                          <Text fw={700}>{target.host_name}</Text>
                          <Badge color="teal" variant="light">success</Badge>
                        </Group>
                        <SimpleGrid cols={2} spacing="sm" className="target-result-metrics">
                          <div>
                            <Text size="sm" c="dimmed">Return Code</Text>
                            <Text fw={700}>{target.return_code ?? 0}</Text>
                          </div>
                          <div>
                            <Text size="sm" c="dimmed">Result</Text>
                            <Text fw={700}>{activeInstallerLabel} ready</Text>
                          </div>
                        </SimpleGrid>
                        <Alert color="teal" variant="light">
                          {activeInstallerLabel} completed on this target. Validate the node and system services directly on the machine.
                        </Alert>
                        <div className="success-checks-panel">
                          <Text fw={600} mb="sm">
                            Checks to run on {target.host_name}
                          </Text>
                          <Stack gap="xs">
                            {postInstallChecks.map((command) => (
                              <Code key={`${target.id}-${command}`} block>
                                {command}
                              </Code>
                            ))}
                          </Stack>
                        </div>
                        <div className="target-output-panel">
                          <Text fw={600} mb="sm">
                            Captured Playbook Output
                          </Text>
                          <ScrollArea.Autosize mah={220}>
                            <Code block>{extractTargetDiagnostics(target)}</Code>
                          </ScrollArea.Autosize>
                        </div>
                      </Stack>
                    </Card>
                  ))}
                </SimpleGrid>
              </Stack>
            )}

            {canCleanupResult && (
              <Group>
                <Button color="red" onClick={() => void handleResultCleanupLaunch()}>
                  Cleanup Options
                </Button>
                {canRetryFailedTargets && (
                  <Button variant="light" onClick={() => void handleRetryFailedTargets()}>
                    Retry Failed Targets Only
                  </Button>
                )}
              </Group>
            )}

            {!canCleanupResult && canRetryFailedTargets && (
              <Group>
                <Button variant="light" onClick={() => void handleRetryFailedTargets()}>
                  Retry Failed Targets Only
                </Button>
              </Group>
            )}
          </Stack>
        </Modal>
        )}
      </Stack>
    </Container>
  );
}
