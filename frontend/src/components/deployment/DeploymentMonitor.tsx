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
import { useTranslation } from "react-i18next";
import {
  type ExecutionStage,
  formatDuration,
  formatPhaseLabel,
  getStatusColor,
} from "../../features/executions/presentation";
import OpenShiftPhaseBar from "./OpenShiftPhaseBar";


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
  /** When true, renders the OpenShift SNO phase progress bar */
  isOpenShift?: boolean;
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
  isOpenShift = false,
}: DeploymentMonitorProps) {
  const { t } = useTranslation();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const translateStatus = (s?: string) => {
    if (!s) return "";
    switch (s.toLowerCase()) {
      case "running":
        return t("execution.statusRunning", "Running");
      case "success":
        return t("execution.statusSuccess", "Success");
      case "failed":
        return t("execution.statusFailed", "Failed");
      case "pending":
        return t("execution.statusPending", "Pending");
      case "cancelled":
        return t("execution.statusCancelled", "Cancelled");
      case "partial_success":
        return t("execution.statusSuccess", "Partial Success");
      default:
        return s;
    }
  };

  const status = loading ? live.status : result?.status;
  const statusColor = getStatusColor(status) === "gray" ? "teal" : getStatusColor(status);
  const progress = loading ? live.progress : result ? 100 : 0;
  const duration = loading ? live.elapsedSeconds : result?.durationSeconds;
  const installationId = loading ? live.installationId : result?.installationId;
  const recentEvents = useMemo(() => live.recentEvents || [], [live.recentEvents]);
  const outputLines = useMemo(() => live.outputLines || [], [live.outputLines]);
  const outputViewportRef = useRef<HTMLDivElement>(null);

  // Live per-task timer
  const [taskStartTime, setTaskStartTime] = useState<number>(() => Date.now());
  const [taskElapsedSeconds, setTaskElapsedSeconds] = useState<number>(0);
  const prevTaskRef = useRef<string | undefined>(live.currentTask);

  // Heartbeat tracking
  const [lastActivityTime, setLastActivityTime] = useState<number>(() => Date.now());
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
        label: t("monitor.activeHeartbeat", { count: secondsSinceActivity, defaultValue: `Active (heartbeat ${secondsSinceActivity}s ago)` }),
      };
    }
    if (secondsSinceActivity < 60) {
      return {
        color: "blue",
        label: t("monitor.workingHeartbeat", { count: secondsSinceActivity, defaultValue: `Working (${secondsSinceActivity}s ago)` }),
      };
    }
    return {
      color: "yellow",
      label: t("monitor.inProgressHeartbeat", { time: formatDuration(secondsSinceActivity), defaultValue: `In progress (${formatDuration(secondsSinceActivity)} since last event)` }),
    };
  }, [loading, secondsSinceActivity, t]);

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

  const isReset =
    (live.title || "").toLowerCase().includes("reset") ||
    (result?.message || "").toLowerCase().includes("reset");
  const isCleanup =
    isReset ||
    (live.title || "").toLowerCase().includes("cleanup") ||
    (result?.message || "").toLowerCase().includes("cleanup");
  const actionNoun = isReset
    ? t("monitor.resetResult", "Cluster Reset")
    : isCleanup
      ? t("monitor.cleanupResult", "Cleanup")
      : t("wizard.stepExecution", "Deployment");
  const cancelLabel = isReset
    ? t("execution.cancelReset", "Cancel Reset")
    : isCleanup
      ? t("execution.cancelCleanup", "Cancel Cleanup")
      : t("execution.cancelInstallation", "Cancel Installation");

  return (
    <Card className="console-panel" padding="lg">
      <Stack gap="lg">
        <Group justify="space-between" align="center">
          <div>
            <Title order={3}>
              {t("monitor.title", { action: actionNoun, defaultValue: `${actionNoun} Monitor` })}
            </Title>
            <Text size="sm" c="dimmed" mt={4}>
              {isReset
                ? t("monitor.descReset", "Live progress and pipeline status for the cluster reset run.")
                : isCleanup
                  ? t("monitor.descCleanup", "Live progress and pipeline status for the cluster cleanup / uninstallation run.")
                  : t("monitor.descInstall", "Live progress and pipeline status for the current installer run.")}
            </Text>
          </div>
          <Group className="monitor-header-actions" gap="sm" justify="flex-end">
            <Badge
              color={loading ? "red" : getStatusColor(result?.status)}
              variant="light"
            >
              {loading
                ? t("execution.statusRunning", "running")
                : `${t("monitor.lastResult", "last run")} ${result?.status ?? "idle"}`}
            </Badge>
            {loading && onCancel && (
              <Button
                color="red"
                variant="light"
                size="xs"
                onClick={onCancel}
                leftSection={<IconPlayerStop size={14} />}
              >
                {cancelLabel}
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
                <Title order={4}>
                  {loading ? live.title : t("monitor.lastResult", "Last Execution Result")}
                </Title>
                <Text c="dimmed" size="sm" mt={4}>
                  {loading
                    ? activeStage.label
                    : result?.message || t("monitor.noExecutionYet", "No execution yet.")}
                </Text>
                <Text c="dimmed" size="sm">
                  {loading
                    ? activeStage.detail
                    : result?.status === "success"
                      ? (isReset
                          ? t("monitor.resetSuccess", "The cluster reset completed and artifacts were cleared.")
                          : isCleanup
                            ? t("monitor.cleanupSuccess", "The cleanup workflow completed and target resources were removed.")
                            : t("monitor.installSuccess", "The installer completed and the target cluster is ready for validation."))
                      : result?.status === "failed"
                        ? (isReset
                            ? t("monitor.resetFailed", "The cluster reset stopped before all targets were cleared.")
                            : isCleanup
                              ? t("monitor.cleanupFailed", "The cleanup workflow stopped before all target state was removed.")
                              : t("monitor.installFailed", "The installer stopped before cluster validation completed."))
                        : result?.status === "cancelled"
                          ? t("monitor.actionCancelled", { action: actionNoun, defaultValue: `${actionNoun} was cancelled by user.` })
                          : t("monitor.noExecutionYet", "Launch a playbook to start tracking pipeline execution.")}
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
                          <Text size="xs" c="dimmed" fw={700}>{t("monitor.currentTask", "CURRENT TASK")}</Text>
                          <Group gap="xs">
                            {heartbeatStatus && (
                              <Badge color={heartbeatStatus.color} variant="dot" size="xs">
                                {heartbeatStatus.label}
                              </Badge>
                            )}
                            <Badge color="blue" variant="light" size="xs">
                              {t("monitor.taskTime", { time: formatDuration(taskElapsedSeconds), defaultValue: `Task time: ${formatDuration(taskElapsedSeconds)}` })}
                            </Badge>
                          </Group>
                        </Group>
                        <Text size="sm" fw={800}>{live.currentTask || live.currentPlay}</Text>
                        {live.currentRole && <Text size="xs" c="dimmed">{t("monitor.rolePrefix", { role: live.currentRole, defaultValue: `Role: ${live.currentRole}` })}</Text>}
                      </div>
                    </Group>
                  </div>
                )}

                {loading && live.telemetry && (
                  <Card withBorder padding="xs" mt="xs" radius="md" style={{ background: "rgba(255, 107, 107, 0.05)", borderColor: "rgba(255, 107, 107, 0.2)" }}>
                    <Group justify="space-between" mb={4}>
                      <Badge color="red" variant="light" size="sm">
                        {t("monitor.openShiftTelemetry", { stage: live.telemetry.stage || live.telemetry.cluster_status || "Installing", defaultValue: `OpenShift Telemetry: ${live.telemetry.stage || live.telemetry.cluster_status || "Installing"}` })}
                      </Badge>
                      <Text size="xs" fw={700} c="dimmed">
                        {t("monitor.nodeClusterPercent", { node: live.telemetry.stage_percentage ?? 0, cluster: live.telemetry.total_percentage ?? 0, defaultValue: `Node: ${live.telemetry.stage_percentage ?? 0}% | Cluster: ${live.telemetry.total_percentage ?? 0}%` })}
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

                {/* OpenShift SNO named phase bar */}
                {isOpenShift && loading && (
                  <OpenShiftPhaseBar
                    currentTask={live.currentTask}
                    currentRole={live.currentRole}
                    isRunning={loading}
                  />
                )}

                {loading && (live.seenTasks > 0 || live.completedTasks > 0) && (

                  <Text size="sm" mt={6}>
                    {t("monitor.completedTasks", { completed: live.completedTasks, defaultValue: `Completed tasks: ${live.completedTasks}` })}
                    {live.totalTasks > 0 ? t("monitor.plannedTasks", { count: live.totalTasks, defaultValue: ` / ${live.totalTasks} planned` }) : t("monitor.observedTasks", { count: live.seenTasks, defaultValue: ` | ${live.seenTasks} observed` })}
                  </Text>
                )}

                <Group gap="xs" mt={10}>
                  {status && (
                    <Badge color={getStatusColor(status)} variant="light">
                      {loading ? `${translateStatus(status)} | ${formatPhaseLabel(stages, live.phase)}` : translateStatus(status)}
                    </Badge>
                  )}
                  {installationId && (
                    <Badge color="gray" variant="outline">{t("monitor.installationNum", { id: installationId, defaultValue: `installation #${installationId}` })}</Badge>
                  )}
                  {loading && (
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() => setDetailsOpen((open) => !open)}
                      leftSection={<IconTerminal2 size={14} />}
                      rightSection={detailsOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                    >
                      {detailsOpen ? t("monitor.hideOutput", "Hide job output") : t("monitor.viewOutput", "View job output")}
                    </Button>
                  )}
                </Group>
              </div>

              <Badge color="red" variant="filled">{t("monitor.elapsed", { time: formatDuration(duration), defaultValue: `elapsed: ${formatDuration(duration)}` })}</Badge>
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
              title={t("monitor.liveJobOutput", "Live Playbook Job Output")}
              size="78rem"
              centered
              classNames={{ content: "job-output-modal-content", header: "terminal-modal-header" }}
            >
              <div className="monitor-detail-drawer monitor-detail-modal-body">
                <Group justify="space-between" align="center" mb="md">
                  <div>
                    <Text fw={800}>{t("monitor.liveJobOutput", "Live job output")}</Text>
                    <Text size="xs" c="dimmed">{t("monitor.liveJobOutputDesc", "Ansible activity reported by the controller, similar to an AAP job stream.")}</Text>
                  </div>
                  <Group gap="xs">
                    {heartbeatStatus && (
                      <Badge color={heartbeatStatus.color} variant="dot" size="xs">
                        {heartbeatStatus.label}
                      </Badge>
                    )}
                    <Badge color="gray" variant="outline">{t("monitor.recentEvents", { count: recentEvents.length, defaultValue: `${recentEvents.length} recent events` })}</Badge>
                  </Group>
                </Group>

                <div className="monitor-detail-grid">
                  <div>
                    <Text size="xs" c="dimmed" fw={700}>{t("monitor.play", "PLAY")}</Text>
                    <Text size="sm" fw={600}>{live.currentPlay || t("monitor.preparingExecution", "Preparing execution")}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed" fw={700}>{t("monitor.role", "ROLE")}</Text>
                    <Text size="sm" fw={600}>{live.currentRole || t("monitor.waitingRole", "Waiting for role context")}</Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed" fw={700}>{t("monitor.tasks", "TASKS")}</Text>
                    <Text size="sm" fw={600}>
                      {t("monitor.tasksCompleted", { completed: live.completedTasks, defaultValue: `${live.completedTasks} completed` })}
                      {live.totalTasks > 0 ? t("monitor.plannedTasks", { count: live.totalTasks, defaultValue: ` / ${live.totalTasks} planned` }) : t("monitor.observedTasks", { count: live.seenTasks, defaultValue: ` / ${live.seenTasks} observed` })}
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
                          <Text size="xs" c="dimmed">{t("monitor.hostActivityUpdates", { status: activity.status, count: activity.results, defaultValue: `${activity.status} · ${activity.results} updates` })}</Text>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="monitor-job-stream">
                  <div className="monitor-job-stream-header">
                    <Group gap="sm" wrap="wrap" justify="space-between" style={{ width: "100%" }}>
                      <Group gap="xs">
                        <span>{t("monitor.ansibleOutput", "ANSIBLE PLAYBOOK OUTPUT")}</span>
                        <Badge color="gray" variant="light" size="xs">
                          {t("monitor.linesCount", { filtered: filteredLines.length, total: outputLines.length, defaultValue: `${filteredLines.length} / ${outputLines.length} lines` })}
                        </Badge>
                      </Group>
                      <Group gap="xs">
                        <TextInput
                          placeholder={t("monitor.filterLogs", "Filter logs...")}
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
                          label={t("monitor.hideSkipped", "Hide skipped")}
                          checked={hideSkipping}
                          onChange={(e) => setHideSkipping(e.currentTarget.checked)}
                        />
                        <Checkbox
                          size="xs"
                          label={t("monitor.errorsOnly", "Errors only")}
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
                            ? t("monitor.noLogLines", "No log lines match current filters.")
                            : t("monitor.waitingOutput", "Waiting for Ansible to produce job output.")}
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
                      {unreadCount > 0 ? t("monitor.newLinesJump", { count: unreadCount, defaultValue: `${unreadCount} new lines · Jump to latest` }) : t("monitor.jumpToLatest", "Jump to latest")}
                    </Button>
                  )}
                </div>
              </div>
            </Modal>
          </div>

          <div className="monitor-pipeline-panel">
            <Text fw={600} mb="sm">{t("monitor.pipeline", "Pipeline")}</Text>
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
