import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { formatDurationDetailed, getStatusColor } from "../../../features/executions/presentation";
import { getInstallerLogo, type InstallerId } from "../../../features/installers/catalog";
import InstallerLabel from "../../installers/InstallerLabel";
import {
  extractTargetDiagnostics,
  getExecutionPresentation,
  getTargetOperatorAction,
} from "../presentation";
import { type ClusterConfig, type LaunchResult } from "../types";

type DeploymentSuccessModalProps = {
  opened: boolean;
  onClose: () => void;
  result: LaunchResult | null;
  clusterConfig: ClusterConfig;
  isCleanupExecution: boolean;
  activeInstallerSystem: InstallerId;
  activeInstallerLabel: string;
  clusterTargetHosts: string[];
  clusterControlPlaneCount: number;
  clusterWorkerCount: number;
  clusterTopologyLabel: string;
  postInstallChecks: string[];
  canCleanupResult: boolean;
  onLaunchCleanup: () => void;
};

export default function DeploymentSuccessModal({
  opened,
  onClose,
  result,
  clusterConfig,
  isCleanupExecution,
  activeInstallerSystem,
  activeInstallerLabel,
  clusterTargetHosts,
  clusterControlPlaneCount,
  clusterWorkerCount,
  clusterTopologyLabel,
  postInstallChecks,
  canCleanupResult,
  onLaunchCleanup,
}: DeploymentSuccessModalProps) {
  const presentation = getExecutionPresentation(result?.status, isCleanupExecution, activeInstallerLabel);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
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
            <Title order={2}>{presentation.title}</Title>
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
            <Text fw={700}>
              {isCleanupExecution
                ? "Cluster cleanup"
                : result?.cluster_config?.cluster_name || clusterConfig.cluster_name}
            </Text>
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
                <Text fw={700}>
                  {result?.cluster_config?.control_plane_count ?? clusterControlPlaneCount}
                </Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">Worker Nodes</Text>
                <Text fw={700}>
                  {result?.cluster_config?.worker_count ?? clusterWorkerCount}
                </Text>
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
                      <div>
                        <Text fw={700}>{target.host_name}</Text>
                        {!isCleanupExecution && (target.node_name || target.cluster_name) && (
                          <Text size="xs" c="dimmed" mt={2}>
                            Node: {target.node_name || "automatic"} | Cluster: {target.cluster_name || "automatic"}
                          </Text>
                        )}
                      </div>
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
                      {target.output ||
                        (isCleanupExecution
                          ? "Cleanup completed on this target."
                          : "Installation completed on this target.")}
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
          {presentation.recommendation}
        </Alert>

        <Group gap="xl">
          <Text>Installation ID: {result?.installation_id ?? "-"}</Text>
          <Text>Duration: {formatDurationDetailed(result?.duration_seconds)}</Text>
        </Group>

        {canCleanupResult && (
          <Group>
            <Button color="red" onClick={onLaunchCleanup}>
              Cleanup Options
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

