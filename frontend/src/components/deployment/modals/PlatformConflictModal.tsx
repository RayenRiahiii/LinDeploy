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
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getInstallerLogo, type InstallerId } from "../../../features/installers/catalog";
import { type InstallationTarget, type LaunchResult } from "../types";

type PlatformConflictModalProps = {
  opened: boolean;
  onClose: () => void;
  onViewFullReport: () => void;
  onLaunchConflictCleanup: (systemType?: InstallerId, targetHostIds?: number[]) => void;
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

  const k3sConflictTargets = useMemo(
    () =>
      platformConflictTargets.filter(
        (target) =>
          target.operator_issue?.cleanup_system === "k3s" ||
          target.operator_issue?.code === "k3s_conflict"
      ),
    [platformConflictTargets]
  );

  const k8sConflictTargets = useMemo(
    () =>
      platformConflictTargets.filter(
        (target) =>
          target.operator_issue?.cleanup_system === "kubernetes" ||
          target.operator_issue?.code === "kubernetes_conflict" ||
          target.operator_issue?.code === "kubernetes_identity_conflict"
      ),
    [platformConflictTargets]
  );

  const hasMixedPlatforms = k3sConflictTargets.length > 0 && k8sConflictTargets.length > 0;
  const isSameSystem =
    !hasMixedPlatforms &&
    conflictCleanupLabel.trim().toLowerCase() === blockedInstallerLabel.trim().toLowerCase();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        hasMixedPlatforms
          ? t("conflictMultiplePlatforms", "Conflicting platforms detected on target nodes")
          : t("conflictRequiredTitle", "Action required before {{installer}} installation", {
              installer: blockedInstallerLabel,
            })
      }
      size="64rem"
      centered
      closeOnClickOutside={false}
      classNames={{ content: "failure-modal-content", header: "terminal-modal-header" }}
    >
      <Stack gap="lg">
        <Stack gap="md" align="center" className="modal-status-hero">
          <div className="success-logo-shell">
            {hasMixedPlatforms ? (
              <Group gap="xs" align="center">
                <img src={getInstallerLogo("k3s")} alt="K3s logo" className="success-logo" style={{ width: 36, height: 36 }} />
                <img src={getInstallerLogo("kubernetes")} alt="Kubernetes logo" className="success-logo" style={{ width: 36, height: 36 }} />
              </Group>
            ) : conflictCleanupSystem ? (
              <img
                src={getInstallerLogo(conflictCleanupSystem)}
                alt={`${conflictCleanupLabel} logo`}
                className="success-logo"
              />
            ) : null}
          </div>
          <div>
            <Title order={2}>
              {hasMixedPlatforms
                ? t("conflictMultiplePlatforms", "Conflicting platforms detected on target nodes")
                : hasKubernetesIdentityConflict
                ? t("conflictClusterNameCannotChange", "Kubernetes cluster names cannot be changed in place")
                : t("conflictAlreadyInstalled", "{{installer}} is already installed", {
                    installer: conflictCleanupLabel,
                  })}
            </Title>
            <Text c="dimmed" size="sm" mt={4} ta="center">
              {hasMixedPlatforms
                ? t(
                    "conflictMultiplePlatformsSubtitle",
                    "Existing K3s and Kubernetes installations were detected on the target nodes. Clean up each platform before installing."
                  )
                : hasKubernetesIdentityConflict
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
          {hasMixedPlatforms
            ? t(
                "conflictBothInstalledNotice",
                "Conflicting platforms (K3s / Kubernetes) detected on selected targets. Clean them up before continuing."
              )
            : hasKubernetesIdentityConflict
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
              installer: hasMixedPlatforms ? "platform" : conflictCleanupLabel,
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
                  { count: platformConflictTargets.length, installer: hasMixedPlatforms ? "platform" : conflictCleanupLabel }
                )}
          </Text>
        </div>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {platformConflictTargets.map((target) => {
            const isTargetK3s =
              target.operator_issue?.cleanup_system === "k3s" ||
              target.operator_issue?.code === "k3s_conflict";
            const targetSystem: InstallerId = isTargetK3s ? "k3s" : "kubernetes";
            const targetSystemLabel = isTargetK3s ? "K3s" : "Kubernetes";

            return (
              <Card key={`platform-conflict-${target.id}`} className="host-panel target-result-card" padding="lg">
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <Text fw={700}>{target.host_name}</Text>
                    <Badge color={isTargetK3s ? "orange" : "blue"} variant="light">
                      {isTargetK3s
                        ? t("conflictK3sDetected", "K3s detected")
                        : t("conflictK8sDetected", "Kubernetes detected")}
                    </Badge>
                  </Group>
                  <Text size="sm">
                    {target.operator_issue?.detail ||
                      t(
                        "conflictPreventingDeploy",
                        "An existing {{installer}} installation is preventing a safe {{blocked}} deployment.",
                        { installer: targetSystemLabel, blocked: blockedInstallerLabel }
                      )}
                  </Text>
                  {Boolean(target.operator_issue?.artifacts?.length) && (
                    <div className="target-output-panel">
                      <Text size="sm" fw={600} mb="xs">
                        {t("conflictArtifactsDetected", "Detected {{installer}} artifacts", {
                          installer: targetSystemLabel,
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

                  <Group justify="flex-end" mt="xs">
                    <Button
                      size="xs"
                      color={isTargetK3s ? "orange" : "red"}
                      variant="light"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => onLaunchConflictCleanup(targetSystem, [target.host])}
                    >
                      {isTargetK3s
                        ? t("conflictUninstallK3s", "Uninstall K3s")
                        : t("conflictUninstallK8s", "Uninstall Kubernetes")}
                    </Button>
                  </Group>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>

        <Alert color="red" variant="light" title={t("conflictCleanupImpact", "Cleanup impact")}>
          {t(
            "conflictCleanupImpactDesc",
            "The next step opens the registered {{installer}} cleanup options and explains what will be removed. Cleanup starts only after your confirmation.",
            { installer: hasMixedPlatforms ? "selected platform" : conflictCleanupLabel }
          )}
        </Alert>

        <Group justify="space-between" align="center" wrap="wrap">
          <Button variant="subtle" onClick={onViewFullReport}>
            {t("conflictViewFullReport", "View full deployment report")}
          </Button>
          <Group gap="sm">
            <Button variant="default" onClick={onClose}>
              {isSameSystem
                ? t("conflictKeepExistingBtn", "Keep existing cluster")
                : t("common.close", "Close")}
            </Button>
            {k3sConflictTargets.length > 0 && (
              <Button
                color="orange"
                leftSection={<IconTrash size={16} />}
                onClick={() =>
                  onLaunchConflictCleanup(
                    "k3s",
                    k3sConflictTargets.map((t) => t.host)
                  )
                }
              >
                {t("conflictUninstallK3sCount", "Uninstall K3s ({{count}})", {
                  count: k3sConflictTargets.length,
                })}
              </Button>
            )}
            {k8sConflictTargets.length > 0 && (
              <Button
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={() =>
                  onLaunchConflictCleanup(
                    "kubernetes",
                    k8sConflictTargets.map((t) => t.host)
                  )
                }
              >
                {t("conflictUninstallK8sCount", "Uninstall Kubernetes ({{count}})", {
                  count: k8sConflictTargets.length,
                })}
              </Button>
            )}
            {!k3sConflictTargets.length && !k8sConflictTargets.length && (
              <Button
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={() => onLaunchConflictCleanup()}
                disabled={!hasConflictCleanupOption}
              >
                {isSameSystem
                  ? t("conflictCleanupAndReinstallBtn", "Cleanup & Reinstall")
                  : t("conflictCleanupBtn", "Cleanup {{installer}}", {
                      installer: conflictCleanupLabel,
                    })}
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
