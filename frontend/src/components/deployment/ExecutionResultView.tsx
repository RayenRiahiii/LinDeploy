import {
  Alert,
  Badge,
  Card,
  Code,
  Divider,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  formatDurationDetailed,
  getStatusColor,
} from "../../features/executions/presentation";
import { type LaunchResult } from "./types";

interface ExecutionResultViewProps {
  result: LaunchResult;
  resultTargetSummary: Record<string, number>;
}

export default function ExecutionResultView({
  result,
  resultTargetSummary,
}: ExecutionResultViewProps) {
  const { t } = useTranslation();

  return (
    <Card className="console-panel" padding="lg">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Title order={3}>{t("results.executionResult", "Execution Result")}</Title>
          <Badge
            color={getStatusColor(result.status)}
            variant="filled"
            size="lg"
          >
            {result.status}
          </Badge>
        </Group>

        <Text c="dimmed" size="sm">
          {t("results.resultSectionDesc", "This section summarizes the last execution. Use the success or failure report window for host-by-host diagnostics and next actions.")}
        </Text>

        <Group gap="xl">
          <Text>
            {t("results.executionReference", "Execution reference:")}{" "}
            {result.installation_id > 0
              ? `#${result.installation_id}`
              : t("results.notCreatedPreExec", "Not created (pre-execution failure)")}
          </Text>
          <Text>{t("results.message", "Message:")} {result.message}</Text>
          <Text>{t("results.returnCode", "Return code:")} {result.return_code ?? "-"}</Text>
          <Text>{t("results.executionTime", "Execution Time:")} {formatDurationDetailed(result.duration_seconds)}</Text>
        </Group>

        {result.targets && result.targets.length > 0 && (
          <>
            <SimpleGrid cols={{ base: 1, md: 4 }} spacing="sm">
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">{t("results.selectedTargets", "Selected Targets")}</Text>
                <Text fw={700}>{result.targets.length}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">{t("results.succeeded", "Succeeded")}</Text>
                <Text fw={700}>{resultTargetSummary.success || 0}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">{t("results.failed", "Failed")}</Text>
                <Text fw={700}>{resultTargetSummary.failed || 0}</Text>
              </Card>
              <Card className="host-panel" padding="sm">
                <Text size="sm" c="dimmed">{t("results.otherStates", "Other States")}</Text>
                <Text fw={700}>
                  {(resultTargetSummary.pending || 0) +
                    (resultTargetSummary.running || 0) +
                    (resultTargetSummary.cancelled || 0)}
                </Text>
              </Card>
            </SimpleGrid>

            <Table withTableBorder striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("results.target", "Target")}</Table.Th>
                  <Table.Th>{t("common.status", "Status")}</Table.Th>
                  <Table.Th>{t("results.returnCode", "Return Code")}</Table.Th>
                  <Table.Th>{t("results.detail", "Detail")}</Table.Th>
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

        {result.timings && (
          <SimpleGrid cols={{ base: 1, md: 4 }} spacing="sm">
            <Card className="host-panel" padding="sm">
              <Text size="sm" c="dimmed">{t("results.inventoryTiming", "Inventory")}</Text>
              <Text fw={700}>
                {formatDurationDetailed(result.timings.inventory_build_seconds)}
              </Text>
            </Card>
            <Card className="host-panel" padding="sm">
              <Text size="sm" c="dimmed">{t("results.repoDiscoveryTiming", "Repo Discovery")}</Text>
              <Text fw={700}>
                {formatDurationDetailed(result.timings.repo_discovery_seconds)}
              </Text>
            </Card>
            <Card className="host-panel" padding="sm">
              <Text size="sm" c="dimmed">{t("results.sshCheckTiming", "SSH Check")}</Text>
              <Text fw={700}>
                {formatDurationDetailed(result.timings.ssh_check_seconds)}
              </Text>
            </Card>
            <Card className="host-panel" padding="sm">
              <Text size="sm" c="dimmed">{t("results.playbookTiming", "Playbook")}</Text>
              <Text fw={700}>
                {formatDurationDetailed(result.timings.playbook_execution_seconds)}
              </Text>
            </Card>
          </SimpleGrid>
        )}

        {result.bottleneck_hints && result.bottleneck_hints.length > 0 && (
          <>
            <Divider />
            <Title order={5}>{t("results.likelyBottlenecks", "Likely Bottlenecks")}</Title>
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
            <Title order={5}>{t("results.slowestTasks", "Slowest Tasks")}</Title>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("results.task", "Task")}</Table.Th>
                  <Table.Th>{t("results.duration", "Duration")}</Table.Th>
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
            <Title order={5}>{t("results.command", "Command")}</Title>
            <Code block>{result.command}</Code>
          </>
        )}

        {result.rawOutput && (
          <>
            <Divider />
            <Title order={5}>{t("results.rawOutput", "Raw Output")}</Title>
            <ScrollArea.Autosize mah={220}>
              <Code block>{result.rawOutput}</Code>
            </ScrollArea.Autosize>
          </>
        )}

        {result.stdout && (
          <>
            <Divider />
            <Title order={5}>{t("results.stdout", "Stdout")}</Title>
            <ScrollArea.Autosize mah={320}>
              <Code block>{result.stdout}</Code>
            </ScrollArea.Autosize>
          </>
        )}

        {result.stderr && (
          <>
            <Divider />
            <Title order={5}>{t("results.stderr", "Stderr")}</Title>
            <ScrollArea.Autosize mah={220}>
              <Code block>{result.stderr}</Code>
            </ScrollArea.Autosize>
          </>
        )}
      </Stack>
    </Card>
  );
}

