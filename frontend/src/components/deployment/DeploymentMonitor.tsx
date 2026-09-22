import {
  Badge,
  Button,
  Card,
  Checkbox,
  CloseButton,
  Group,
  Modal,
  Progress,
  RingProgress,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconActivity,
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClockHour4,
  IconPlayerStop,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  totalTasks: number;
  progress: number;
  elapsedSeconds: number;
  installationId?: number | null;
  recentEvents?: Array<{
    kind: "play_started" | "task_started" | "task_result";
    play?: string;
    role?: string;
    task?: string;
    host?: string;
    status?: string;
    line?: string;
    timestamp?: string;
  }>;
  outputLines?: Array<{
    channel: string;
    line: string;
    timestamp?: string;
  }>;
  telemetry?: {
    total_percentage?: number;
    cluster_status?: string;
    stage?: string;
    stage_percentage?: number;
    progress_info?: string;
  };
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
  actions?: ReactNode;
  onCancel?: () => void;
};

function getLineClass(line: string, channel: string): string | undefined {
  if (channel === "stderr") return "is-stderr";
  const trimmed = line.trimStart();
  if (trimmed.startsWith("TASK [") || trimmed.startsWith("TASK:")) return "line-task";
  if (trimmed.startsWith("PLAY [") || trimmed.startsWith("PLAY RECAP")) return "line-play";
  if (trimmed.startsWith("fatal:") || trimmed.includes("FAILED!")) return "line-fatal";
  if (trimmed.startsWith("ok:") || trimmed.startsWith("ok: [")) return "line-ok";
  if (trimmed.startsWith("changed:") || trimmed.startsWith("changed: [")) return "line-changed";
  if (trimmed.startsWith("skipping:") || trimmed.startsWith("skipping: [")) return "line-skipping";
  return undefined;
}

export default function DeploymentMonitor({
  loading,
  live,
  result,
  activeStage,
  stages,
  pipelineStageIndex,
  actions,
  onCancel,
}: DeploymentMonitorProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const status = loading ? live.status : result?.status;
  const statusColor = getStatusColor(status) === "gray" ? "teal" : getStatusColor(status);
  const progress = loading ? live.progress : result ? 100 : 0;
  const duration = loading ? live.elapsedSeconds : result?.durationSeconds;
  const installationId = loading ? live.installationId : result?.installationId;
  const recentEvents = useMemo(() => live.recentEvents || [], [live.recentEvents]);
  const outputLines = useMemo(() => live.outputLines || [], [live.outputLines]);
  const outputViewportRef = useRef<HTMLDivElement>(null);

  // Live per-task timer
  const [taskStartTime, setTaskStartTime] = useState<number>(Date.now());
  const [taskElapsedSeconds, setTaskElapsedSeconds] = useState<number>(0);
  const prevTaskRef = useRef<string | undefined>(live.currentTask);

  // Heartbeat tracking
  const [lastActivityTime, setLastActivityTime] = useState<number>(Date.now());
  const [secondsSinceActivity, setSecondsSinceActivity] = useState<number>(0);
  const prevOutputCountRef = useRef<number>(outputLines.length);
  const prevCompletedTasksRef = useRef<number>(live.completedTasks);

  // Log filters
  const [hideSkipping, setHideSkipping] = useState<boolean>(true);
  const [errorsOnly, setErrorsOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Smart scroll pinning
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const prevFilteredCountRef = useRef<number>(0);

  // Reset task timer whenever currentTask changes
  useEffect(() => {
    if (live.currentTask && live.currentTask !== prevTaskRef.current) {
      prevTaskRef.current = live.currentTask;
      setTaskStartTime(Date.now());
      setTaskElapsedSeconds(0);
    }
  }, [live.currentTask]);

  // Record heartbeat whenever new lines or completed tasks arrive
  useEffect(() => {
    if (
      outputLines.length !== prevOutputCountRef.current ||
      live.completedTasks !== prevCompletedTasksRef.current
    ) {
      prevOutputCountRef.current = outputLines.length;
      prevCompletedTasksRef.current = live.completedTasks;
      setLastActivityTime(Date.now());
      setSecondsSinceActivity(0);
    }
  }, [outputLines.length, live.completedTasks]);

  // 1-second interval to tick the live stopwatch and heartbeat
  useEffect(() => {
    if (!loading) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setTaskElapsedSeconds(Math.max(0, Math.floor((now - taskStartTime) / 1000)));
      setSecondsSinceActivity(Math.max(0, Math.floor((now - lastActivityTime) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [loading, taskStartTime, lastActivityTime]);

  const heartbeatStatus = useMemo(() => {
    if (!loading) return null;
    if (secondsSinceActivity < 15) {
      return {
        color: "teal",
        label: `Active (heartbeat ${secondsSinceActivity}s ago)`,
      };
    }
    if (secondsSinceActivity < 60) {
      return {
        color: "blue",
        label: `Working (${secondsSinceActivity}s ago)`,
      };
    }
    return {
      color: "yellow",
      label: `In progress (${formatDuration(secondsSinceActivity)} since last event)`,
    };
  }, [loading, secondsSinceActivity]);

  const filteredLines = useMemo(() => {
    let resultLines = outputLines;
    if (hideSkipping) {
      resultLines = resultLines.filter(
        (item) => !item.line.includes("skipping: [") && !item.line.startsWith("skipping:")
      );
    }
    if (errorsOnly) {
      resultLines = resultLines.filter(
        (item) =>
          item.channel === "stderr" ||
          item.line.toLowerCase().includes("fatal:") ||
          item.line.toLowerCase().includes("failed") ||
          item.line.toLowerCase().includes("error")
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      resultLines = resultLines.filter((item) => item.line.toLowerCase().includes(q));
    }
    return resultLines;
  }, [outputLines, hideSkipping, errorsOnly, searchQuery]);

  const hostActivity = useMemo(() => {
    const hosts = new Map<string, { status: string; results: number; task: string }>();

    recentEvents.forEach((event) => {
      if (!event.host) {
        return;
      }

      const current = hosts.get(event.host) || { status: "running", results: 0, task: "" };
      hosts.set(event.host, {
        status: event.status || current.status,
        results: current.results + (event.kind === "task_result" ? 1 : 0),
        task: event.task || current.task,
      });
    });

    return Array.from(hosts.entries());
  }, [recentEvents]);

  function eventColor(eventStatus?: string) {
    if (eventStatus === "failed" || eventStatus === "unreachable") return "red";
    if (eventStatus === "ok" || eventStatus === "changed") return "teal";
    if (eventStatus === "skipping") return "gray";
    return "blue";
  }

  const handleScrollPositionChange = ({ y }: { x: number; y: number }) => {
    if (!outputViewportRef.current) return;
    const { scrollHeight, clientHeight } = outputViewportRef.current;
    const isNearBottom = scrollHeight - y - clientHeight < 50;
    if (isNearBottom) {
      setAutoScroll(true);
      setUnreadCount(0);
    } else {
      setAutoScroll(false);
    }
  };

  const scrollToBottom = () => {
    if (outputViewportRef.current) {
      outputViewportRef.current.scrollTo({
        top: outputViewportRef.current.scrollHeight,
        behavior: "smooth",
      });
      setAutoScroll(true);
      setUnreadCount(0);
    }
  };

  useEffect(() => {
    if (!loading) {
      setDetailsOpen(false);
    }
  }, [loading]);

  useEffect(() => {
    if (!detailsOpen || !outputViewportRef.current) {
      return;
    }

    if (autoScroll) {
      outputViewportRef.current.scrollTop = outputViewportRef.current.scrollHeight;
    } else {
      const added = filteredLines.length - prevFilteredCountRef.current;
      if (added > 0) {
        setUnreadCount((c) => c + added);
      }
    }
    prevFilteredCountRef.current = filteredLines.length;
  }, [detailsOpen, filteredLines.length, autoScroll]);

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
          <Group className="monitor-header-actions" gap="sm" justify="flex-end">
            <Badge color={loading ? "red" : getStatusColor(result?.status)} variant="light">
              {loading ? "running" : `last run ${result?.status ?? "idle"}`}
            </Badge>
            {loading && onCancel && (
              <Button
                color="red"
                variant="light"
                size="xs"
                onClick={onCancel}
                leftSection={<IconPlayerStop size={14} />}
              >
                Cancel Installation
              </Button>
            )}
            {!loading && actions}
          </Group>
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
                  <div className="monitor-current-task">
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <ThemeIcon color="teal" variant="light" radius="xl" size={30}>
                        <IconActivity size={16} />
                      </ThemeIcon>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                          <Text size="xs" c="dimmed" fw={700}>CURRENT TASK</Text>
                          <Group gap="xs">
                            {heartbeatStatus && (
                              <Badge color={heartbeatStatus.color} variant="dot" size="xs">
                                {heartbeatStatus.label}
                              </Badge>
                            )}
                            <Badge color="blue" variant="light" size="xs">
                              Task time: {formatDuration(taskElapsedSeconds)}
                            </Badge>
                          </Group>
                        </Group>
                        <Text size="sm" fw={800}>{live.currentTask || live.currentPlay}</Text>
                        {live.currentRole && <Text size="xs" c="dimmed">Role: {live.currentRole}</Text>}
                      </div>
                    </Group>
                  </div>
                )}

                {loading && live.telemetry && (
                  <Card withBorder padding="xs" mt="xs" radius="md" style={{ background: "rgba(255, 107, 107, 0.05)", borderColor: "rgba(255, 107, 107, 0.2)" }}>
                    <Group justify="space-between" mb={4}>
                      <Badge color="red" variant="light" size="sm">
                        OpenShift Telemetry: {live.telemetry.stage || live.telemetry.cluster_status || "Installing"}
                      </Badge>
                      <Text size="xs" fw={700} c="dimmed">
                        Node: {live.telemetry.stage_percentage ?? 0}% | Cluster: {live.telemetry.total_percentage ?? 0}%
                      </Text>
                    </Group>
                    <Progress
                      value={live.telemetry.stage_percentage ?? 0}
                      color="red"
                      size="sm"
                      striped
                      animated
                    />
                  </Card>
                )}

                {loading && (live.seenTasks > 0 || live.completedTasks > 0) && (
                  <Text size="sm" mt={6}>
                    Completed tasks: {live.completedTasks}
                    {live.totalTasks > 0 ? ` / ${live.totalTasks} planned` : ` | ${live.seenTasks} observed`}
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
                  {loading && (
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() => setDetailsOpen((open) => !open)}
                      leftSection={<IconTerminal2 size={14} />}
                      rightSection={detailsOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                    >
                      {detailsOpen ? "Hide job output" : "View job output"}
                    </Button>
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

            <Modal
              opened={loading && detailsOpen}
              onClose={() => setDetailsOpen(false)}
              title="Live Playbook Job Output"
              size="78rem"
              centered
              classNames={{ content: "job-output-modal-content", header: "terminal-modal-header" }}
            >
              <div className="monitor-detail-drawer monitor-detail-modal-body">
                <Group justify="space-between" align="center" mb="md">
                  <div>
                    <Text fw={800}>Live job output</Text>
                    <Text size="xs" c="dimmed">Ansible activity reported by the controller, similar to an AAP job stream.</Text>
                  </div>
                  <Group gap="xs">
                    {heartbeatStatus && (
                      <Badge color={heartbeatStatus.color} variant="dot" size="xs">
                        {heartbeatStatus.label}
                      </Badge>
                    )}
                    <Badge color="gray" variant="outline">{recentEvents.length} recent events</Badge>
                  </Group>
                </Group>

                <div className="monitor-detail-grid">
                  <div>
                    <Text size="xs" c="dimmed" fw={700}>PLAY</Text>
                    <Text size="sm" fw={600}>{live.currentPlay || "Preparing execution"}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed" fw={700}>ROLE</Text>
                    <Text size="sm" fw={600}>{live.currentRole || "Waiting for role context"}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed" fw={700}>TASKS</Text>
                    <Text size="sm" fw={600}>
                      {live.completedTasks} completed
                      {live.totalTasks > 0 ? ` / ${live.totalTasks} planned` : ` / ${live.seenTasks} observed`}
                    </Text>
                  </div>
                </div>

                {hostActivity.length > 0 && (
                  <div className="monitor-host-strip">
                    {hostActivity.map(([host, activity]) => (
                      <div className="monitor-host-status" key={host}>
                        <ThemeIcon color={eventColor(activity.status)} variant="light" radius="xl" size={26}>
                          {activity.status === "failed" || activity.status === "unreachable"
                            ? <IconAlertTriangle size={14} />
                            : <IconCheck size={14} />}
                        </ThemeIcon>
                        <div>
                          <Text size="sm" fw={700}>{host}</Text>
                          <Text size="xs" c="dimmed">{activity.status} · {activity.results} updates</Text>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="monitor-job-stream">
                  <div className="monitor-job-stream-header">
                    <Group gap="sm" wrap="wrap" justify="space-between" style={{ width: "100%" }}>
                      <Group gap="xs">
                        <span>ANSIBLE PLAYBOOK OUTPUT</span>
                        <Badge color="gray" variant="light" size="xs">
                          {filteredLines.length} / {outputLines.length} lines
                        </Badge>
                      </Group>
                      <Group gap="xs">
                        <TextInput
                          placeholder="Filter logs..."
                          size="xs"
                          leftSection={<IconSearch size={12} />}
                          rightSection={
                            searchQuery ? (
                              <CloseButton size="xs" onClick={() => setSearchQuery("")} />
                            ) : null
                          }
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.currentTarget.value)}
                          styles={{ input: { height: 26, minHeight: 26, fontSize: "0.75rem", width: 140 } }}
                        />
                        <Checkbox
                          size="xs"
                          label="Hide skipped"
                          checked={hideSkipping}
                          onChange={(e) => setHideSkipping(e.currentTarget.checked)}
                        />
                        <Checkbox
                          size="xs"
                          label="Errors only"
                          checked={errorsOnly}
                          onChange={(e) => setErrorsOnly(e.currentTarget.checked)}
                        />
                      </Group>
                    </Group>
                  </div>
                  <ScrollArea
                    h={440}
                    type="auto"
                    offsetScrollbars
                    viewportRef={outputViewportRef}
                    onScrollPositionChange={handleScrollPositionChange}
                    className="monitor-terminal-scroll"
                  >
                    {filteredLines.length > 0 ? (
                      <pre className="monitor-terminal-output" aria-live="polite">
                        {filteredLines.map((entry, index) => {
                          const lineCls = getLineClass(entry.line, entry.channel);
                          return (
                            <span
                              className={lineCls}
                              key={`${entry.timestamp || "line"}-${index}`}
                            >
                              {entry.line}{"\n"}
                            </span>
                          );
                        })}
                      </pre>
                    ) : (
                      <div className="monitor-job-empty">
                        <IconTerminal2 size={24} />
                        <Text size="sm" c="dimmed">
                          {outputLines.length > 0
                            ? "No log lines match current filters."
                            : "Waiting for Ansible to produce job output."}
                        </Text>
                      </div>
                    )}
                  </ScrollArea>
                  {!autoScroll && (
                    <Button
                      className="terminal-jump-bottom-btn"
                      size="xs"
                      variant="filled"
                      color="blue"
                      leftSection={<IconChevronDown size={14} />}
                      onClick={scrollToBottom}
                    >
                      {unreadCount > 0 ? `${unreadCount} new lines · Jump to latest` : "Jump to latest"}
                    </Button>
                  )}
                </div>
              </div>
            </Modal>
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
