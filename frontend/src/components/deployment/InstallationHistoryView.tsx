import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import InstallerLabel from "../installers/InstallerLabel";
import { getInstallerOption } from "../../features/installers/catalog";
import {
  formatDurationDetailed,
  getStatusColor,
} from "../../features/executions/presentation";
import { formatHistoryDate, getInstallationCleanupSystem } from "./presentation";
import {
  type InstallationDetailResponse,
  type Template,
  type RunDeploymentMode,
} from "./types";

interface InstallationHistoryViewProps {
  historyInstallations: InstallationDetailResponse[];
  mode?: RunDeploymentMode;
  loading?: boolean;
  clearingHistory: boolean;
  deletingHistoryInstallationId: number | null;
  cleanupTemplatesBySystem: Record<string, Record<string, Template>>;
  formatPhaseLabel: (phase?: string) => string;
  onClearHistory: () => Promise<void> | void;
  onDeleteHistoryInstallation: (id: number) => Promise<void> | void;
  onInstallationCleanupLaunch?: (installation: InstallationDetailResponse) => Promise<void> | void;
}

export default function InstallationHistoryView({
  historyInstallations,
  mode = "full",
  loading = false,
  clearingHistory,
  deletingHistoryInstallationId,
  cleanupTemplatesBySystem,
  formatPhaseLabel,
  onClearHistory,
  onDeleteHistoryInstallation,
  onInstallationCleanupLaunch,
}: InstallationHistoryViewProps) {
  return (
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
              onClick={() => void onClearHistory()}
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
          <ScrollArea.Autosize mah={mode === "history" ? 640 : "65vh"}>
            <Table className="installation-history-table" striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Run</Table.Th>
                  <Table.Th>Installer</Table.Th>
                  <Table.Th>Operation</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Targets</Table.Th>
                  <Table.Th>Duration</Table.Th>
                  <Table.Th>Actions</Table.Th>
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
                      <Table.Td>
                        <Text fw={700}>#{installation.id}</Text>
                        <Text size="xs" c="dimmed">
                          {formatHistoryDate(installation.started_at || installation.created_at)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <InstallerLabel
                          label={
                            installation.template_system_type
                              ? getInstallerOption(installation.template_system_type).label
                              : installation.template_name
                          }
                          installerId={installation.template_system_type}
                          withLogo={Boolean(installation.template_system_type)}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Text fw={700} size="sm">
                          {installation.deployment_type === "cleanup"
                            ? "Cleanup"
                            : installation.topology === "multi_node"
                              ? "Multi-node installation"
                              : "Single-node installation"}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {formatPhaseLabel(installation.phase)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={getStatusColor(installation.status)} variant="light">
                          {installation.status}
                        </Badge>
                      </Table.Td>
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
                            hasRegisteredCleanup &&
                            onInstallationCleanupLaunch && (
                              <Button
                                size="xs"
                                color={requiresDifferentSystemCleanup ? "red" : "orange"}
                                variant="light"
                                disabled={loading}
                                onClick={() => void onInstallationCleanupLaunch(installation)}
                              >
                                {requiresDifferentSystemCleanup
                                  ? `Cleanup ${cleanupSystem ? getInstallerOption(cleanupSystem).label : "Target"}`
                                  : "Cleanup"}
                              </Button>
                            )}
                          <Button
                            size="xs"
                            color="red"
                            variant="light"
                            leftSection={<IconTrash size={14} />}
                            loading={deletingHistoryInstallationId === installation.id}
                            onClick={() => void onDeleteHistoryInstallation(installation.id)}
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
}

