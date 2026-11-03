/**
 * OpenShiftPhaseBar — a named phase progress bar for SNO installation.
 *
 * Shows a horizontal stepper of 6 installation phases with the current phase
 * highlighted, completed phases ticked, and a time-remaining estimate.
 */
import { Badge, Box, Group, Progress, Text, ThemeIcon } from "@mantine/core";
import { IconCheck, IconClockHour4, IconLoader2 } from "@tabler/icons-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  OPENSHIFT_INSTALLATION_STAGES,
  detectOpenShiftPhaseFromTask,
  estimateRemainingMinutes,
  getOpenShiftPhaseIndex,
  type OpenShiftPhase,
} from "../../features/executions/openshiftPhases";

type Props = {
  /** Currently executing Ansible task name */
  currentTask?: string | null;
  /** Currently executing Ansible role name */
  currentRole?: string | null;
  /** Whether the installation is still running */
  isRunning: boolean;
  /** Override phase directly (e.g. from telemetry) */
  overridePhase?: OpenShiftPhase | null;
};

export default function OpenShiftPhaseBar({ currentTask, currentRole, isRunning, overridePhase }: Props) {
  const { t } = useTranslation();
  const detectedPhase = useMemo(
    () => overridePhase ?? detectOpenShiftPhaseFromTask(currentTask, currentRole),
    [currentTask, currentRole, overridePhase]
  );

  const currentPhaseIndex = getOpenShiftPhaseIndex(detectedPhase);
  const remainingMinutes = estimateRemainingMinutes(Math.max(0, currentPhaseIndex));
  const overallProgress = currentPhaseIndex < 0
    ? 0
    : Math.round(((currentPhaseIndex) / OPENSHIFT_INSTALLATION_STAGES.length) * 100);

  if (!isRunning && currentPhaseIndex < 0) return null;

  return (
    <Box className="openshift-phase-bar" mt="sm">
      <Group justify="space-between" mb={6}>
        <Text size="xs" fw={700} c="dimmed">{t("openshift.snoPhases", "SNO INSTALLATION PHASES")}</Text>
        {isRunning && currentPhaseIndex >= 0 && (
          <Badge color="blue" variant="light" size="xs" leftSection={<IconClockHour4 size={10} />}>
            {t("openshift.minutesRemaining", { count: remainingMinutes, defaultValue: `~${remainingMinutes}m remaining` })}
          </Badge>
        )}
      </Group>

      {/* Phase stepper */}
      <div className="openshift-phase-stepper">
        {OPENSHIFT_INSTALLATION_STAGES.map((stage, index) => {
          const completed = currentPhaseIndex > index;
          const current = currentPhaseIndex === index;
          const pending = currentPhaseIndex < index;

          return (
            <div
              key={stage.phase}
              className={`openshift-phase-step${completed ? " is-completed" : ""}${current ? " is-current" : ""}${pending ? " is-pending" : ""}`}
              title={t(`openshift.stages.${stage.phase}.detail`, stage.detail)}
            >
              <ThemeIcon
                size={20}
                radius="xl"
                color={completed ? "teal" : current ? "red" : "gray"}
                variant={completed || current ? "filled" : "light"}
              >
                {completed ? (
                  <IconCheck size={12} />
                ) : current ? (
                  <IconLoader2 size={12} className="openshift-phase-spin" />
                ) : (
                  <IconClockHour4 size={12} />
                )}
              </ThemeIcon>
              <div className="openshift-phase-label">
                <Text size="xs" fw={current ? 700 : completed ? 500 : 400} c={pending ? "dimmed" : undefined}>
                  {t(`openshift.stages.${stage.phase}.label`, stage.label)}
                </Text>
                {current && (
                  <Text size="10px" c="dimmed">~{stage.estimatedMinutes}m</Text>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall progress bar */}
      <Progress
        mt={8}
        value={overallProgress}
        color="red"
        size="xs"
        radius="xl"
        animated={isRunning}
      />
    </Box>
  );
}
