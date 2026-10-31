/**
 * OpenShift SNO installation phase tracker.
 *
 * Maps Ansible task names observed in the live output to semantic installation
 * phases that drive the phase-based progress bar in DeploymentMonitor.
 *
 * Phases are ordered by estimated timeline in a typical disconnected SNO install:
 *  1. preflight    — host checks, mirror DNS, firewall
 *  2. network      — libvirt network and storage pool provisioning
 *  3. iso          — agent asset generation (install-config, agent ISO)
 *  4. vm           — KVM domain creation and boot
 *  5. installing   — RHCOS write + OpenShift bootstrap + API convergence
 *  6. verifying    — cluster health checks and CLI access
 */

export type OpenShiftPhase =
  | "preflight"
  | "network"
  | "iso"
  | "vm"
  | "installing"
  | "verifying";

export type OpenShiftInstallationStage = {
  phase: OpenShiftPhase;
  label: string;
  detail: string;
  estimatedMinutes: number;
};

export const OPENSHIFT_INSTALLATION_STAGES: OpenShiftInstallationStage[] = [
  {
    phase: "preflight",
    label: "Preflight checks",
    detail: "Validating host capacity, mirror DNS reachability, firewall zones, and libvirt health.",
    estimatedMinutes: 2,
  },
  {
    phase: "network",
    label: "Network & storage",
    detail: "Provisioning the isolated libvirt bridge network and SNO storage pool.",
    estimatedMinutes: 2,
  },
  {
    phase: "iso",
    label: "Generating agent ISO",
    detail: "Building install-config.yaml, agent-config.yaml, and the bootable RHCOS agent ISO.",
    estimatedMinutes: 5,
  },
  {
    phase: "vm",
    label: "Starting VM",
    detail: "Creating the SNO KVM domain, attaching disks, and booting the agent ISO.",
    estimatedMinutes: 3,
  },
  {
    phase: "installing",
    label: "Installing OpenShift",
    detail: "RHCOS is writing to disk, bootstrapping the control plane, and converging the API.",
    estimatedMinutes: 45,
  },
  {
    phase: "verifying",
    label: "Verifying cluster",
    detail: "Confirming cluster health, node readiness, and provisioning CLI access.",
    estimatedMinutes: 5,
  },
];

// Task name fragments that trigger a phase transition.
// The FIRST matching rule (in order) for a given task name wins.
// Rules are checked against task names using case-insensitive substring matching.
const PHASE_TRIGGER_RULES: Array<{
  fragments: string[];
  phase: OpenShiftPhase;
}> = [
  // ── preflight ──────────────────────────────────────────────────────────────
  { fragments: ["preflight", "require exactly one disconnected", "disconnected mode", "mirror registry", "mirror dns", "firewall", "reachable mirror"], phase: "preflight" },
  { fragments: ["libvirt_preflight", "dns_preflight", "resolve the disconnected mirror"], phase: "preflight" },

  // ── network ────────────────────────────────────────────────────────────────
  { fragments: ["libvirt_network", "libvirt_storage", "create libvirt network", "define storage pool", "start storage pool", "create bridge"], phase: "network" },

  // ── iso ────────────────────────────────────────────────────────────────────
  { fragments: ["openshift_agent_assets", "agent_assets", "install-config", "agent-config", "generate agent", "build agent iso", "create agent iso", "render install", "write install-config", "discovery iso"], phase: "iso" },

  // ── vm ─────────────────────────────────────────────────────────────────────
  { fragments: ["libvirt_vm", "create vm", "define vm", "start vm", "boot vm", "attach agent iso", "domain xml", "define domain", "target_boot", "start managed vm"], phase: "vm" },

  // ── installing ─────────────────────────────────────────────────────────────
  { fragments: ["openshift_agent_install", "installation_monitor", "monitor installation", "wait for bootstrap", "wait for install", "bootkube", "writing image", "rhcos", "bootstrap complete", "cluster api", "openshift bootstrap"], phase: "installing" },

  // ── verifying ─────────────────────────────────────────────────────────────
  { fragments: ["cluster_verify", "openshift_cli_access", "post_install_boot", "verify cluster", "check cluster", "oc get nodes", "oc whoami", "kubeconfig", "kubeadmin", "cluster readiness", "cluster health", "post install"], phase: "verifying" },
];

/**
 * Given the current Ansible task name (and optionally the current role name),
 * return the corresponding OpenShift installation phase, or null if no rule matches.
 */
export function detectOpenShiftPhaseFromTask(
  taskName?: string | null,
  roleName?: string | null
): OpenShiftPhase | null {
  if (!taskName && !roleName) return null;

  const combined = `${(taskName ?? "").toLowerCase()} ${(roleName ?? "").toLowerCase()}`;

  for (const rule of PHASE_TRIGGER_RULES) {
    if (rule.fragments.some((fragment) => combined.includes(fragment.toLowerCase()))) {
      return rule.phase;
    }
  }

  return null;
}

/**
 * Returns the index into OPENSHIFT_INSTALLATION_STAGES for a given phase.
 */
export function getOpenShiftPhaseIndex(phase: OpenShiftPhase | null): number {
  if (!phase) return -1;
  return OPENSHIFT_INSTALLATION_STAGES.findIndex((s) => s.phase === phase);
}

/**
 * Given the current phase and total elapsed seconds, estimate a rough percentage
 * completion within the active phase (0–100), bounded by the phase's duration.
 */
export function estimatePhaseProgress(
  phaseIndex: number,
  elapsedSecondsInPhase: number
): number {
  if (phaseIndex < 0 || phaseIndex >= OPENSHIFT_INSTALLATION_STAGES.length) return 0;
  const stage = OPENSHIFT_INSTALLATION_STAGES[phaseIndex];
  const estimatedSeconds = stage.estimatedMinutes * 60;
  return Math.min(95, Math.round((elapsedSecondsInPhase / estimatedSeconds) * 100));
}

/**
 * Compute a human-readable remaining-time estimate for the remaining stages.
 */
export function estimateRemainingMinutes(phaseIndex: number): number {
  if (phaseIndex < 0) return OPENSHIFT_INSTALLATION_STAGES.reduce((sum, s) => sum + s.estimatedMinutes, 0);
  return OPENSHIFT_INSTALLATION_STAGES
    .slice(phaseIndex)
    .reduce((sum, s) => sum + s.estimatedMinutes, 0);
}
