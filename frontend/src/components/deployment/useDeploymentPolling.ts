import { useCallback, useEffect, useRef, useState } from "react";
import { parseJsonResponse } from "../../lib/api";
import { type InstallationDetailResponse } from "./types";

export const ACTIVE_INSTALLATION_STORAGE_KEY = "lindeploy-active-installation-id";
export const DISMISSED_INSTALLATION_STORAGE_KEY = "lindeploy-dismissed-installation-id";

interface UseDeploymentPollingOptions {
  baseUrl: string;
  onExecutionCompleted: (data: InstallationDetailResponse) => Promise<void> | void;
  onError: (errorMessage: string) => void;
}

export function useDeploymentPolling({
  baseUrl,
  onExecutionCompleted,
  onError,
}: UseDeploymentPollingOptions) {
  const [loading, setLoading] = useState(false);
  const [activeInstallationId, setActiveInstallationId] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveStatus, setLiveStatus] = useState<InstallationDetailResponse["status"] | null>(null);
  const [livePhase, setLivePhase] = useState<string | null>(null);
  const [liveSummaryMessage, setLiveSummaryMessage] = useState<string>("");
  const [liveCurrentPlay, setLiveCurrentPlay] = useState<string>("");
  const [liveCurrentRole, setLiveCurrentRole] = useState<string>("");
  const [liveCurrentTask, setLiveCurrentTask] = useState<string>("");
  const [liveSeenTasks, setLiveSeenTasks] = useState<number>(0);
  const [liveCompletedTasks, setLiveCompletedTasks] = useState<number>(0);
  const [liveTotalTasks, setLiveTotalTasks] = useState<number>(0);
  const [liveRecentEvents, setLiveRecentEvents] = useState<
    NonNullable<NonNullable<InstallationDetailResponse["celery_progress"]>["meta"]>["recent_events"]
  >([]);
  const [liveOutputLines, setLiveOutputLines] = useState<
    NonNullable<NonNullable<InstallationDetailResponse["celery_progress"]>["meta"]>["output_lines"]
  >([]);
  const [liveTelemetry, setLiveTelemetry] = useState<
    NonNullable<NonNullable<InstallationDetailResponse["celery_progress"]>["meta"]>["telemetry"]
  >(undefined);
  const [liveExecutionTitle, setLiveExecutionTitle] = useState("Installation in Progress");

  const loadingStartedAtRef = useRef<number | null>(null);
  const logOffsetRef = useRef<number>(0);

  const clearLiveInstallationState = useCallback(() => {
    logOffsetRef.current = 0;
    setLoading(false);
    setActiveInstallationId(null);
    setLiveStatus(null);
    setLivePhase(null);
    setLiveSummaryMessage("");
    setLiveCurrentPlay("");
    setLiveCurrentRole("");
    setLiveCurrentTask("");
    setLiveSeenTasks(0);
    setLiveCompletedTasks(0);
    setLiveTotalTasks(0);
    setLiveRecentEvents([]);
    setLiveOutputLines([]);
    setLiveTelemetry(undefined);
    setProgress(0);
    loadingStartedAtRef.current = null;
    window.localStorage.removeItem(ACTIVE_INSTALLATION_STORAGE_KEY);
  }, []);

  const startMonitoring = useCallback((installationId: number, phase = "queued", initialProgress = 0, initialMessage = "") => {
    logOffsetRef.current = 0;
    loadingStartedAtRef.current = Date.now();
    setLoading(true);
    setActiveInstallationId(installationId);
    setLiveStatus("running");
    setLivePhase(phase);
    setProgress(initialProgress);
    setLiveSummaryMessage(initialMessage);
    setLiveRecentEvents([]);
    setLiveOutputLines([]);
    setLiveTelemetry(undefined);
    window.localStorage.setItem(ACTIVE_INSTALLATION_STORAGE_KEY, String(installationId));
  }, []);

  const resumeMonitoring = useCallback((data: InstallationDetailResponse) => {
    if (data.started_at) {
      loadingStartedAtRef.current = new Date(data.started_at).getTime();
    }
    logOffsetRef.current =
      data.celery_progress?.meta?.next_offset ??
      (data.celery_progress?.meta?.output_lines?.length || 0);

    setLoading(true);
    setActiveInstallationId(data.id);
    setLiveStatus(data.status);
    setLivePhase(data.celery_progress?.meta?.phase || data.phase);
    setProgress(data.celery_progress?.meta?.progress ?? data.progress ?? 0);
    setLiveSummaryMessage(data.celery_progress?.meta?.summary_message || data.summary_message || "");
    setLiveCurrentPlay(data.celery_progress?.meta?.current_play || "");
    setLiveCurrentRole(data.celery_progress?.meta?.current_role || "");
    setLiveCurrentTask(data.celery_progress?.meta?.current_task || "");
    setLiveSeenTasks(data.celery_progress?.meta?.seen_tasks || 0);
    setLiveCompletedTasks(data.celery_progress?.meta?.completed_tasks || 0);
    setLiveTotalTasks(data.celery_progress?.meta?.total_tasks || 0);
    setLiveRecentEvents(data.celery_progress?.meta?.recent_events || []);
    setLiveOutputLines(data.celery_progress?.meta?.output_lines || []);
    setLiveTelemetry(data.celery_progress?.meta?.telemetry);
    window.localStorage.setItem(ACTIVE_INSTALLATION_STORAGE_KEY, String(data.id));
  }, []);

  // Timer: updates elapsed seconds every 1 second while loading
  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      loadingStartedAtRef.current = null;
      return;
    }

    if (loadingStartedAtRef.current === null) {
      loadingStartedAtRef.current = Date.now();
    }

    const timer = window.setInterval(() => {
      const startedAt = loadingStartedAtRef.current ?? Date.now();
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [loading]);

  // Polling loop: offset-based streaming every 1 second while loading
  useEffect(() => {
    if (!loading || activeInstallationId === null) {
      return;
    }

    let cancelled = false;

    async function pollInstallation() {
      try {
        const offset = logOffsetRef.current;
        const response = await fetch(
          `${baseUrl}/api/installations/${activeInstallationId}/?offset=${offset}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch installation status.");
        }

        const data = await parseJsonResponse<InstallationDetailResponse>(response);
        if (cancelled) {
          return;
        }

        if (data.started_at) {
          loadingStartedAtRef.current = new Date(data.started_at).getTime();
        }

        setLiveStatus(data.status);
        setLivePhase(data.celery_progress?.meta?.phase || data.phase);
        setProgress(data.celery_progress?.meta?.progress ?? data.progress ?? 0);
        setLiveSummaryMessage(
          data.celery_progress?.meta?.summary_message || data.summary_message || ""
        );
        setLiveCurrentPlay(data.celery_progress?.meta?.current_play || "");
        setLiveCurrentRole(data.celery_progress?.meta?.current_role || "");
        setLiveCurrentTask(data.celery_progress?.meta?.current_task || "");
        setLiveSeenTasks(data.celery_progress?.meta?.seen_tasks || 0);
        setLiveCompletedTasks(data.celery_progress?.meta?.completed_tasks || 0);
        setLiveTotalTasks(data.celery_progress?.meta?.total_tasks || 0);
        if (Array.isArray(data.celery_progress?.meta?.recent_events)) {
          setLiveRecentEvents(data.celery_progress.meta.recent_events);
        }
        if (data.celery_progress?.meta?.telemetry) {
          setLiveTelemetry(data.celery_progress.meta.telemetry);
        }
        if (
          Array.isArray(data.celery_progress?.meta?.output_lines) &&
          data.celery_progress.meta.output_lines.length > 0
        ) {
          const newLines = data.celery_progress.meta.output_lines;
          setLiveOutputLines((prev) => {
            const current = prev || [];
            const combined = [...current, ...newLines];
            return combined.length > 2500 ? combined.slice(-2500) : combined;
          });
        }
        if (typeof data.celery_progress?.meta?.next_offset === "number") {
          logOffsetRef.current = data.celery_progress.meta.next_offset;
        }
        if (
          data.status === "success" ||
          data.status === "partial_success" ||
          data.status === "failed" ||
          data.status === "cancelled"
        ) {
          clearLiveInstallationState();
          await onExecutionCompleted(data);
        }
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Polling failed.");
          clearLiveInstallationState();
        }
      }
    }

    void pollInstallation();
    const intervalId = window.setInterval(() => {
      void pollInstallation();
    }, 1000);

    const handleWakeup = () => {
      if (document.visibilityState === "visible") {
        void pollInstallation();
      }
    };
    document.addEventListener("visibilitychange", handleWakeup);
    window.addEventListener("focus", handleWakeup);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleWakeup);
      window.removeEventListener("focus", handleWakeup);
    };
  }, [loading, activeInstallationId, baseUrl, clearLiveInstallationState, onError, onExecutionCompleted]);

  return {
    loading,
    setLoading,
    activeInstallationId,
    setActiveInstallationId,
    progress,
    setProgress,
    elapsedSeconds,
    liveStatus,
    setLiveStatus,
    livePhase,
    setLivePhase,
    liveSummaryMessage,
    setLiveSummaryMessage,
    liveCurrentPlay,
    liveCurrentRole,
    liveCurrentTask,
    liveSeenTasks,
    liveCompletedTasks,
    liveTotalTasks,
    liveRecentEvents,
    liveOutputLines,
    setLiveOutputLines,
    liveTelemetry,
    liveExecutionTitle,
    setLiveExecutionTitle,
    clearLiveInstallationState,
    startMonitoring,
    resumeMonitoring,
  };
}

