import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Container,
  Divider,
  Group,
  Modal,
  Progress,
  Radio,
  RingProgress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBinaryTree2,
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
import kubernetesLogo from "../assets/kubernetes-logo.svg";
import k3sLogo from "../assets/k3s-logo.png";

type Host = {
  id: number;
  name: string;
  ip_address: string;
  enabled: boolean;
  node_role: string;
  baseline_state: "unknown" | "fresh" | "prepared" | "initialized";
  last_detection_at?: string | null;
};

type Template = {
  id: number;
  name: string;
  system_type: "kubernetes" | "k3s" | "openshift_sno";
  playbook_path: string;
  description: string;
  deployment_type: "prepare_node" | "single_node";
};

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
  selected_strategy?: string;
  selected_playbook?: string;
  detected_hosts?: Array<{
    id: number;
    name: string;
    baseline_state: string;
    reachable: boolean;
  }>;
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
};

type InstallationDetailResponse = {
  id: number;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
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
  targets: InstallationTarget[];
};

type DashboardSummary = {
  hosts: {
    total: number;
    enabled: number;
    control_plane: number;
    worker: number;
    unknown?: number;
    fresh?: number;
    prepared?: number;
    initialized?: number;
  };
  credentials: {
    total: number;
    password: number;
    ssh_key: number;
  };
  installations: {
    total: number;
    success: number;
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
};

type Stage = {
  phase: string;
  label: string;
  detail: string;
};

type InstallerId = "kubernetes" | "k3s" | "openshift_sno";

type InstallerOption = {
  id: InstallerId;
  label: string;
  description: string;
  availability: "available" | "coming_soon";
};

const BASE_URL = import.meta.env.VITE_DJANGO_BASE_URL;
const ACTIVE_INSTALLATION_STORAGE_KEY = "auto-k8s-active-installation-id";
const DISMISSED_INSTALLATION_STORAGE_KEY = "auto-k8s-dismissed-installation-id";

const stageMap: Stage[] = [
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

const pipelineStageMap: Stage[] = stageMap.filter(
  (stage) => stage.phase !== "failed" && stage.phase !== "cancelled"
);

const installerOptions: InstallerOption[] = [
  {
    id: "kubernetes",
    label: "Kubernetes",
    description: "Single-node kubeadm workflow with host precheck, installer monitoring, and post-install validation.",
    availability: "available",
  },
  {
    id: "k3s",
    label: "K3s",
    description: "Lightweight Kubernetes distribution for smaller footprints and faster bootstrap.",
    availability: "available",
  },
  {
    id: "openshift_sno",
    label: "OpenShift SNO",
    description: "Single Node OpenShift workflow for edge and compact control-plane use cases.",
    availability: "coming_soon",
  },
];

async function parseApiResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return JSON.parse(rawText) as T;
  }

  const trimmed = rawText.trim();

  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
    throw new Error(
      "The backend returned an HTML error page instead of JSON. Run `python manage.py migrate` and restart the backend server."
    );
  }

  if (!trimmed) {
    return {} as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(trimmed);
  }
}

function getStatusColor(status?: string | null) {
  if (status === "success") {
    return "teal";
  }

  if (status === "failed") {
    return "red";
  }

  if (status === "cancelled") {
    return "yellow";
  }

  return "gray";
}

function formatDuration(seconds?: number | null) {
  if (seconds === undefined || seconds === null) {
    return "-";
  }

  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

function formatDurationDetailed(seconds?: number | null) {
  if (seconds === undefined || seconds === null) {
    return "-";
  }

  return `${formatDuration(seconds)} (${seconds.toFixed(3)}s)`;
}

function formatPhaseLabel(phase?: string) {
  const stage = stageMap.find((item) => item.phase === phase);
  return stage?.label ?? phase ?? "Unknown";
}

function isInstallationActive(installation?: InstallationDetailResponse | null) {
  return installation?.status === "pending" || installation?.status === "running";
}

function getInstallerLogo(installerId?: InstallerId | null) {
  if (installerId === "k3s") {
    return k3sLogo;
  }

  return kubernetesLogo;
}

function InstallerLabel({
  label,
  withLogo,
  installerId,
}: {
  label: string;
  withLogo?: boolean;
  installerId?: InstallerId | null;
}) {
  return (
    <span className="installer-label-inline">
      {withLogo && (
        <img
          src={getInstallerLogo(installerId)}
          alt=""
          className="template-logo-inline"
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
    </span>
  );
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
        : installation.status === "cancelled"
          ? "Installation cancelled by user."
          : "Playbook execution failed."),
    template_name: installation.template_name,
    template_system_type: installation.template_system_type,
    deployment_type: installation.deployment_type,
    target_hosts: installation.targets.map((target) => target.host_name),
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
  };
}

export default function RunDeployment() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [installations, setInstallations] = useState<InstallationDetailResponse[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<number[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedInstaller, setSelectedInstaller] = useState<InstallerId>("kubernetes");
  const [deploymentMode, setDeploymentMode] = useState<"auto" | "manual">("auto");
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showFailureModal, setShowFailureModal] = useState(false);
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
  const [liveCeleryState, setLiveCeleryState] = useState<string | null>(null);
  const [liveCurrentPlay, setLiveCurrentPlay] = useState<string>("");
  const [liveCurrentRole, setLiveCurrentRole] = useState<string>("");
  const [liveCurrentTask, setLiveCurrentTask] = useState<string>("");
  const [liveSeenTasks, setLiveSeenTasks] = useState<number>(0);
  const [liveCompletedTasks, setLiveCompletedTasks] = useState<number>(0);
  const [liveEvents, setLiveEvents] = useState<
    NonNullable<NonNullable<InstallationDetailResponse["celery_progress"]>["meta"]>["recent_events"]
  >([]);
  const [lastDetectedHosts, setLastDetectedHosts] = useState<
    NonNullable<LaunchQueuedResponse["detected_hosts"]>
  >([]);
  const [lastSelectedPlaybook, setLastSelectedPlaybook] = useState<string>("");
  const loadingStartedAtRef = useRef<number | null>(null);
  const lastSuccessModalInstallationIdRef = useRef<number | null>(null);

  const selectionSignature = useMemo(
    () => [...selectedHostIds].sort((a, b) => a - b).join(","),
    [selectedHostIds]
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => String(template.id) === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const selectedInstallerOption = useMemo(
    () => installerOptions.find((installer) => installer.id === selectedInstaller) || installerOptions[0],
    [selectedInstaller]
  );

  const historyInstallations = useMemo(
    () =>
      installations.filter(
        (installation) =>
          installation.status === "success" ||
          installation.status === "failed" ||
          installation.status === "cancelled"
      ),
    [installations]
  );

  const activeStage = useMemo(() => {
    return stageMap.find((stage) => stage.phase === livePhase) || stageMap[0];
  }, [livePhase]);

  const pipelinePhase = useMemo(() => {
    if (livePhase && livePhase !== "failed" && livePhase !== "cancelled") {
      return livePhase;
    }

    if (!loading && result?.status === "success") {
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

  const clusterTopologyLabel = useMemo(() => {
    if (result?.deployment_type === "single_node") {
      return activeInstallerSystem === "k3s"
        ? "Single-node K3s server with workload scheduling enabled"
        : "Single-node control plane with workload scheduling enabled";
    }
    return "Multi-node topology";
  }, [activeInstallerSystem, result]);

  const postInstallChecks = useMemo(
    () =>
      activeInstallerSystem === "k3s"
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
          ],
    [activeInstallerSystem]
  );

  async function fetchHosts() {
    const response = await fetch(`${BASE_URL}/api/hosts/`);
    if (!response.ok) {
      throw new Error("Failed to load hosts.");
    }

    setHosts(await parseApiResponse<Host[]>(response));
  }

  async function fetchTemplates(installer: InstallerId = selectedInstaller) {
    const response = await fetch(`${BASE_URL}/api/templates/?system_type=${installer}`);
    if (!response.ok) {
      throw new Error("Failed to load templates.");
    }

    const data = await parseApiResponse<Template[]>(response);
    setTemplates(data);
    if (data.length > 0 && (!selectedTemplateId || !data.some((template) => String(template.id) === selectedTemplateId))) {
      setSelectedTemplateId(String(data[0].id));
      return data;
    }

    if (data.length === 0) {
      setSelectedTemplateId("");
    }

    return data;
  }

  async function fetchDashboard() {
    const response = await fetch(`${BASE_URL}/api/dashboard/`);
    if (!response.ok) {
      throw new Error("Failed to load dashboard summary.");
    }

    const data = await parseApiResponse<DashboardSummary>(response);
    setDashboard(data);
    return data;
  }

  async function fetchInstallations() {
    const response = await fetch(`${BASE_URL}/api/installations/?limit=50`);
    if (!response.ok) {
      throw new Error("Failed to load installation history.");
    }

    const data = await parseApiResponse<InstallationDetailResponse[]>(response);
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
    setLiveCeleryState(null);
    setLiveCurrentPlay("");
    setLiveCurrentRole("");
    setLiveCurrentTask("");
    setLiveSeenTasks(0);
    setLiveCompletedTasks(0);
    setLiveEvents([]);
    setLastDetectedHosts([]);
    setLastSelectedPlaybook("");
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

    const data = await parseApiResponse<InstallationDetailResponse>(response);

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
      setLiveCeleryState(data.celery_progress?.state || null);
      setLiveCurrentPlay(data.celery_progress?.meta?.current_play || "");
      setLiveCurrentRole(data.celery_progress?.meta?.current_role || "");
      setLiveCurrentTask(data.celery_progress?.meta?.current_task || "");
      setLiveSeenTasks(data.celery_progress?.meta?.seen_tasks || 0);
      setLiveCompletedTasks(data.celery_progress?.meta?.completed_tasks || 0);
      setLiveEvents(data.celery_progress?.meta?.recent_events || []);
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
      const [, , operationalData] = await Promise.all([
        fetchHosts(),
        fetchTemplates(selectedInstaller),
        refreshOperationalData(),
      ]);

      const persistedId = window.localStorage.getItem(ACTIVE_INSTALLATION_STORAGE_KEY);
      const dismissedId = window.localStorage.getItem(DISMISSED_INSTALLATION_STORAGE_KEY);

      if (persistedId) {
        const response = await fetch(`${BASE_URL}/api/installations/${persistedId}/`);

        if (!response.ok) {
          persistActiveInstallationId(null);
        } else {
          const installation = await parseApiResponse<InstallationDetailResponse>(response);

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
    setPrecheckResult(null);
  }, [selectionSignature]);

  useEffect(() => {
    void fetchTemplates(selectedInstaller).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load installer templates.")
    );
  }, [selectedInstaller]);

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

        const data = await parseApiResponse<InstallationDetailResponse>(response);
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
        setLiveCeleryState(data.celery_progress?.state || null);
        setLiveCurrentPlay(data.celery_progress?.meta?.current_play || "");
        setLiveCurrentRole(data.celery_progress?.meta?.current_role || "");
        setLiveCurrentTask(data.celery_progress?.meta?.current_task || "");
        setLiveSeenTasks(data.celery_progress?.meta?.seen_tasks || 0);
        setLiveCompletedTasks(data.celery_progress?.meta?.completed_tasks || 0);
        setLiveEvents(data.celery_progress?.meta?.recent_events || []);

        if (
          data.status === "success" ||
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
    if (result?.status !== "failed") {
      return;
    }

    setShowFailureModal(true);
  }, [result]);

  function toggleHost(hostId: number, checked: boolean) {
    if (checked) {
      setSelectedHostIds((prev) => [...prev, hostId]);
      return;
    }

    setSelectedHostIds((prev) => prev.filter((id) => id !== hostId));
  }

  async function runPrecheck(showSuccessState: boolean) {
    if (selectedHostIds.length === 0) {
      setError("Select at least one host before running the SSH verification.");
      return false;
    }

    setCheckingConnectivity(true);
    setError("");

    try {
      const response = await fetch(`${BASE_URL}/api/installations/precheck/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          host_ids: selectedHostIds,
        }),
      });

      const data = await parseApiResponse<PrecheckResult>(response);
      setPrecheckResult(data);

      if (!response.ok) {
        throw new Error(data.message || "SSH verification failed.");
      }

      if (showSuccessState) {
        setResult(null);
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSH verification failed.");
      return false;
    } finally {
      setCheckingConnectivity(false);
    }
  }

  async function handleLaunch() {
    if (selectedHostIds.length === 0) {
      setError("Select at least one host.");
      return;
    }

    if (deploymentMode === "manual" && !selectedTemplateId) {
      setError("Select a template in manual mode.");
      return;
    }

    setLoading(true);
    setResumeCandidate(null);
    persistDismissedInstallationId(null);
    setProgress(0);
    setError("");
    setResult(null);
    setLiveStatus("pending");
    setLivePhase("queued");
    setLiveSummaryMessage("Installation queued successfully.");
    setLiveCeleryState("PENDING");
    setLiveCurrentPlay("");
    setLiveCurrentRole("");
    setLiveCurrentTask("");
    setLiveSeenTasks(0);
    setLiveCompletedTasks(0);
    setLiveEvents([]);
    setLastDetectedHosts([]);
    setLastSelectedPlaybook("");

    try {
      const response = await fetch(`${BASE_URL}/api/installations/launch/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          deploymentMode === "manual"
            ? {
                system_type: selectedInstaller,
                deployment_mode: "manual",
                template_id: Number(selectedTemplateId),
                host_ids: selectedHostIds,
              }
            : {
                system_type: selectedInstaller,
                deployment_mode: "auto",
                host_ids: selectedHostIds,
              }
        ),
      });

      const data = await parseApiResponse<LaunchQueuedResponse>(response);

      if (!response.ok) {
        throw new Error(data.message || "Launch failed.");
      }

      setActiveInstallationId(data.installation_id);
      setLivePhase(data.phase);
      setProgress(data.progress);
      setLiveSummaryMessage(data.message);
      setLastDetectedHosts(data.detected_hosts || []);
      setLastSelectedPlaybook(data.selected_playbook || "");
      persistActiveInstallationId(data.installation_id);
      await refreshOperationalData();
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : "Launch failed.";
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

  async function handleCancelInstallation() {
    if (activeInstallationId === null) {
      return;
    }

    setError("");

    try {
      const response = await fetch(`${BASE_URL}/api/installations/${activeInstallationId}/cancel/`, {
        method: "POST",
      });

      const data = await parseApiResponse<{
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

      const data = await parseApiResponse<{
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
        const data = await parseApiResponse<{ message?: string }>(response);
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

  return (
    <Container size="xl" px={0}>
      <Stack gap="lg">
        <Card className="console-panel" padding="lg">
          <Group justify="space-between" align="center">
            <div>
              <Group gap="sm" mb={6}>
                <ThemeIcon color="red" variant="light" size="lg" radius="md">
                  <IconTerminal2 size={18} />
                </ThemeIcon>
                <Title order={2}>Run Playbook</Title>
              </Group>
              <Text c="dimmed" mt={4}>
                Choose the target installer, validate SSH access, and run the selected automation workflow with live execution feedback.
              </Text>
            </div>
            <Group>
              <Badge size="lg" color="red" variant="dot">
                Celery + Redis
              </Badge>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={() => void refreshOperationalData()}
              >
                Refresh
              </Button>
              <Button
                variant={showHistory ? "filled" : "default"}
                color="red"
                leftSection={showHistory ? <IconChevronUp size={16} /> : <IconHistory size={16} />}
                onClick={() => setShowHistory(true)}
              >
                {showHistory ? "History Open" : `History (${historyInstallations.length})`}
              </Button>
            </Group>
          </Group>
        </Card>

        {dashboard && (
          <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md">
            <Card className="console-panel" padding="md">
              <Text c="dimmed" size="sm">Hosts</Text>
              <Title order={3}>{dashboard.hosts.total}</Title>
              <Text size="sm" c="dimmed">
                enabled {dashboard.hosts.enabled} | cp {dashboard.hosts.control_plane} | workers {dashboard.hosts.worker}
              </Text>
              <Text size="sm" c="dimmed">
                prepared {dashboard.hosts.prepared ?? 0} | fresh {dashboard.hosts.fresh ?? 0}
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

        {resumeCandidate && !loading && (
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

        <Card className="console-panel" padding="lg">
          <Stack>
            <Group gap="sm">
              <ThemeIcon color="red" variant="light">
                <IconBinaryTree2 size={16} />
              </ThemeIcon>
              <Title order={3}>
                <InstallerLabel
                  label={`${selectedInstallerOption.label} Workflow`}
                  withLogo={selectedInstaller === "kubernetes" || selectedInstaller === "k3s"}
                  installerId={selectedInstaller}
                />
              </Title>
            </Group>

            <Select
              value={deploymentMode}
              onChange={(value) => setDeploymentMode((value as "auto" | "manual") || "auto")}
              data={[
                { value: "auto", label: "Auto detect host state" },
                { value: "manual", label: "Manual template selection" },
              ]}
              allowDeselect={false}
            />

            <Text size="sm" c="dimmed">
              {selectedInstaller === "kubernetes" ? (
                <>
                  <InstallerLabel label="Kubernetes" withLogo installerId="kubernetes" /> auto mode detects whether selected hosts are fresh, prepared, or already initialized before choosing the playbook.
                </>
              ) : selectedInstaller === "k3s" ? (
                <>
                  <InstallerLabel label="K3s" withLogo installerId="k3s" /> auto mode uses the single-node K3s playbook for the selected hosts.
                </>
              ) : (
                "Auto mode behavior depends on the selected installer template."
              )}
            </Text>
          </Stack>
        </Card>

        <Card className="console-panel" padding="lg">
          <Stack>
            <Group gap="sm">
              <ThemeIcon color="red" variant="light">
                <IconBinaryTree2 size={16} />
              </ThemeIcon>
              <Title order={3}>
                <InstallerLabel
                  label={`${selectedInstallerOption.label} Template`}
                  withLogo={selectedInstaller === "kubernetes" || selectedInstaller === "k3s"}
                  installerId={selectedInstaller}
                />
              </Title>
            </Group>

            <Radio.Group value={selectedTemplateId} onChange={setSelectedTemplateId}>
              <Stack gap="xs">
                {templates.map((template) => (
                  <Radio
                    key={template.id}
                    value={String(template.id)}
                    label={`${template.name} - ${template.playbook_path}`}
                    description={`${template.deployment_type} ${template.description ? `| ${template.description}` : ""}`}
                  />
                ))}
              </Stack>
            </Radio.Group>

            {templates.length === 0 && (
              <Alert color="gray" variant="light">
                No templates are registered yet for {selectedInstallerOption.label}.
              </Alert>
            )}

            {deploymentMode === "auto" && (
              <Text size="sm" c="dimmed">
                {selectedInstaller === "kubernetes"
                  ? "Template selection is ignored in auto mode. The backend chooses the right playbook automatically."
                  : "Template selection is ignored in auto mode. The backend uses the installer-specific default playbook."}
              </Text>
            )}
          </Stack>
        </Card>

        <Card className="console-panel" padding="lg">
          <Stack>
            <Group gap="sm">
              <ThemeIcon color="red" variant="light">
                <IconPlugConnected size={16} />
              </ThemeIcon>
              <Title order={3}>Select Hosts</Title>
            </Group>

            {hosts.filter((host) => host.enabled).map((host) => (
              <Checkbox
                key={host.id}
                label={`${host.name} - ${host.ip_address} (${host.node_role}, ${host.baseline_state})`}
                checked={selectedHostIds.includes(host.id)}
                onChange={(event) => toggleHost(host.id, event.currentTarget.checked)}
              />
            ))}
          </Stack>
        </Card>

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

        {selectedTemplate && (
          <Alert color="red" variant="light" title="Selected Execution Profile">
            {deploymentMode === "auto"
              ? selectedInstaller === "kubernetes"
                ? `${selectedInstallerOption.label} auto mode will detect selected host state and choose the best playbook before execution.`
                : `${selectedInstallerOption.label} auto mode will use the single-node installer flow for the selected hosts.`
              : selectedTemplate.deployment_type === "prepare_node"
                ? "This template is intended for baseline node preparation before cluster initialization."
                : "This template initializes a single-node cluster after node preparation is complete."}
          </Alert>
        )}

        {lastDetectedHosts.length > 0 && (
          <Card className="console-panel" padding="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={3}>Automatic Detection</Title>
                <Badge color="teal" variant="light">
                  {lastSelectedPlaybook || "playbook selected"}
                </Badge>
              </Group>
              <Table withTableBorder striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Host</Table.Th>
                    <Table.Th>Reachable</Table.Th>
                    <Table.Th>Detected State</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {lastDetectedHosts.map((host) => (
                    <Table.Tr key={host.id}>
                      <Table.Td>{host.name}</Table.Td>
                      <Table.Td>{host.reachable ? "yes" : "no"}</Table.Td>
                      <Table.Td>{host.baseline_state}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          </Card>
        )}

        {precheckResult && (
          <Card className="console-panel" padding="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={3}>SSH Verification</Title>
                <Badge
                  color={
                    precheckResult.summary?.failed_hosts && precheckResult.summary.failed_hosts > 0
                      ? "red"
                      : "teal"
                  }
                  variant="filled"
                >
                  {precheckResult.summary?.failed_hosts && precheckResult.summary.failed_hosts > 0
                    ? "issues detected"
                    : "ready"}
                </Badge>
              </Group>

              <Group gap="md">
                <Text>Selected: {precheckResult.summary?.selected_hosts ?? 0}</Text>
                <Text>Reachable: {precheckResult.summary?.reachable_hosts ?? 0}</Text>
                <Text>Failed: {precheckResult.summary?.failed_hosts ?? 0}</Text>
                <Text>
                  Duration: {formatDurationDetailed(precheckResult.timings?.ssh_check_seconds)}
                </Text>
              </Group>

              {precheckResult.connectivity && precheckResult.connectivity.length > 0 && (
                <Table withTableBorder striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Host</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Detail</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {precheckResult.connectivity.map((item) => (
                      <Table.Tr key={item.host}>
                        <Table.Td>{item.host}</Table.Td>
                        <Table.Td>
                          <Badge color={item.status === "success" ? "teal" : "red"} variant="light">
                            {item.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{item.detail}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          </Card>
        )}

        {(loading || result) && (
          <Card className="console-panel" padding="lg">
            <Stack gap="lg">
              <Group justify="space-between" align="center">
                <div>
                  <Title order={3}>Deployment Monitor</Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    Live progress and pipeline status for the current installer run.
                  </Text>
                </div>
                <Badge
                  color={
                    loading
                      ? "red"
                      : result?.status
                        ? getStatusColor(result.status)
                        : "gray"
                  }
                  variant="light"
                >
                  {loading ? "running" : `last run ${result?.status ?? "idle"}`}
                </Badge>
              </Group>

              <div className="monitor-layout">
                <div className="monitor-progress-panel">
                  <Group justify="space-between" align="flex-start">
                    <div className="progress-metric-shell">
                      <RingProgress
                        size={132}
                        thickness={10}
                        roundCaps
                        sections={[
                          {
                            value: loading ? progress : result?.status === "success" ? 100 : 0,
                            color: getStatusColor(loading ? liveStatus : result?.status) === "gray"
                              ? "teal"
                              : getStatusColor(loading ? liveStatus : result?.status),
                          },
                        ]}
                        label={
                          <Stack gap={0} align="center" justify="center">
                            <Text size="xl" fw={800}>
                              {loading ? progress : result?.status === "success" ? 100 : 0}%
                            </Text>
                            <Text size="11px" c="dimmed">
                              {loading
                                ? formatDuration(elapsedSeconds)
                                : formatDuration(result?.duration_seconds)}
                            </Text>
                          </Stack>
                        }
                      />
                    </div>
                    <div className="monitor-details">
                        <Title order={4}>
                          {loading ? "Installation in Progress" : "Last Execution Result"}
                        </Title>
                        <Text c="dimmed" size="sm" mt={4}>
                          {loading ? activeStage.label : result?.message || "No execution yet."}
                        </Text>
                        <Text c="dimmed" size="sm">
                          {loading
                            ? activeStage.detail
                            : result?.status === "success"
                              ? "The installer completed and the cluster should now be reachable from the target node."
                              : result?.status === "failed"
                                ? "The installer stopped before cluster validation completed."
                                : "Launch a playbook to start tracking pipeline execution."}
                        </Text>
                        {liveSummaryMessage && loading && (
                          <Text size="sm" mt={6}>
                            {liveSummaryMessage}
                          </Text>
                        )}
                        {(liveCurrentPlay || liveCurrentTask) && loading && (
                          <Text size="sm" mt={6}>
                            {liveCurrentPlay ? `Play: ${liveCurrentPlay}` : ""}
                            {liveCurrentPlay && liveCurrentTask ? " | " : ""}
                            {liveCurrentRole ? `Role: ${liveCurrentRole}` : ""}
                            {liveCurrentRole && liveCurrentTask ? " | " : ""}
                            {liveCurrentTask ? `Task: ${liveCurrentTask}` : ""}
                          </Text>
                        )}
                        {(liveSeenTasks > 0 || liveCompletedTasks > 0) && loading && (
                          <Text size="sm" mt={6}>
                            Seen tasks: {liveSeenTasks} | Completed tasks: {liveCompletedTasks}
                          </Text>
                        )}
                        <Group gap="xs" mt={10}>
                          {(liveStatus || result?.status) && (
                            <Badge color={getStatusColor(loading ? liveStatus : result?.status)} variant="light">
                              {loading
                                ? `${liveStatus} | ${formatPhaseLabel(livePhase || undefined)}`
                                : result?.status}
                            </Badge>
                          )}
                          {liveCeleryState && loading && (
                            <Badge color="gray" variant="outline">
                              celery: {liveCeleryState}
                            </Badge>
                          )}
                          {(activeInstallationId !== null || result?.installation_id) && (
                            <Badge color="gray" variant="outline">
                              installation #{activeInstallationId ?? result?.installation_id}
                            </Badge>
                          )}
                        </Group>
                    </div>
                    <Badge color="red" variant="filled">
                      elapsed: {loading ? formatDuration(elapsedSeconds) : formatDuration(result?.duration_seconds)}
                    </Badge>
                  </Group>

                  <Progress
                    mt="md"
                    value={loading ? progress : result?.status === "success" ? 100 : 0}
                    color={
                      getStatusColor(loading ? liveStatus : result?.status) === "gray"
                        ? "teal"
                        : getStatusColor(loading ? liveStatus : result?.status)
                    }
                    size="lg"
                    radius="xl"
                    animated={loading}
                  />
                </div>

                <div className="monitor-pipeline-panel">
                  <Text fw={600} mb="sm">
                    Pipeline
                  </Text>
                  <Stack gap="sm">
                    {pipelineStageMap.map((stage, index) => {
                      const completed =
                        pipelineStageIndex >= 0 &&
                        ((!loading && result?.status === "success" && index <= pipelineStageIndex) ||
                          (loading &&
                            (index < pipelineStageIndex ||
                              (progress >= 100 && index <= pipelineStageIndex))));
                      const current = loading && index === pipelineStageIndex;

                      return (
                        <div
                          key={stage.phase}
                          className={`monitor-stage-row${completed ? " is-completed" : ""}${current ? " is-current" : ""}`}
                        >
                          <ThemeIcon
                            size="sm"
                            radius="xl"
                            color={completed ? "teal" : current ? "red" : "gray"}
                            variant={completed || current ? "filled" : "light"}
                          >
                            {completed ? <IconCheck size={12} /> : <IconClockHour4 size={12} />}
                          </ThemeIcon>
                          <div>
                            <Text fw={current ? 700 : 600} size="sm">
                              {stage.label}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {stage.detail}
                            </Text>
                          </div>
                        </div>
                      );
                    })}
                  </Stack>
                </div>
              </div>

              {liveEvents && liveEvents.length > 0 && (
                <>
                  <Divider />
                  <Title order={4}>Live Playbook Events</Title>
                  <ScrollArea.Autosize mah={260}>
                    <Table striped withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Type</Table.Th>
                          <Table.Th>Role</Table.Th>
                          <Table.Th>Task / Detail</Table.Th>
                          <Table.Th>Host</Table.Th>
                          <Table.Th>Status</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {[...liveEvents].reverse().map((event, index) => (
                          <Table.Tr key={`${event.timestamp || "event"}-${index}`}>
                            <Table.Td>{event.kind}</Table.Td>
                            <Table.Td>{event.role || "-"}</Table.Td>
                            <Table.Td>{event.task || event.play || event.line || "-"}</Table.Td>
                            <Table.Td>{event.host || "-"}</Table.Td>
                            <Table.Td>{event.status || "-"}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea.Autosize>
                </>
              )}
            </Stack>
          </Card>
        )}

        {result && (
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

              <Group gap="xl">
                <Text>Installation ID: {result.installation_id}</Text>
                <Text>Message: {result.message}</Text>
                <Text>Return code: {result.return_code ?? "-"}</Text>
                <Text>Duration: {formatDurationDetailed(result.duration_seconds)}</Text>
              </Group>

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

        <Modal
          opened={showHistory}
          onClose={() => setShowHistory(false)}
          title="Installation History"
          size="xl"
          centered
          classNames={{ content: "history-modal-content", header: "terminal-modal-header" }}
        >
          <Stack gap="md">
              <Group justify="space-between" align="center">
                <Text size="sm" c="dimmed">
                  Stored runs are kept outside the main screen and can be deleted permanently from here.
                </Text>
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
              <ScrollArea.Autosize mah={460}>
                <Table striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>ID</Table.Th>
                      <Table.Th>Template</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Phase</Table.Th>
                      <Table.Th>Progress</Table.Th>
                      <Table.Th>Duration</Table.Th>
                      <Table.Th>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {historyInstallations.map((installation) => (
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
                        <Table.Td>{formatDurationDetailed(installation.duration_seconds)}</Table.Td>
                        <Table.Td>
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
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
          </Stack>
        </Modal>

        <Modal
          opened={showSuccessModal}
          onClose={() => setShowSuccessModal(false)}
          title="Cluster Ready"
          size="lg"
          centered
          classNames={{ content: "success-modal-content", header: "terminal-modal-header" }}
        >
          <Stack gap="lg">
            <Group gap="md" align="center">
              <div className="success-logo-shell">
                <img
                  src={getInstallerLogo(activeInstallerSystem)}
                  alt={`${activeInstallerLabel} logo`}
                  className="success-logo"
                />
              </div>
              <div>
                <Title order={2}>Installation Succeeded</Title>
                <Text c="dimmed" size="sm" mt={4}>
                  {activeInstallerSystem === "kubernetes" ? (
                    <>
                      <InstallerLabel label="Kubernetes" withLogo installerId="kubernetes" /> completed successfully on the selected target and the node should now be operational.
                    </>
                  ) : activeInstallerSystem === "k3s" ? (
                    <>
                      <InstallerLabel label="K3s" withLogo installerId="k3s" /> completed successfully on the selected target and the node should now be operational.
                    </>
                  ) : (
                    `${activeInstallerLabel} completed successfully on the selected target and the node should now be operational.`
                  )}
                </Text>
              </div>
            </Group>

            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Template</Text>
                <Text fw={700}>
                  <InstallerLabel
                    label={result?.template_name || (activeInstallerSystem === "k3s" ? "K3s single node" : "Kubernetes single node")}
                    withLogo={activeInstallerSystem === "kubernetes" || activeInstallerSystem === "k3s"}
                    installerId={activeInstallerSystem}
                  />
                </Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Control Plane Nodes</Text>
                <Text fw={700}>{clusterControlPlaneCount}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Worker Nodes</Text>
                <Text fw={700}>{clusterWorkerCount}</Text>
              </Card>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Cluster Topology</Text>
                <Text fw={700}>{clusterTopologyLabel}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Target Machines</Text>
                <Text fw={700}>{clusterTargetHosts.length}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Primary Control Plane</Text>
                <Text fw={700}>{clusterTargetHosts[0] || "-"}</Text>
              </Card>
            </SimpleGrid>

            <Card className="host-panel" padding="sm">
              <Text size="sm" c="dimmed">Target Hostnames</Text>
              <Text fw={700}>{clusterTargetHosts.join(", ") || "-"}</Text>
            </Card>

            <Alert color="teal" variant="light">
              {activeInstallerSystem === "k3s"
                ? "Cluster access checks should be executed on the target node that now hosts the K3s server."
                : "Cluster access checks should be executed on the target node that now hosts the control plane."}
            </Alert>

            <div className="success-checks-panel">
              <Text fw={600} mb="sm">
                Recommended checks on the target
              </Text>
              <Stack gap="xs">
                {postInstallChecks.map((command) => (
                  <Code key={command} block>
                    {command}
                  </Code>
                ))}
              </Stack>
            </div>

            <Group gap="xl">
              <Text>Installation ID: {result?.installation_id ?? "-"}</Text>
              <Text>Duration: {formatDurationDetailed(result?.duration_seconds)}</Text>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={showFailureModal}
          onClose={() => setShowFailureModal(false)}
          title="Installation Failed"
          size="lg"
          centered
          classNames={{ content: "failure-modal-content", header: "terminal-modal-header" }}
        >
          <Stack gap="lg">
            <Group gap="md" align="center">
              <ThemeIcon size={72} radius={18} color="red" variant="light">
                <IconAlertCircle size={42} />
              </ThemeIcon>
              <div>
                <Title order={2}>Installation Failed</Title>
                <Text c="dimmed" size="sm" mt={4}>
                  The installer did not complete successfully. Review the reported problem before retrying.
                </Text>
              </div>
            </Group>

            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
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

            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
              {result?.message || "The backend reported a failed installation."}
            </Alert>

            {result?.stderr && (
              <div className="success-checks-panel">
                <Text fw={600} mb="sm">
                  Problem Details
                </Text>
                <ScrollArea.Autosize mah={220}>
                  <Code block>{result.stderr}</Code>
                </ScrollArea.Autosize>
              </div>
            )}

            {!result?.stderr && result?.stdout && (
              <div className="success-checks-panel">
                <Text fw={600} mb="sm">
                  Captured Output
                </Text>
                <ScrollArea.Autosize mah={220}>
                  <Code block>{result.stdout}</Code>
                </ScrollArea.Autosize>
              </div>
            )}
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}
