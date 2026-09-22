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
import { getInstallerLogo, type InstallerId } from "../../../features/installers/catalog";
import { type InstallationTarget, type LaunchResult } from "../types";

type PlatformConflictModalProps = {
  opened: boolean;
  onClose: () => void;
  onViewFullReport: () => void;
  onLaunchConflictCleanup: () => void;
  blockedInstallerLabel: string;
  conflictCleanupLabel: string;
  conflictCleanupSystem: InstallerId;
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
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Action required before ${blockedInstallerLabel} installation`}
      size="64rem"
      centered
      closeOnClickOutside={false}
      classNames={{ content: "failure-modal-content", header: "terminal-modal-header" }}
    >
      <Stack gap="lg">
        <Stack gap="md" align="center" className="modal-status-hero">
          <div className="success-logo-shell">
            <img
              src={getInstallerLogo(conflictCleanupSystem)}
              alt={`${conflictCleanupLabel} logo`}
              className="success-logo"
            />
          </div>
          <div>
            <Title order={2}>
              {hasKubernetesIdentityConflict
                ? "Kubernetes cluster names cannot be changed in place"
                : `${conflictCleanupLabel} is already installed`}
            </Title>
            <Text c="dimmed" size="sm" mt={4}>
              {hasKubernetesIdentityConflict
                ? "Reset every node in this cluster before reinstalling it with new cluster or node names."
                : `${blockedInstallerLabel} cannot safely share this target with the existing ${conflictCleanupLabel} cluster.`}
            </Text>
          </div>
        </Stack>

        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertCircle size={18} />}
          title={`${blockedInstallerLabel} installation was safely stopped`}
        >
          {hasKubernetesIdentityConflict
            ? `No rename was attempted. Reset Cluster will target all ${conflictCleanupTargetIds.length} machines from this deployment before the new names are applied.`
            : `No ${blockedInstallerLabel} system changes were applied to the affected targets. Cleanup ${conflictCleanupLabel} first, then retry the ${blockedInstallerLabel} installation.`}
        </Alert>

        {result?.status === "partial_success" && (
          <Alert color="teal" variant="light" icon={<IconCheck size={18} />}>
            {blockedInstallerLabel} completed on {succeededResultTargets.length} other target(s). Cleanup will
            run only on the targets listed below.
          </Alert>
        )}

        <div>
          <Title order={4}>Targets requiring {conflictCleanupLabel} cleanup</Title>
          <Text size="sm" c="dimmed" mt={4}>
            {hasKubernetesIdentityConflict
              ? `${conflictCleanupTargetIds.length} cluster target(s) must be reset together.`
              : `${platformConflictTargets.length} target(s) are blocked by an existing ${conflictCleanupLabel} installation.`}
          </Text>
        </div>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {platformConflictTargets.map((target) => (
            <Card key={`platform-conflict-${target.id}`} className="host-panel target-result-card" padding="lg">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text fw={700}>{target.host_name}</Text>
                  <Badge color="yellow" variant="light">{conflictCleanupLabel} detected</Badge>
                </Group>
                <Text size="sm">
                  {target.operator_issue?.detail ||
                    `An existing ${conflictCleanupLabel} installation is preventing a safe ${blockedInstallerLabel} deployment.`}
                </Text>
                {Boolean(target.operator_issue?.artifacts?.length) && (
                  <div className="target-output-panel">
                    <Text size="sm" fw={600} mb="xs">Detected {conflictCleanupLabel} artifacts</Text>
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

        <Alert color="red" variant="light" title="Cleanup impact">
          The next step opens the registered {conflictCleanupLabel} cleanup options and explains
          what will be removed. Cleanup starts only after your confirmation.
        </Alert>

        <Group justify="space-between" align="center" wrap="wrap">
          <Button variant="subtle" onClick={onViewFullReport}>
            View full deployment report
          </Button>
          <Group>
            <Button variant="default" onClick={onClose}>
              Close
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={onLaunchConflictCleanup}
              disabled={!hasConflictCleanupOption}
            >
              Cleanup {conflictCleanupLabel}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

