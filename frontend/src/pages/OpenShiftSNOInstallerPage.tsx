import { Alert, Badge, Box, Button, Card, Group, Loader, Modal, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconArrowRight, IconChecklist, IconHistory, IconId, IconKey, IconPlayerPlay, IconRefresh, IconServer2, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageHeader from "../components/common/PageHeader";
import { getInstallerLogo } from "../features/installers/catalog";
import DeploymentWizard, { type DeploymentWizardStep, type DeploymentWizardStepDefinition } from "../components/installers/DeploymentWizard";
import InstallerLabel from "../components/installers/InstallerLabel";
import ClusterIdentityStep from "../components/openshift/ClusterIdentityStep";
import InfrastructureStep from "../components/openshift/InfrastructureStep";
import NetworkingCredentialsStep from "../components/openshift/NetworkingCredentialsStep";
import ReviewReadinessStep from "../components/openshift/ReviewReadinessStep";
import { buildOpenShiftPayload, canLaunchOpenShift, defaultOpenShiftValues, validateOpenShiftForm } from "../components/openshift/form";
import type { OpenShiftHost, OpenShiftSNOFormValues, OpenShiftSecretBundlePayload, OpenShiftTemplate } from "../components/openshift/types";
import { parseJsonResponse } from "../lib/api";

const BASE_URL = (import.meta.env.VITE_DJANGO_BASE_URL || "").replace(/\/+$/, "");
const ACTIVE_INSTALLATION_STORAGE_KEY = "lindeploy.active_installation_id";
const stepFields: Array<Array<keyof OpenShiftSNOFormValues>> = [
  ["clusterName", "baseDomain", "openshiftVersion"],
  ["provisioningHostId", "vmName", "nodeName", "libvirtNetwork", "storagePool", "vcpu", "memoryGib", "diskGib", "installationDisk"],
  ["machineIp", "prefixLength", "gateway", "dnsServers", "interfaceName", "macAddress", "machineNetworkCidr", "rendezvousIp", "clusterNetworkCidr", "hostPrefix", "serviceNetworkCidr", "pullSecret", "sshPublicKey", "mirrorRegistry"],
  ["installConfirmation"],
];

type LaunchResponse = { installation_id: number; message?: string };
type SecretResponse = { secret_reference: string; expires_at: string; message?: string };

export default function OpenShiftSNOInstallerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [values, setValues] = useState<OpenShiftSNOFormValues>(() => ({ ...defaultOpenShiftValues }));

  const openshiftSteps: readonly DeploymentWizardStepDefinition[] = useMemo(() => [
    { label: t("openshift.stepClusterIdentity", "Cluster identity"), description: t("openshift.stepClusterIdentityDesc", "Name and release"), icon: IconId },
    { label: t("openshift.stepKvmHost", "KVM host and VM"), description: t("openshift.stepKvmHostDesc", "Compute and storage"), icon: IconServer2 },
    { label: t("openshift.stepNetworkAccess", "Network and access"), description: t("openshift.stepNetworkAccessDesc", "Addressing and credentials"), icon: IconKey },
    { label: t("openshift.stepReviewLaunch", "Review and launch"), description: t("openshift.stepReviewLaunchDesc", "Validate and approve"), icon: IconChecklist },
  ], [t]);
  const sensitiveRef = useRef(values);
  const [activeStep, setActiveStep] = useState<DeploymentWizardStep>(0);
  const [hosts, setHosts] = useState<OpenShiftHost[]>([]);
  const [templates, setTemplates] = useState<OpenShiftTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [showStepErrors, setShowStepErrors] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const errors = useMemo(() => validateOpenShiftForm(values), [values]);
  const enabledHosts = useMemo(() => hosts.filter((host) => host.enabled), [hosts]);
  const selectedHostAvailable = values.provisioningHostId !== null && enabledHosts.some((host) => host.id === values.provisioningHostId);
  const disconnectedTemplate = useMemo(() => templates.find((template) => template.playbook_path === "playbooks/openshift_sno_disconnected.yml"), [templates]);
  const cleanupTemplate = useMemo(() => templates.find((template) => template.playbook_path === "playbooks/openshift_sno_cleanup.yml"), [templates]);
  const fullUninstallTemplate = useMemo(() => templates.find((template) => template.playbook_path === "playbooks/openshift_sno_full_uninstall.yml"), [templates]);
  const validTemplate = disconnectedTemplate;
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
        if (!hostsResponse.ok || !templatesResponse.ok) throw new Error("OpenShift installation options could not be loaded from the controller.");
        const [hostData, templateData] = await Promise.all([parseJsonResponse<OpenShiftHost[]>(hostsResponse), parseJsonResponse<OpenShiftTemplate[]>(templatesResponse)]);
        setHosts(hostData);
        setTemplates(templateData);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setLoadError(error instanceof Error ? error.message : "OpenShift installation options could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadOptions();
    return () => {
      controller.abort();
    };
  }, [reloadToken]);

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
      if (field === "machineIp" && typeof value === "string" && current.rendezvousIp === current.machineIp) next.rendezvousIp = value;
      return next;
    });
  }

  function nextStep() {
    if (blockingFields.length) {
      setShowStepErrors(true);
      requestAnimationFrame(() => document.querySelector("[data-error=true]")?.scrollIntoView({ behavior: "smooth", block: "center" }));
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
      if (!secretResponse.ok || !secretResult.secret_reference) throw new Error(secretResult.message || "The short-lived OpenShift credential bundle could not be created.");
      const response = await fetch(`${BASE_URL}/api/installations/launch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOpenShiftPayload(values, template.id, secretResult.secret_reference)),
      });
      const result = await parseJsonResponse<LaunchResponse>(response);
      if (!response.ok) throw new Error(result.message || "The OpenShift SNO installation could not be queued.");
      setValues((current) => ({ ...current, pullSecret: "", sshPublicKey: "", additionalTrustBundle: "", mirrorCaBundle: "", mirrorPassword: "" }));
      notifications.show({ color: "green", title, message: result.message || `Execution #${result.installation_id} was created.` });
      window.localStorage.setItem(ACTIVE_INSTALLATION_STORAGE_KEY, String(result.installation_id));
      navigate("/executions", { state: { targetInstallationId: result.installation_id } });
    } catch (error) {
      notifications.show({ color: "red", title: "Launch failed", message: error instanceof Error ? error.message : "The OpenShift workflow could not be queued." });
    } finally { setSubmitting(false); }
  }

  async function launchInstallation() {
    if (!canLaunch || !validTemplate || submitting) return;
    await queueWorkflow(validTemplate, "Disconnected SNO installation queued");
  }

  async function launchCleanup(preserveIso = true) {
    const targetTemplate = preserveIso ? cleanupTemplate : (fullUninstallTemplate || cleanupTemplate);
    if (!targetTemplate || values.provisioningHostId === null || submitting) return;
    setSubmitting(true);
    try {
      const payload = buildOpenShiftPayload(values, targetTemplate.id, "");
      payload.cluster_config.secret_reference = "";
      payload.cluster_config.preserve_iso = preserveIso;
      const response = await fetch(`${BASE_URL}/api/installations/launch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await parseJsonResponse<LaunchResponse>(response);
      if (!response.ok) throw new Error(result.message || "The OpenShift cleanup could not be queued.");
      setCleanupOpen(false);
      notifications.show({
        color: "green",
        title: preserveIso ? "OpenShift reset queued (ISO preserved)" : "OpenShift full cleanup queued",
        message: result.message || `Execution #${result.installation_id} was created.`,
      });
      window.localStorage.setItem(ACTIVE_INSTALLATION_STORAGE_KEY, String(result.installation_id));
      navigate("/executions", { state: { targetInstallationId: result.installation_id } });
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Cleanup launch failed",
        message: error instanceof Error ? error.message : "The OpenShift cleanup could not be queued.",
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
        badge={t("openshift.badge", "OpenShift SNO Installer")}
        badgeColor="red"
        title={
          <InstallerLabel
            label={t("openshift.heading", "Deploy Single Node OpenShift")}
            withLogo
            installerId="openshift_sno"
            className="page-installer-heading"
          />
        }
        subtitle={t("openshift.subtitle", "Create one OpenShift cluster as a KVM/libvirt virtual machine. LinDeploy validates the host, prepares the discovery ISO, installs RHCOS, and verifies the resulting cluster.")}
        actions={
          <Group gap="sm">
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              onClick={() => setReloadToken((value) => value + 1)}
              disabled={loading}
            >
              {t("common.refresh", "Refresh")}
            </Button>
            <Button
              variant="default"
              leftSection={<IconHistory size={16} />}
              onClick={() => navigate("/history")}
            >
              {t("nav.history", "History")}
            </Button>
            <Button color="red" variant="light" onClick={() => setResetOpen(true)}>
              {t("openshift.resetForm", "Reset form")}
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
        title={t("sections.openshift.badge", "OpenShift deployment")}
        description={t("wizard.guidedDesc", "Complete the four stages in order. Your configuration is preserved while you move between stages.")}
        completedSteps={openshiftSteps.map((_, index) => index < activeStep)}
        onStepChange={setActiveStep}
      />

      {loadError && <Alert color="red" title="Controller options unavailable">{loadError}</Alert>}
      {!loading && !validTemplate && <Alert color="orange" title="Launch unavailable">The selected OpenShift workflow is not registered. Apply backend migrations and reload this page.</Alert>}
      {loading ? <Card className="console-panel" padding="xl"><Group justify="center"><Loader size="sm" /><Text>{t("common.loading", "Loading hosts and automation templates...")}</Text></Group></Card> : (
        <Card className="console-panel openshift-workflow" padding="lg">
          <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
            <Box>
              <Title order={3}>{openshiftSteps[activeStep].label}</Title>
              <Text size="sm" c="dimmed" mt={4}>{openshiftSteps[activeStep].description}</Text>
            </Box>
            <Badge color="red" variant="light">{t("openshift.stepOf", { current: activeStep + 1, total: 4, defaultValue: `Step ${activeStep + 1} of 4` })}</Badge>
          </Group>
          <Box mt="lg">
            {activeStep === 0 && <ClusterIdentityStep values={values} errors={showStepErrors ? errors : {}} update={update} />}
            {activeStep === 1 && <InfrastructureStep values={values} errors={showStepErrors ? errors : {}} hosts={enabledHosts} update={update} />}
            {activeStep === 2 && <NetworkingCredentialsStep values={values} errors={showStepErrors ? errors : {}} update={update} />}
            {activeStep === 3 && <ReviewReadinessStep values={values} errors={errors} hostAvailable={selectedHostAvailable} templateId={validTemplate?.id} update={update} />}
          </Box>
          {showStepErrors && blockingFields.length > 0 && <Alert mt="lg" color="red" title="Complete this step">Correct the {blockingFields.length} highlighted field{blockingFields.length === 1 ? "" : "s"} before continuing.</Alert>}
          <Group className="wizard-stage-actions" justify="space-between" mt="xl">
            <Button variant="default" leftSection={<IconArrowLeft size={16} />} disabled={activeStep === 0 || submitting} onClick={() => { setShowStepErrors(false); setActiveStep((step) => Math.max(0, step - 1) as DeploymentWizardStep); }}>{t("common.back", "Back")}</Button>
            {activeStep < 3 ? <Button rightSection={<IconArrowRight size={16} />} onClick={nextStep}>{t("common.continue", "Continue")}</Button> : (
              <Group>
                <Button color="orange" variant="outline" leftSection={<IconTrash size={16} />} disabled={!cleanupTemplate || !selectedHostAvailable} onClick={() => setCleanupOpen(true)}>{t("openshift.cleanupSno", "Cleanup SNO")}</Button>
                <Button color="red" leftSection={<IconPlayerPlay size={16} />} disabled={!canLaunch} loading={submitting} onClick={() => void launchInstallation()}>{t("openshift.startSno", "Start SNO installation")}</Button>
              </Group>
            )}
          </Group>
        </Card>
      )}
      <Modal opened={resetOpen} onClose={() => setResetOpen(false)} title="Reset OpenShift configuration?" centered><Stack><Text size="sm">This clears every field, including sensitive values held in memory. No controller resource is changed.</Text><Group justify="flex-end"><Button variant="default" onClick={() => setResetOpen(false)}>{t("common.cancel", "Cancel")}</Button><Button color="red" onClick={resetForm}>{t("openshift.clearConfig", "Clear configuration")}</Button></Group></Stack></Modal>
      <Modal opened={cleanupOpen} onClose={() => setCleanupOpen(false)} title="Remove the managed SNO environment?" size="md" centered>
        <Stack gap="md">
          <Alert color="orange" title={t("openshift.destructiveCleanup", "Destructive cleanup")}>
            LinDeploy will remove the managed VM <strong>{values.vmName}</strong> and its disks on the selected provisioning host. The local Quay mirror registry and mirrored releases are always preserved.
          </Alert>
          <Text size="sm" c="dimmed">Choose whether to preserve the generated Agent ISO image for faster subsequent installations:</Text>
          
          <Card padding="sm" withBorder className="host-panel">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text fw={600} size="sm">{t("openshift.resetKeepIso", "Reset Cluster (Keep ISO)")}</Text>
                <Badge color="yellow" variant="light">Recommended</Badge>
              </Group>
              <Text size="xs" c="dimmed">
                Removes the VM and disk, but keeps the generated ISO image and mirror cache so future reinstallations boot in seconds without waiting to generate assets.
              </Text>
              <Button color="orange" variant="light" size="xs" loading={submitting} onClick={() => void launchCleanup(true)}>
                {t("openshift.resetKeepIso", "Reset & Keep ISO")}
              </Button>
            </Stack>
          </Card>

          <Card padding="sm" withBorder className="host-panel">
            <Stack gap="xs">
              <Text fw={600} size="sm">{t("openshift.fullUninstall", "Full Uninstall (Purge All)")}</Text>
              <Text size="xs" c="dimmed">
                Removes the VM, its disk, the runtime ISO from the storage pool, and deletes all cluster-specific installation assets.
              </Text>
              <Button color="red" variant="light" size="xs" loading={submitting} onClick={() => void launchCleanup(false)}>
                {t("openshift.fullUninstall", "Full Uninstall")}
              </Button>
            </Stack>
          </Card>

          <Group justify="flex-end">
            <Button variant="default" size="xs" onClick={() => setCleanupOpen(false)}>{t("common.cancel", "Cancel")}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
