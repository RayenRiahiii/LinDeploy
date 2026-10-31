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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

  return (
    <Card className="console-panel" padding="lg">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <div>
            <Title order={3}>{t("history.title", "Installation History")}</Title>
            <Text size="sm" c="dimmed" mt={4}>
              {t("history.description", "Stored runs are kept outside the live monitor and can be deleted permanently from here.")}
            </Text>
          </div>
          <Group gap="sm">
            <Badge color="red" variant="light">
              {t("history.savedRuns", { count: historyInstallations.length, defaultValue: `saved ${historyInstallations.length}` })}
            </Badge>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={() => void onClearHistory()}
              loading={clearingHistory}
              disabled={historyInstallations.length === 0}
            >
              {t("history.deleteAll", "Delete All History")}
            </Button>
          </Group>
        </Group>

        {historyInstallations.length === 0 ? (
          <Alert color="gray" variant="light">
            {t("history.noHistory", "No saved installation history remains.")}
          </Alert>
        ) : (
          <ScrollArea.Autosize mah={mode === "history" ? 640 : "65vh"}>
            <Table className="installation-history-table" striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("history.run", "Run")}</Table.Th>
                  <Table.Th>{t("history.installer", "Installer")}</Table.Th>
                  <Table.Th>{t("history.operation", "Operation")}</Table.Th>
                  <Table.Th>{t("history.status", "Status")}</Table.Th>
                  <Table.Th>{t("history.targets", "Targets")}</Table.Th>
                  <Table.Th>{t("history.duration", "Duration")}</Table.Th>
                  <Table.Th>{t("history.actions", "Actions")}</Table.Th>
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
                            ? t("results.cleanup", "Cleanup")
                            : installation.topology === "multi_node"
                              ? t("topology.multiNode", "Multi-node installation")
                              : t("topology.singleNode", "Single-node installation")}
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
                            {t("history.totalTargets", { count: installation.targets.length, defaultValue: `total ${installation.targets.length}` })}
                          </Badge>
                          <Badge color="teal" variant="light">
                            {t("history.okTargets", { count: installation.targets.filter((target) => target.status === "success").length, defaultValue: `ok ${installation.targets.filter((target) => target.status === "success").length}` })}
                          </Badge>
                          <Badge color="red" variant="light">
                            {t("history.failedTargets", { count: installation.targets.filter((target) => target.status === "failed").length, defaultValue: `failed ${installation.targets.filter((target) => target.status === "failed").length}` })}
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
                                  ? t("history.cleanupTarget", { target: cleanupSystem ? getInstallerOption(cleanupSystem).label : "Target", defaultValue: `Cleanup ${cleanupSystem ? getInstallerOption(cleanupSystem).label : "Target"}` })
                                  : t("results.cleanup", "Cleanup")}
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
                            {t("common.delete", "Delete")}
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

