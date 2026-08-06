import {
  Badge,
  Card,
  Group,
  Progress,
  RingProgress,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconCheck, IconClockHour4 } from "@tabler/icons-react";
import {
  type ExecutionStage,
  formatDuration,
  formatPhaseLabel,
  getStatusColor,
} from "../../features/executions/presentation";

type LiveExecution = {
  status?: string;
  phase?: string;
  title: string;
  summaryMessage?: string;
  currentPlay?: string;
  currentRole?: string;
  currentTask?: string;
  seenTasks: number;
  completedTasks: number;
  progress: number;
  elapsedSeconds: number;
  installationId?: number | null;
};

type LastExecution = {
  status?: string;
  message?: string;
  durationSeconds?: number | null;
  installationId?: number | null;
};

type DeploymentMonitorProps = {
  loading: boolean;
  live: LiveExecution;
  result?: LastExecution;
  activeStage: ExecutionStage;
  stages: ExecutionStage[];
  pipelineStageIndex: number;
};

export default function DeploymentMonitor({
  loading,
  live,
  result,
  activeStage,
  stages,
  pipelineStageIndex,
}: DeploymentMonitorProps) {
  const status = loading ? live.status : result?.status;
  const statusColor = getStatusColor(status) === "gray" ? "teal" : getStatusColor(status);
  const progress = loading ? live.progress : result?.status === "success" ? 100 : 0;
  const duration = loading ? live.elapsedSeconds : result?.durationSeconds;
  const installationId = loading ? live.installationId : result?.installationId;

  return (
    <Card className="console-panel" padding="lg">
      <Stack gap="lg">
        <Group justify="space-between" align="center">
          <div>
            <Title order={3}>Deployment Monitor</Title>
            <Text size="sm" c="dimmed" mt={4}>
              Live progress and pipeline status for the current installer run.
            </Text>
          </div>
          <Badge color={loading ? "red" : getStatusColor(result?.status)} variant="light">
            {loading ? "running" : `last run ${result?.status ?? "idle"}`}
          </Badge>
        </Group>

        <div className="monitor-layout">
          <div className="monitor-progress-panel">
            <Group justify="space-between" align="flex-start">
              <div className="progress-metric-shell">
                <RingProgress
                  size={132}
                  thickness={10}
                  roundCaps
                  sections={[{ value: progress, color: statusColor }]}
                  label={
                    <Stack gap={0} align="center" justify="center">
                      <Text size="xl" fw={800}>{progress}%</Text>
                      <Text size="11px" c="dimmed">{formatDuration(duration)}</Text>
                    </Stack>
                  }
                />
              </div>

              <div className="monitor-details">
                <Title order={4}>{loading ? live.title : "Last Execution Result"}</Title>
                <Text c="dimmed" size="sm" mt={4}>
                  {loading ? activeStage.label : result?.message || "No execution yet."}
                </Text>
                <Text c="dimmed" size="sm">
                  {loading
                    ? activeStage.detail
                    : result?.status === "success"
                      ? "The installer completed and the target cluster is ready for validation."
                      : result?.status === "failed"
                        ? "The installer stopped before cluster validation completed."
                        : "Launch a playbook to start tracking pipeline execution."}
                </Text>

                {loading && live.summaryMessage && <Text size="sm" mt={6}>{live.summaryMessage}</Text>}

                {loading && (live.currentPlay || live.currentTask) && (
                  <Text size="sm" mt={6}>
                    {live.currentPlay ? `Play: ${live.currentPlay}` : ""}
                    {live.currentPlay && live.currentTask ? " | " : ""}
                    {live.currentRole ? `Role: ${live.currentRole}` : ""}
                    {live.currentRole && live.currentTask ? " | " : ""}
                    {live.currentTask ? `Task: ${live.currentTask}` : ""}
                  </Text>
                )}

                {loading && (live.seenTasks > 0 || live.completedTasks > 0) && (
                  <Text size="sm" mt={6}>
                    Seen tasks: {live.seenTasks} | Completed tasks: {live.completedTasks}
                  </Text>
                )}

                <Group gap="xs" mt={10}>
                  {status && (
                    <Badge color={getStatusColor(status)} variant="light">
                      {loading ? `${status} | ${formatPhaseLabel(stages, live.phase)}` : status}
                    </Badge>
                  )}
                  {installationId && (
                    <Badge color="gray" variant="outline">installation #{installationId}</Badge>
                  )}
                </Group>
              </div>

              <Badge color="red" variant="filled">elapsed: {formatDuration(duration)}</Badge>
            </Group>

            <Progress
              mt="md"
              value={progress}
              color={statusColor}
              size="lg"
              radius="xl"
              animated={loading}
            />
          </div>

          <div className="monitor-pipeline-panel">
            <Text fw={600} mb="sm">Pipeline</Text>
            <Stack gap="sm">
              {stages.map((stage, index) => {
                const completed =
                  pipelineStageIndex >= 0 &&
                  ((!loading && result?.status === "success" && index <= pipelineStageIndex) ||
                    (loading &&
                      (index < pipelineStageIndex ||
                        (live.progress >= 100 && index <= pipelineStageIndex))));
                const current = loading && index === pipelineStageIndex;

                return (
                  <div
                    key={stage.phase}
                    className={`monitor-stage-row${completed ? " is-completed" : ""}${current ? " is-current" : ""}`}
                  >
                    <ThemeIcon
                      size="sm"
                      radius="xl"
                      color={completed ? "teal" : current ? "red" : "gray"}
                      variant={completed || current ? "filled" : "light"}
                    >
                      {completed ? <IconCheck size={12} /> : <IconClockHour4 size={12} />}
                    </ThemeIcon>
                    <div>
                      <Text fw={current ? 700 : 600} size="sm">{stage.label}</Text>
                      <Text size="xs" c="dimmed">{stage.detail}</Text>
                    </div>
                  </div>
                );
              })}
            </Stack>
          </div>
        </div>
      </Stack>
    </Card>
  );
}
