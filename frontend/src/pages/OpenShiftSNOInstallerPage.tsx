import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBolt,
  IconChecklist,
  IconChevronDown,
  IconChevronUp,
  IconHistory,
  IconId,
  IconKey,
  IconPlayerPlay,
  IconRefresh,
  IconServer2,
  IconShieldOff,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import { getInstallerLogo } from "../features/installers/catalog";
import DeploymentWizard, {
  type DeploymentWizardStep,
  type DeploymentWizardStepDefinition,
} from "../components/installers/DeploymentWizard";
import InstallerLabel from "../components/installers/InstallerLabel";
import ClusterIdentityStep from "../components/openshift/ClusterIdentityStep";
import InfrastructureStep from "../components/openshift/InfrastructureStep";
import NetworkingCredentialsStep from "../components/openshift/NetworkingCredentialsStep";
import ReviewReadinessStep from "../components/openshift/ReviewReadinessStep";
import {
  buildOpenShiftPayload,
  canLaunchOpenShift,
  defaultOpenShiftValues,
  validateOpenShiftForm,
} from "../components/openshift/form";
import type {
  OpenShiftHost,
  OpenShiftSNOFormValues,
  OpenShiftSecretBundlePayload,
  OpenShiftTemplate,
} from "../components/openshift/types";
import { parseJsonResponse } from "../lib/api";

const BASE_URL = import.meta.env.VITE_DJANGO_BASE_URL;

const openshiftSteps: readonly DeploymentWizardStepDefinition[] = [
  { label: "Cluster identity", description: "Name and release", icon: IconId },
  { label: "KVM host and VM", description: "Compute and storage", icon: IconServer2 },
  { label: "Network and access", description: "Addressing and credentials", icon: IconKey },
  { label: "Review and launch", description: "Validate and approve", icon: IconChecklist },
];

const stepFields: Array<Array<keyof OpenShiftSNOFormValues>> = [
  ["clusterName", "baseDomain", "openshiftVersion"],
  ["provisioningHostId", "vmName", "nodeName", "libvirtNetwork", "storagePool", "vcpu", "memoryGib", "diskGib", "installationDisk"],
  ["machineIp", "prefixLength", "gateway", "dnsServers", "interfaceName", "macAddress", "machineNetworkCidr", "rendezvousIp", "clusterNetworkCidr", "hostPrefix", "serviceNetworkCidr", "pullSecret", "sshPublicKey", "mirrorRegistry"],
  ["installConfirmation"],
];

type LaunchResponse = { installation_id: number; message?: string };
type SecretResponse = { secret_reference: string; expires_at: string; message?: string };

// Lifecycle mode selected in cleanup modal
type LifecycleMode = "fast_reset" | "full_cleanup";

export default function OpenShiftSNOInstallerPage() {
  const navigate = useNavigate();
  const [values, setValues] = useState<OpenShiftSNOFormValues>(() => ({ ...defaultOpenShiftValues }));
  const sensitiveRef = useRef(values);
  const [activeStep, setActiveStep] = useState<DeploymentWizardStep>(0);
  const [hosts, setHosts] = useState<OpenShiftHost[]>([]);
  const [templates, setTemplates] = useState<OpenShiftTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [lifecycleMode, setLifecycleMode] = useState<LifecycleMode | null>(null);
  const [showStepErrors, setShowStepErrors] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const errors = useMemo(() => validateOpenShiftForm(values), [values]);
  const enabledHosts = useMemo(() => hosts.filter((host) => host.enabled), [hosts]);
  const selectedHostAvailable = values.provisioningHostId !== null && enabledHosts.some((host) => host.id === values.provisioningHostId);

  // Template resolution — match by playbook path
  const disconnectedTemplate = useMemo(
    () => templates.find((t) => t.playbook_path === "playbooks/openshift_sno_disconnected.yml"),
    [templates]
  );
  const fastResetTemplate = useMemo(
    () => templates.find((t) => t.playbook_path === "playbooks/openshift_sno_reset.yml"),
    [templates]
  );
  const fullCleanupTemplate = useMemo(
    () => templates.find((t) => t.playbook_path === "playbooks/openshift_sno_full_uninstall.yml"),
    [templates]
  );

  const validTemplate = disconnectedTemplate;
  const hasAnyLifecycleTemplate = Boolean(fastResetTemplate || fullCleanupTemplate);
  const blockingFields = stepFields[activeStep].filter((field) => errors[field]);
  const canLaunch = canLaunchOpenShift(errors, selectedHostAvailable, Boolean(validTemplate), submitting);

  useEffect(() => { sensitiveRef.current = values; }, [values]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadOptions() {
      setLoading(true);
      setLoadError("");
      try {
        const [hostsResponse, templatesResponse] = await Promise.all([
          fetch(`${BASE_URL}/api/hosts/`, { signal: controller.signal }),
          fetch(`${BASE_URL}/api/templates/?system_type=openshift_sno`, { signal: controller.signal }),
        ]);
        if (!hostsResponse.ok || !templatesResponse.ok)
          throw new Error("OpenShift installation options could not be loaded from the controller.");
        const [hostData, templateData] = await Promise.all([
          parseJsonResponse<OpenShiftHost[]>(hostsResponse),
          parseJsonResponse<OpenShiftTemplate[]>(templatesResponse),
        ]);
        setHosts(hostData);
        setTemplates(templateData);
      } catch (error) {
        if ((error as Error).name !== "AbortError")
          setLoadError(error instanceof Error ? error.message : "OpenShift installation options could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadOptions();
    return () => { controller.abort(); };
  }, [reloadToken]);

  // Clear sensitive values from memory when component unmounts
  useEffect(() => {
    return () => {
      sensitiveRef.current.pullSecret = "";
      sensitiveRef.current.sshPublicKey = "";
      sensitiveRef.current.additionalTrustBundle = "";
      sensitiveRef.current.mirrorCaBundle = "";
      sensitiveRef.current.mirrorUsername = "";
      sensitiveRef.current.mirrorPassword = "";
    };
  }, []);

  function update<K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) {
    setValues((current) => {
      const next = { ...current, [field]: value };
      if (field === "clusterName" && typeof value === "string") {
        if (current.vmName === current.clusterName) next.vmName = value;
        if (current.nodeName === `${current.clusterName}-node`) next.nodeName = `${value}-node`;
      }
      if (field === "machineIp" && typeof value === "string" && current.rendezvousIp === current.machineIp)
        next.rendezvousIp = value;
      return next;
    });
  }

  function nextStep() {
    if (blockingFields.length) {
      setShowStepErrors(true);
      requestAnimationFrame(() =>
        document.querySelector("[data-error=true]")?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
      return;
    }
    setShowStepErrors(false);
    setActiveStep((step) => Math.min(step + 1, 3) as DeploymentWizardStep);
  }

  function resetForm() {
    setValues({ ...defaultOpenShiftValues });
    setActiveStep(0);
    setShowStepErrors(false);
    setResetOpen(false);
  }

  async function queueWorkflow(template: OpenShiftTemplate, title: string) {
    setSubmitting(true);
    try {
      const secretPayload: OpenShiftSecretBundlePayload = {
        pull_secret: values.pullSecret,
        ssh_public_key: values.sshPublicKey,
        additional_trust_bundle: values.additionalTrustBundle,
        mirror_ca_bundle: values.mirrorCaBundle,
        mirror_username: values.mirrorUsername,
        mirror_password: values.mirrorPassword,
      };
      const secretResponse = await fetch(`${BASE_URL}/api/openshift/secrets/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(secretPayload),
      });
      const secretResult = await parseJsonResponse<SecretResponse>(secretResponse);
      if (!secretResponse.ok || !secretResult.secret_reference)
        throw new Error(secretResult.message || "The short-lived OpenShift credential bundle could not be created.");
      const response = await fetch(`${BASE_URL}/api/installations/launch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOpenShiftPayload(values, template.id, secretResult.secret_reference)),
      });
      const result = await parseJsonResponse<LaunchResponse>(response);
      if (!response.ok) throw new Error(result.message || "The OpenShift SNO installation could not be queued.");
      setValues((current) => ({
        ...current,
        pullSecret: "",
        sshPublicKey: "",
        additionalTrustBundle: "",
        mirrorCaBundle: "",
        mirrorPassword: "",
      }));
      notifications.show({ color: "green", title, message: result.message || `Execution #${result.installation_id} was created.` });
      navigate("/executions");
    } catch (error) {
      notifications.show({ color: "red", title: "Launch failed", message: error instanceof Error ? error.message : "The OpenShift workflow could not be queued." });
    } finally {
      setSubmitting(false);
    }
  }

  async function launchInstallation() {
    if (!canLaunch || !validTemplate || submitting) return;
    await queueWorkflow(validTemplate, "Disconnected SNO installation queued");
  }

  async function launchLifecycle(mode: LifecycleMode) {
    const targetTemplate = mode === "fast_reset"
      ? (fastResetTemplate ?? fullCleanupTemplate)
      : (fullCleanupTemplate ?? fastResetTemplate);

    if (!targetTemplate || values.provisioningHostId === null || submitting) return;
    setSubmitting(true);
    try {
      const payload = buildOpenShiftPayload(values, targetTemplate.id, "");
      payload.cluster_config.secret_reference = "";
      payload.cluster_config.preserve_iso = mode === "fast_reset";
      const response = await fetch(`${BASE_URL}/api/installations/launch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await parseJsonResponse<LaunchResponse>(response);
      if (!response.ok) throw new Error(result.message || "The lifecycle operation could not be queued.");
      setLifecycleOpen(false);
      setLifecycleMode(null);
      notifications.show({
        color: "green",
        title: mode === "fast_reset" ? "Fast Reset queued" : "Full cleanup queued",
        message: result.message || `Execution #${result.installation_id} was created.`,
      });
      navigate("/executions");
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Lifecycle operation failed",
        message: error instanceof Error ? error.message : "The lifecycle operation could not be queued.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="lg" className="openshift-page">
      <PageHeader
        icon={
          <img
            src={getInstallerLogo("openshift_sno")}
            alt=""
            className="template-logo-inline"
            style={{ width: 22, height: 22 }}
          />
        }
        badge="OpenShift SNO Installer"
        badgeColor="red"
        title={
          <InstallerLabel
            label="Deploy Single Node OpenShift"
            withLogo
            installerId="openshift_sno"
            className="page-installer-heading"
          />
        }
        subtitle="Disconnected installation on KVM/libvirt using the local Quay mirror. LinDeploy validates the host, provisions the SNO VM, and monitors cluster convergence."
        actions={
          <Group gap="sm">
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              onClick={() => setReloadToken((v) => v + 1)}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="default"
              leftSection={<IconHistory size={16} />}
              onClick={() => navigate("/history")}
            >
              History
            </Button>
            <Button color="red" variant="light" onClick={() => setResetOpen(true)}>
              Reset form
            </Button>
          </Group>
        }
      />

      <DeploymentWizard
        activeStep={activeStep}
        topologyReady={blockingFields.length === 0}
        sshVerified={false}
        executionStarted={submitting}
        disabled={submitting}
        steps={openshiftSteps}
        title="OpenShift deployment"
        description="Complete the four stages in order. Your configuration is preserved while you move between stages."
        completedSteps={openshiftSteps.map((_, index) => index < activeStep)}
        onStepChange={setActiveStep}
      />

      {loadError && <Alert color="red" title="Controller options unavailable">{loadError}</Alert>}
      {!loading && !validTemplate && (
        <Alert color="orange" title="Launch unavailable">
          The disconnected SNO workflow is not registered. Apply backend migrations and reload.
        </Alert>
      )}

      {loading ? (
        <Card className="console-panel" padding="xl">
          <Group justify="center">
            <Loader size="sm" />
            <Text>Loading hosts and automation templates…</Text>
          </Group>
        </Card>
      ) : (
        <Card className="console-panel openshift-workflow" padding="lg">
          <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
            <Box>
              <Title order={3}>{openshiftSteps[activeStep].label}</Title>
              <Text size="sm" c="dimmed" mt={4}>{openshiftSteps[activeStep].description}</Text>
            </Box>
            <Badge color="red" variant="light">Step {activeStep + 1} of 4</Badge>
          </Group>
          <Box mt="lg">
            {activeStep === 0 && <ClusterIdentityStep values={values} errors={showStepErrors ? errors : {}} update={update} />}
            {activeStep === 1 && <InfrastructureStep values={values} errors={showStepErrors ? errors : {}} hosts={enabledHosts} update={update} />}
            {activeStep === 2 && <NetworkingCredentialsStep values={values} errors={showStepErrors ? errors : {}} update={update} />}
            {activeStep === 3 && <ReviewReadinessStep values={values} errors={errors} hostAvailable={selectedHostAvailable} templateId={validTemplate?.id} update={update} />}
          </Box>
          {showStepErrors && blockingFields.length > 0 && (
            <Alert mt="lg" color="red" title="Complete this step">
              Correct the {blockingFields.length} highlighted field{blockingFields.length === 1 ? "" : "s"} before continuing.
            </Alert>
          )}
          <Group className="wizard-stage-actions" justify="space-between" mt="xl">
            <Button
              variant="default"
              leftSection={<IconArrowLeft size={16} />}
              disabled={activeStep === 0 || submitting}
              onClick={() => { setShowStepErrors(false); setActiveStep((step) => Math.max(0, step - 1) as DeploymentWizardStep); }}
            >
              Back
            </Button>
            {activeStep < 3 ? (
              <Button rightSection={<IconArrowRight size={16} />} onClick={nextStep}>Continue</Button>
            ) : (
              <Group>
                <Button
                  color="orange"
                  variant="outline"
                  leftSection={<IconTrash size={16} />}
                  disabled={!hasAnyLifecycleTemplate || !selectedHostAvailable}
                  onClick={() => setLifecycleOpen(true)}
                >
                  Cluster lifecycle
                </Button>
                <Button
                  color="red"
                  leftSection={<IconPlayerPlay size={16} />}
                  disabled={!canLaunch}
                  loading={submitting}
                  onClick={() => void launchInstallation()}
                >
                  Start SNO installation
                </Button>
              </Group>
            )}
          </Group>
        </Card>
      )}

      {/* ── Form reset confirmation ─────────────────────────────────────────── */}
      <Modal opened={resetOpen} onClose={() => setResetOpen(false)} title="Reset OpenShift configuration?" centered>
        <Stack>
          <Text size="sm">This clears every field, including sensitive values held in memory. No controller resource is changed.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button color="red" onClick={resetForm}>Clear configuration</Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Cluster lifecycle modal ─────────────────────────────────────────── */}
      <Modal
        opened={lifecycleOpen}
        onClose={() => { setLifecycleOpen(false); setLifecycleMode(null); }}
        title="Cluster lifecycle operation"
        size="lg"
        centered
      >
        <Stack gap="md">
          <Alert color="blue" title="Choose an operation">
            Select how to remove the managed SNO environment for <strong>{values.vmName || "the configured cluster"}</strong>.
            The local Quay mirror registry and all mirrored release content are always preserved.
          </Alert>

          {/* ── Fast Reset ── */}
          <LifecycleOptionCard
            icon={<IconBolt size={20} />}
            color="orange"
            title="Fast Reset"
            badge="Recommended for reinstall"
            badgeColor="orange"
            selected={lifecycleMode === "fast_reset"}
            onSelect={() => setLifecycleMode("fast_reset")}
            available={Boolean(fastResetTemplate)}
            unavailableReason="openshift-sno-fast-reset template not registered — apply backend migrations."
          >
            <Text size="sm" c="dimmed">
              Destroys the VM domain and disk in seconds. Preserves the storage pool, base RHCOS ISO cache,
              ownership marker, kubeconfig template, and bash CLI hooks so the cluster can be reinstalled
              immediately without waiting to re-download any assets.
            </Text>
            <Group gap="xs" mt="xs">
              <Badge size="xs" color="green" variant="light">Keeps ISO cache</Badge>
              <Badge size="xs" color="green" variant="light">Keeps mirror</Badge>
              <Badge size="xs" color="green" variant="light">Keeps ownership marker</Badge>
              <Badge size="xs" color="red" variant="light">Removes VM + disk</Badge>
            </Group>
          </LifecycleOptionCard>

          {/* ── Full Cleanup ── */}
          <LifecycleOptionCard
            icon={<IconShieldOff size={20} />}
            color="red"
            title="Full Cleanup"
            badge="Complete decommission"
            badgeColor="red"
            selected={lifecycleMode === "full_cleanup"}
            onSelect={() => setLifecycleMode("full_cleanup")}
            available={Boolean(fullCleanupTemplate)}
            unavailableReason="openshift-sno-full-uninstall template not registered — apply backend migrations."
          >
            <Text size="sm" c="dimmed">
              Removes the VM, disk, agent ISO, all cluster-specific installation assets, DNS host entries,
              kubeconfig, and .bashrc CLI activation blocks. The Quay mirror registry is preserved.
            </Text>
            <Group gap="xs" mt="xs">
              <Badge size="xs" color="green" variant="light">Keeps mirror</Badge>
              <Badge size="xs" color="red" variant="light">Removes VM + disk</Badge>
              <Badge size="xs" color="red" variant="light">Removes cluster assets</Badge>
              <Badge size="xs" color="red" variant="light">Removes DNS records</Badge>
              <Badge size="xs" color="red" variant="light">Removes kubeconfig</Badge>
            </Group>
          </LifecycleOptionCard>

          {lifecycleMode && (
            <Alert color="orange" title="Destructive operation">
              {lifecycleMode === "fast_reset"
                ? `Fast Reset will destroy the VM "${values.vmName}" and its disk. You can reinstall immediately after this completes.`
                : `Full Cleanup will destroy the VM "${values.vmName}", its disk, and all cluster assets. DNS entries and kubeconfig will be removed.`}
            </Alert>
          )}

          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => { setLifecycleOpen(false); setLifecycleMode(null); }}>Cancel</Button>
            <Button
              color={lifecycleMode === "fast_reset" ? "orange" : "red"}
              disabled={!lifecycleMode}
              loading={submitting}
              leftSection={lifecycleMode === "fast_reset" ? <IconBolt size={16} /> : <IconTrash size={16} />}
              onClick={() => lifecycleMode && void launchLifecycle(lifecycleMode)}
            >
              {lifecycleMode === "fast_reset" ? "Run Fast Reset" : lifecycleMode === "full_cleanup" ? "Run Full Cleanup" : "Select an operation"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/* ── Internal helper component for lifecycle option cards ──────────────────── */
type LifecycleOptionCardProps = {
  icon: React.ReactNode;
  color: string;
  title: string;
  badge: string;
  badgeColor: string;
  selected: boolean;
  onSelect: () => void;
  available: boolean;
  unavailableReason: string;
  children: React.ReactNode;
};

function LifecycleOptionCard({
  icon, color, title, badge, badgeColor, selected, onSelect, available, unavailableReason, children,
}: LifecycleOptionCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <Card
      padding="sm"
      withBorder
      className="host-panel"
      style={{
        cursor: available ? "pointer" : "default",
        borderColor: selected ? `var(--mantine-color-${color}-6)` : undefined,
        opacity: available ? 1 : 0.6,
      }}
      onClick={available ? onSelect : undefined}
    >
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon color={color} variant={selected ? "filled" : "light"} size="md" radius="md">
              {icon}
            </ThemeIcon>
            <div>
              <Text fw={600} size="sm">{title}</Text>
              {!available && <Text size="xs" c="red">{unavailableReason}</Text>}
            </div>
          </Group>
          <Group gap="xs">
            <Badge color={badgeColor} variant="light" size="sm">{badge}</Badge>
            <Button
              variant="subtle"
              size="compact-xs"
              color="gray"
              rightSection={detailOpen ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
              onClick={(e) => { e.stopPropagation(); setDetailOpen((v) => !v); }}
            >
              {detailOpen ? "Less" : "Details"}
            </Button>
          </Group>
        </Group>
        <Collapse expanded={detailOpen}>
          <Box mt="xs">{children}</Box>
        </Collapse>
      </Stack>
    </Card>
  );
}
