import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
  Title,
  Alert,
} from "@mantine/core";
import { type CleanupMode, type CleanupRequest, type CleanupTemplateMap, type Host } from "../types";

type CleanupConfirmationModalProps = {
  opened: boolean;
  onClose: () => void;
  cleanupRequest: CleanupRequest | null;
  hosts?: Host[];
  cleanupConfirmation?: string;
  onConfirmationChange?: (value: string) => void;
  cleanupApproved?: boolean;
  onApprovalChange?: (approved: boolean) => void;
  cleanupRequestTemplates: CleanupTemplateMap;
  loading: boolean;
  onLaunchCleanup: (request: CleanupRequest, mode: CleanupMode) => void;
};

export function buildCleanupConfirmationString(request: CleanupRequest, hosts: Host[]): string {
  const defaultClusterName =
    request.systemType === "k3s" ? "k3s-cluster-01" : "kubernetes-cluster-01";
  const clusterName = request.clusterConfig.cluster_name?.trim() || defaultClusterName;
  const stableTargetIds = hosts
    .filter((host) => request.hostIds.includes(host.id))
    .map((host) => host.stable_id)
    .sort();

  return `CLEAN ${clusterName} ON ${stableTargetIds.join(",")}`;
}

export default function CleanupConfirmationModal({
  opened,
  onClose,
  cleanupRequest,
  cleanupRequestTemplates,
  loading,
  onLaunchCleanup,
}: CleanupConfirmationModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Cleanup Options"
      size="md"
      centered
      classNames={{ content: "success-modal-content", header: "terminal-modal-header" }}
    >
      <Stack gap="lg">
        <div>
          <Title order={3}>{cleanupRequest?.title || "Cleanup Options"}</Title>
          <Text c="dimmed" size="sm" mt={6}>
            Choose how much of the selected target system state should be removed.
          </Text>
        </div>

        {cleanupRequestTemplates.reset && (
          <Card className="host-panel" padding="md">
            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Text fw={700}>Reset Cluster</Text>
                {cleanupRequest?.purpose !== "platform_switch" && (
                  <Badge color="yellow" variant="light">Recommended</Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed">
                {cleanupRequest?.systemType === "openshift_sno"
                  ? "Removes the SNO virtual machine and disk, but keeps the generated Agent ISO image and cache for an instant reinstallation."
                  : "Removes cluster state and CNI artifacts, but keeps installed packages for a faster reinstall of the same platform."}
              </Text>
              <Button
                color="orange"
                variant="light"
                onClick={() => {
                  if (cleanupRequest) {
                    onLaunchCleanup(cleanupRequest, "reset");
                  }
                }}
                disabled={loading}
              >
                Reset Cluster
              </Button>
            </Stack>
          </Card>
        )}

        {cleanupRequestTemplates.full_uninstall && (
          <Card className="host-panel" padding="md">
            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Text fw={700}>Full Uninstall</Text>
                {cleanupRequest?.purpose === "platform_switch" && (
                  <Badge color="red" variant="light">Recommended for platform switch</Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed">
                {cleanupRequest?.systemType === "openshift_sno"
                  ? "Removes the SNO virtual machine, its disk volume, the runtime ISO from the storage pool, and all cluster installation assets."
                  : "Removes the cluster state and uninstalls the platform packages from the selected target hosts."}
              </Text>
              <Button
                color="red"
                variant="light"
                onClick={() => {
                  if (cleanupRequest) {
                    onLaunchCleanup(cleanupRequest, "full_uninstall");
                  }
                }}
                disabled={loading}
              >
                Full Uninstall
              </Button>
            </Stack>
          </Card>
        )}

        {!cleanupRequestTemplates.reset && !cleanupRequestTemplates.full_uninstall && (
          <Alert color="red" variant="light">
            No cleanup template is registered for this installer.
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
