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
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconRefresh } from "@tabler/icons-react";
import { getStatusColor } from "../../../features/executions/presentation";
import { type InstallerId } from "../../../features/installers/catalog";
import {
  extractTargetDiagnostics,
  getExecutionPresentation,
  getFailureStage,
  getTargetOperatorAction,
} from "../presentation";
import { type InstallationTarget, type LaunchResult } from "../types";

type DeploymentFailureModalProps = {
  opened: boolean;
  onClose: () => void;
  result: LaunchResult | null;
  isCleanupExecution: boolean;
  activeInstallerSystem: InstallerId;
  activeInstallerLabel: string;
  resultTargetSummary: Record<string, number>;
  failedResultTargets: InstallationTarget[];
  succeededResultTargets: InstallationTarget[];
  postInstallChecks: string[];
  canCleanupResult: boolean;
  canRetryFailedTargets: boolean;
  onLaunchCleanup: () => void;
  onRetryFailedTargets: () => void;
  onOpenOpenShiftRetryDialog?: () => void;
};

export default function DeploymentFailureModal({
  opened,
  onClose,
  result,
  isCleanupExecution,
  activeInstallerSystem,
  activeInstallerLabel,
  resultTargetSummary,
  failedResultTargets,
  succeededResultTargets,
  postInstallChecks,
  canCleanupResult,
  canRetryFailedTargets,
  onLaunchCleanup,
  onRetryFailedTargets,
  onOpenOpenShiftRetryDialog,
}: DeploymentFailureModalProps) {
  const isResetExecution = (result?.template_name || "").toLowerCase().includes("reset");
  const presentation = getExecutionPresentation(result?.status, isCleanupExecution, activeInstallerLabel, isResetExecution);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isResetExecution ? "Reset Report" : isCleanupExecution ? "Cleanup Report" : result?.status === "cancelled" ? "Cancelled Execution Report" : "Deployment Report"}
      size="78rem"
      centered
      classNames={{ content: "failure-modal-content", header: "terminal-modal-header" }}
    >
      <Stack gap="lg">
        <Stack gap="md" align="center" className="modal-status-hero">
          <ThemeIcon
            size={72}
            radius={18}
            color={result?.status === "cancelled" ? "yellow" : result?.status === "partial_success" ? "yellow" : "red"}
            variant="light"
          >
            <IconAlertCircle size={42} />
          </ThemeIcon>
          <div>
            <Title order={2}>{presentation.title}</Title>
            <Text c="dimmed" size="sm" mt={4}>
              {presentation.summary}
            </Text>
          </div>
        </Stack>

        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md" className="modal-summary-grid">
          <Card className="host-panel" padding="sm">
            <Text size="sm" c="dimmed">Execution Reference</Text>
            <Text fw={700}>
              {result && result.installation_id > 0 ? `#${result.installation_id}` : "Pre-execution"}
            </Text>
          </Card>
          <Card className="host-panel" padding="sm">
            <Text size="sm" c="dimmed">Status</Text>
            <Text fw={700}>{result?.status || "-"}</Text>
          </Card>
          <Card className="host-panel" padding="sm">
            <Text size="sm" c="dimmed">Failure Stage</Text>
            <Text fw={700}>{getFailureStage(result?.message)}</Text>
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
                      <div>
                        <Text fw={700}>{target.host_name}</Text>
                        {(target.node_name || target.cluster_name) && (
                          <Text size="xs" c="dimmed" mt={2}>
                            Node: {target.node_name || "automatic"} | Cluster: {target.cluster_name || "automatic"}
                          </Text>
                        )}
                      </div>
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
                      <div>
                        <Text fw={700}>{target.host_name}</Text>
                        {(target.node_name || target.cluster_name) && (
                          <Text size="xs" c="dimmed" mt={2}>
                            Node: {target.node_name || "automatic"} | Cluster: {target.cluster_name || "automatic"}
                          </Text>
                        )}
                      </div>
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

        <Group justify="space-between" wrap="wrap">
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
          <Group>
            {canCleanupResult && (
              <Button color="red" onClick={onLaunchCleanup}>
                Cleanup Options
              </Button>
            )}
            {canRetryFailedTargets && (
              <Button
                variant="light"
                leftSection={<IconRefresh size={16} />}
                onClick={
                  activeInstallerSystem === "openshift_sno" && onOpenOpenShiftRetryDialog
                    ? onOpenOpenShiftRetryDialog
                    : onRetryFailedTargets
                }
              >
                {activeInstallerSystem === "openshift_sno" ? "Restart same installation" : "Retry Failed Targets Only"}
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
