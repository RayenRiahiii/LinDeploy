import { type DeploymentTopology } from "../installers/DeploymentTopologySelector";
import { type InstallerId } from "../../features/installers/catalog";

export type Host = {
  id: number;
  stable_id: string;
  name: string;
  hostname?: string;
  ip_address: string;
  ssh_port: number;
  enabled: boolean;
  node_role: string;
  credential_username?: string | null;
};

export type Template = {
  id: number;
  name: string;
  system_type: "kubernetes" | "k3s" | "openshift_sno";
  playbook_path: string;
  description: string;
  deployment_type: "prepare_node" | "single_node" | "multi_node" | "cleanup";
};

export type CleanupMode = "reset" | "full_uninstall";

export type CleanupTemplateMap = Partial<Record<CleanupMode, Template>>;

export type TimingBlock = {
  inventory_build_seconds?: number;
  repo_discovery_seconds?: number;
  playbook_execution_seconds?: number;
  total_request_seconds?: number;
  ssh_check_seconds?: number;
};

export type ConnectivityStatus = {
  host: string;
  status: "success" | "failed" | "unreachable";
  detail: string;
};

export type PrecheckResult = {
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

export type LaunchQueuedResponse = {
  installation_id: number;
  celery_task_id?: string;
  status: string;
  phase: string;
  progress: number;
  message: string;
  cluster_config?: ClusterConfig;
  host_overrides?: HostOverridePayload[];
  topology?: DeploymentTopology;
  bootstrap_host_id?: number | null;
};

export type OpenShiftSecretResponse = {
  secret_reference?: string;
  expires_at?: string;
  message?: string;
  errors?: unknown;
};

export type OpenShiftRetryResponse = LaunchQueuedResponse & {
  retried_installation_id?: number;
};

export type ClusterConfig = {
  cluster_name: string;
  version: string;
  topology_mode: DeploymentTopology;
  pod_cidr: string;
  service_cidr: string;
  cluster_domain: string;
  control_plane_endpoint: string;
  cni_plugin: string;
  disable_ingress: boolean;
  base_domain?: string;
  machine_network_cidr?: string;
  cluster_network_cidr?: string;
  service_network_cidr?: string;
  rendezvous_ip?: string;
  host_prefix?: number;
  dns_servers?: string[];
  disconnected?: boolean;
  control_plane_count?: number;
  worker_count?: number;
  target_modification_approved?: boolean;
  cleanup_confirmation?: string;
  cleanup_expected_confirmation?: string;
  cleanup_mode?: CleanupMode;
  preserve_iso?: boolean;
};

export type HostOverrideForm = {
  host_id: number;
  host_name: string;
  ip_address: string;
  ssh_port: number;
  ansible_user: string;
  node_name: string;
  cluster_name: string;
  node_role: string;
  advertise_address: string;
  labels: string;
  taints: string;
  vm_name?: string;
  node_ip?: string;
  prefix_length?: number;
  gateway?: string;
  interface_name?: string;
  installation_disk?: string;
  libvirt_network?: string;
  storage_pool?: string;
  vcpu?: number;
  memory_gib?: number;
  disk_gib?: number;
  network_mode?: string;
};

export type HostOverridePayload = Omit<HostOverrideForm, "labels" | "taints"> & {
  labels: string[];
  taints: string[];
};

export type InstallationTarget = {
  id: number;
  host: number;
  host_name: string;
  status: string;
  output: string;
  stdout: string;
  stderr: string;
  return_code?: number | null;
  desired_role?: "control_plane" | "worker";
  is_bootstrap?: boolean;
  join_status?: string;
  node_name?: string;
  cluster_name?: string;
  operator_issue?: {
    code: string;
    title: string;
    detail: string;
    recommended_action: string;
    cleanup_system?: InstallerId;
    artifacts?: string[];
  } | null;
};

export type InstallationDetailResponse = {
  id: number;
  status: "pending" | "running" | "success" | "partial_success" | "failed" | "cancelled";
  phase: string;
  progress: number;
  template: number;
  template_name: string;
  template_system_type?: InstallerId;
  deployment_type: string;
  topology?: DeploymentTopology;
  bootstrap_host?: number | null;
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
      total_tasks?: number;
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
      output_lines?: Array<{
        channel: string;
        line: string;
        timestamp?: string;
      }>;
      next_offset?: number;
      total_lines?: number;
      started_at?: string | null;
      updated_at?: string | null;
      detail?: string;
      telemetry?: {
        total_percentage?: number;
        cluster_status?: string;
        stage?: string;
        stage_percentage?: number;
        progress_info?: string;
      };
    };
  } | null;
  cluster_config?: ClusterConfig;
  host_overrides?: HostOverridePayload[];
  targets: InstallationTarget[];
};

export type DashboardSummary = {
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

export type LaunchResult = {
  installation_id: number;
  status: string;
  message: string;
  template_name?: string;
  template_system_type?: InstallerId;
  deployment_type?: string;
  topology?: DeploymentTopology;
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

export type CleanupRequest = {
  systemType: InstallerId;
  hostIds: number[];
  clusterConfig: ClusterConfig;
  hostOverrides: HostOverridePayload[];
  title: string;
  purpose?: "maintenance" | "platform_switch";
};

export type RunDeploymentMode = "full" | "installer" | "execution" | "history";

export type RunDeploymentProps = {
  forcedInstaller?: InstallerId;
  mode?: RunDeploymentMode;
};

