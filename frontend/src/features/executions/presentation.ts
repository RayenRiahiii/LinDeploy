export type ExecutionStage = {
  phase: string;
  label: string;
  detail: string;
};

export function getStatusColor(status?: string | null) {
  if (status === "success") return "teal";
  if (status === "partial_success" || status === "cancelled") return "yellow";
  if (status === "failed" || status === "unreachable") return "red";
  return "gray";
}

export function formatDuration(seconds?: number | null) {
  if (seconds === undefined || seconds === null) return "-";

  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return minutes === 0 ? `${remainingSeconds}s` : `${minutes}m ${remainingSeconds}s`;
}

export function formatDurationDetailed(seconds?: number | null) {
  if (seconds === undefined || seconds === null) return "-";
  return `${formatDuration(seconds)} (${seconds.toFixed(3)}s)`;
}

export function formatPhaseLabel(
  stages: ExecutionStage[],
  phase?: string
) {
  return stages.find((stage) => stage.phase === phase)?.label ?? phase ?? "Unknown";
}
