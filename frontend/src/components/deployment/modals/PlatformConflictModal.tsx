import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { getInstallerLogo, type InstallerId } from "../../../features/installers/catalog";
import { type InstallationTarget, type LaunchResult } from "../types";

type PlatformConflictModalProps = {
  opened: boolean;
  onClose: () => void;
  onViewFullReport: () => void;
  onLaunchConflictCleanup: () => void;
  blockedInstallerLabel: string;
  conflictCleanupLabel: string;
  conflictCleanupSystem: InstallerId | null;
  hasKubernetesIdentityConflict: boolean;
  conflictCleanupTargetIds: number[];
  platformConflictTargets: InstallationTarget[];
  succeededResultTargets: InstallationTarget[];
  hasConflictCleanupOption: boolean;
  result: LaunchResult | null;
};

export default function PlatformConflictModal({
  opened,
  onClose,
  onViewFullReport,
  onLaunchConflictCleanup,
  blockedInstallerLabel,
  conflictCleanupLabel,
  conflictCleanupSystem,
  hasKubernetesIdentityConflict,
  conflictCleanupTargetIds,
  platformConflictTargets,
  succeededResultTargets,
  hasConflictCleanupOption,
  result,
}: PlatformConflictModalProps) {
  const { t } = useTranslation();
  const isSameSystem =
    conflictCleanupLabel.trim().toLowerCase() === blockedInstallerLabel.trim().toLowerCase();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("conflictRequiredTitle", "Action required before {{installer}} installation", {
        installer: blockedInstallerLabel,
      })}
      size="64rem"
      centered
      closeOnClickOutside={false}
      classNames={{ content: "failure-modal-content", header: "terminal-modal-header" }}
    >
      <Stack gap="lg">
        <Stack gap="md" align="center" className="modal-status-hero">
          <div className="success-logo-shell">
            {conflictCleanupSystem && (
              <img
                src={getInstallerLogo(conflictCleanupSystem)}
                alt={`${conflictCleanupLabel} logo`}
                className="success-logo"
              />
            )}
          </div>
          <div>
            <Title order={2}>
              {hasKubernetesIdentityConflict
                ? t("conflictClusterNameCannotChange", "Kubernetes cluster names cannot be changed in place")
                : t("conflictAlreadyInstalled", "{{installer}} is already installed", {
                    installer: conflictCleanupLabel,
                  })}
            </Title>
            <Text c="dimmed" size="sm" mt={4}>
              {hasKubernetesIdentityConflict
                ? t(
                    "conflictResetBeforeRename",
                    "Reset every node in this cluster before reinstalling it with new cluster or node names."
                  )
                : isSameSystem
                ? t(
                    "conflictSamePlatformSubtitle",
                    "An existing {{installer}} cluster is already present on this host. You can choose to keep it or clean it up to install a fresh cluster.",
                    { installer: conflictCleanupLabel }
                  )
                : t(
                    "conflictCannotShare",
                    "{{installer}} cannot safely share this target with the existing {{conflict}} cluster.",
                    { installer: blockedInstallerLabel, conflict: conflictCleanupLabel }
                  )}
            </Text>
          </div>
        </Stack>

        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertCircle size={18} />}
          title={t("conflictStoppedTitle", "{{installer}} installation was safely stopped", {
            installer: blockedInstallerLabel,
          })}
        >
          {hasKubernetesIdentityConflict
            ? t(
                "conflictStoppedRename",
                "No rename was attempted. Reset Cluster will target all {{count}} machines from this deployment before the new names are applied.",
                { count: conflictCleanupTargetIds.length }
              )
            : isSameSystem
            ? t(
                "conflictSamePlatformAlert",
                "No system changes were applied to the affected targets. You can clean up the host to perform a fresh install, or keep your existing cluster."
              )
            : t(
                "conflictStoppedCleanup",
                "No {{installer}} system changes were applied to the affected targets. Cleanup {{conflict}} first, then retry the {{installer}} installation.",
                { installer: blockedInstallerLabel, conflict: conflictCleanupLabel }
              )}
        </Alert>

        {result?.status === "partial_success" && (
          <Alert color="teal" variant="light" icon={<IconCheck size={18} />}>
            {t(
              "conflictPartialSucceeded",
              "{{installer}} completed on {{count}} other target(s). Cleanup will run only on the targets listed below.",
              { installer: blockedInstallerLabel, count: succeededResultTargets.length }
            )}
          </Alert>
        )}

        <div>
          <Title order={4}>
            {t("conflictTargetsRequiring", "Targets requiring {{installer}} cleanup", {
              installer: conflictCleanupLabel,
            })}
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            {hasKubernetesIdentityConflict
              ? t("conflictResetTogether", "{{count}} cluster target(s) must be reset together.", {
                  count: conflictCleanupTargetIds.length,
                })
              : t(
                  "conflictBlockedBy",
                  "{{count}} target(s) are blocked by an existing {{installer}} installation.",
                  { count: platformConflictTargets.length, installer: conflictCleanupLabel }
                )}
          </Text>
        </div>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {platformConflictTargets.map((target) => (
            <Card key={`platform-conflict-${target.id}`} className="host-panel target-result-card" padding="lg">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text fw={700}>{target.host_name}</Text>
                  <Badge color="yellow" variant="light">
                    {t("conflictDetected", "{{installer}} detected", {
                      installer: conflictCleanupLabel,
                    })}
                  </Badge>
                </Group>
                <Text size="sm">
                  {target.operator_issue?.detail ||
                    t(
                      "conflictPreventingDeploy",
                      "An existing {{installer}} installation is preventing a safe {{blocked}} deployment.",
                      { installer: conflictCleanupLabel, blocked: blockedInstallerLabel }
                    )}
                </Text>
                {Boolean(target.operator_issue?.artifacts?.length) && (
                  <div className="target-output-panel">
                    <Text size="sm" fw={600} mb="xs">
                      {t("conflictArtifactsDetected", "Detected {{installer}} artifacts", {
                        installer: conflictCleanupLabel,
                      })}
                    </Text>
                    <Stack gap={4}>
                      {target.operator_issue?.artifacts?.map((artifact) => (
                        <Code key={`${target.id}-${artifact}`} block>{artifact}</Code>
                      ))}
                    </Stack>
                  </div>
                )}
                <Text size="sm" c="dimmed">
                  {target.operator_issue?.recommended_action}
                </Text>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>

        <Alert color="red" variant="light" title={t("conflictCleanupImpact", "Cleanup impact")}>
          {t(
            "conflictCleanupImpactDesc",
            "The next step opens the registered {{installer}} cleanup options and explains what will be removed. Cleanup starts only after your confirmation.",
            { installer: conflictCleanupLabel }
          )}
        </Alert>

        <Group justify="space-between" align="center" wrap="wrap">
          <Button variant="subtle" onClick={onViewFullReport}>
            {t("conflictViewFullReport", "View full deployment report")}
          </Button>
          <Group>
            <Button variant="default" onClick={onClose}>
              {isSameSystem
                ? t("conflictKeepExistingBtn", "Keep existing cluster")
                : t("common.close", "Close")}
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={onLaunchConflictCleanup}
              disabled={!hasConflictCleanupOption}
            >
              {isSameSystem
                ? t("conflictCleanupAndReinstallBtn", "Cleanup & Reinstall")
                : t("conflictCleanupBtn", "Cleanup {{installer}}", {
                    installer: conflictCleanupLabel,
                  })}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
