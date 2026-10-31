import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconLink,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { type DeploymentTopology } from "../../installers/DeploymentTopologySelector";
import { type Host } from "../types";

interface TargetExecutionStepProps {
  topology: DeploymentTopology;
  selectedHostIds: number[];
  controlPlaneHostIds: number[];
  workerHostIds: number[];
  bootstrapHost?: Host;
  topologyReady: boolean;
  loading: boolean;
  checkingConnectivity: boolean;
  deploymentMode: "auto" | "manual";
  selectedTemplateId: number | null;
  hasCleanupOption: boolean;
  activeInstallationId: number | null;
  showGuidedInstaller: boolean;
  cancelLabel?: string;
  onVerifySsh: () => void | Promise<void>;
  onLaunch: () => void | Promise<void>;
  onCleanupLaunch: () => void | Promise<void>;
  onCancelInstallation: () => void | Promise<void>;
  onBack?: () => void;
}

export default function TargetExecutionStep({
  topology,
  selectedHostIds,
  controlPlaneHostIds,
  workerHostIds,
  bootstrapHost,
  topologyReady,
  loading,
  checkingConnectivity,
  deploymentMode,
  selectedTemplateId,
  hasCleanupOption,
  activeInstallationId,
  showGuidedInstaller,
  cancelLabel,
  onVerifySsh,
  onLaunch,
  onCleanupLaunch,
  onCancelInstallation,
  onBack,
}: TargetExecutionStepProps) {
  const { t } = useTranslation();

  return (
    <Card className="console-panel" padding="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={3}>{t("execution.startInstallation", "Start Installation")}</Title>
            <Text size="sm" c="dimmed" mt={4}>
              {t("execution.startInstallationDesc", "Confirm the selected targets, verify SSH access, then start the installer on all eligible hosts.")}
            </Text>
          </div>
          <Badge color={topologyReady ? "teal" : "gray"} variant="light">
            {topologyReady
              ? t("execution.readyToVerify", "ready to verify")
              : topology === "multi_node"
                ? t("execution.rolesRequired", "roles required")
                : t("execution.targetRequired", "target required")}
          </Badge>
        </Group>

        <div className="action-command-grid">
          <div className="action-command-panel">
            <Stack gap="md">
              <Title order={4}>{t("execution.currentTargets", "Current Targets")}</Title>

              {selectedHostIds.length > 0 ? (
                <>
                  <SimpleGrid
                    cols={{ base: 1, sm: 2, lg: topology === "multi_node" ? 3 : 2 }}
                    spacing="sm"
                  >
                    <Card className="host-panel" padding="sm">
                      <Text size="sm" c="dimmed">{t("execution.selectedHosts", "Selected Hosts")}</Text>
                      <Text fw={700}>{selectedHostIds.length}</Text>
                    </Card>
                    <Card className="host-panel" padding="sm">
                      <Text size="sm" c="dimmed">{t("wizard.stepTopology", "Topology")}</Text>
                      <Text fw={700}>
                        {topology === "multi_node"
                          ? t("execution.oneSharedCluster", "One shared multi-node cluster")
                          : t("execution.independentClusters", "Independent single-node clusters")}
                      </Text>
                    </Card>
                    {topology === "multi_node" && (
                      <>
                        <Card className="host-panel" padding="sm">
                          <Text size="sm" c="dimmed">{t("execution.controlPlaneNodes", "Control Plane")}</Text>
                          <Text fw={700}>{controlPlaneHostIds.length}</Text>
                        </Card>
                        <Card className="host-panel" padding="sm">
                          <Text size="sm" c="dimmed">{t("execution.workerNodes", "Workers")}</Text>
                          <Text fw={700}>{workerHostIds.length}</Text>
                        </Card>
                        <Card className="host-panel" padding="sm">
                          <Text size="sm" c="dimmed">{t("execution.bootstrapHost", "Bootstrap Host")}</Text>
                          <Text fw={700}>{bootstrapHost?.name || t("execution.notSelected", "Not selected")}</Text>
                        </Card>
                      </>
                    )}
                  </SimpleGrid>

                  <Alert color={topologyReady ? "blue" : "yellow"} variant="light">
                    {topology === "multi_node"
                      ? topologyReady
                        ? `The backend will generate one inventory with ${controlPlaneHostIds.length} control-plane host(s), ${workerHostIds.length} worker host(s), and ${bootstrapHost?.name} as bootstrap.`
                        : "Complete the control-plane, worker, and bootstrap assignments before starting the shared cluster installation."
                      : "The playbook will run on every selected target in the generated inventory. Host access settings remain managed from the Hosts inventory."}
                  </Alert>
                </>
              ) : (
                <Text c="dimmed">
                  {t("execution.selectAtLeastOneHost", "Select at least one host to unlock SSH verification and playbook execution.")}
                </Text>
              )}
            </Stack>
          </div>

          <div className="action-command-panel">
            <Stack gap="md">
              <Title order={4}>{t("checklist.title", "Operator Checklist")}</Title>
              <div className="action-checklist">
                <div className="action-check-item">
                  <ThemeIcon color="red" variant="light" radius="xl" size={26}>
                    <IconLink size={14} />
                  </ThemeIcon>
                  <div>
                    <Text fw={700}>{t("checklist.verifySshTitle", "Run Verify SSH first")}</Text>
                    <Text size="sm" c="dimmed">
                      {t("checklist.verifySshDesc", "Confirm connectivity before any playbook execution starts.")}
                    </Text>
                  </div>
                </div>
                <div className="action-check-item">
                  <ThemeIcon color="red" variant="light" radius="xl" size={26}>
                    <IconPlayerPlay size={14} />
                  </ThemeIcon>
                  <div>
                    <Text fw={700}>{t("checklist.runPlaybookTitle", "Run Playbook after access validation")}</Text>
                    <Text size="sm" c="dimmed">
                      {t("checklist.runPlaybookDesc", "The execution monitor below captures the live Ansible state, timings, and final result.")}
                    </Text>
                  </div>
                </div>
                <div className="action-check-item">
                  <ThemeIcon color="orange" variant="light" radius="xl" size={26}>
                    <IconRefresh size={14} />
                  </ThemeIcon>
                  <div>
                    <Text fw={700}>{t("checklist.cleanupTitle", "Use Cleanup Options when needed")}</Text>
                    <Text size="sm" c="dimmed">
                      {t("checklist.cleanupDesc", "Reset cluster state for a fast reinstall or fully uninstall the platform from the target host.")}
                    </Text>
                  </div>
                </div>
              </div>
            </Stack>
          </div>
        </div>

        <Group className="wizard-stage-actions">
          {showGuidedInstaller && (
            <Button
              variant="default"
              onClick={onBack}
              disabled={loading}
              leftSection={<IconArrowLeft size={16} />}
            >
              {t("targets.backToTargets", "Back to targets")}
            </Button>
          )}
          <Button
            variant="default"
            onClick={() => void onVerifySsh()}
            loading={checkingConnectivity}
            disabled={selectedHostIds.length === 0 || loading}
            leftSection={<IconLink size={16} />}
          >
            {t("execution.verifySsh", "Verify SSH")}
          </Button>

          <Button
            onClick={() => void onLaunch()}
            loading={loading}
            disabled={
              !topologyReady ||
              checkingConnectivity ||
              (deploymentMode === "manual" && !selectedTemplateId)
            }
            leftSection={<IconPlayerPlay size={16} />}
          >
            {t("execution.runPlaybook", "Run Playbook")}
          </Button>

          {hasCleanupOption && (
            <Button
              color="orange"
              variant="light"
              onClick={() => void onCleanupLaunch()}
              disabled={selectedHostIds.length === 0 || checkingConnectivity || loading}
            >
              {t("execution.cleanupCluster", "Cleanup Options")}
            </Button>
          )}

          {loading && activeInstallationId !== null && (
            <Button
              color="red"
              onClick={() => void onCancelInstallation()}
              leftSection={<IconPlayerStop size={16} />}
            >
              {cancelLabel || t("execution.cancelInstallation", "Cancel Installation")}
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}
