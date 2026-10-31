import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Textarea,
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";

type OpenShiftRetryModalProps = {
  opened: boolean;
  onClose: () => void;
  installationId?: number;
  openShiftRetryPullSecret: string;
  onPullSecretChange: (value: string) => void;
  openShiftRetrySshKey: string;
  onSshKeyChange: (value: string) => void;
  openShiftRetryTrustBundle: string;
  onTrustBundleChange: (value: string) => void;
  openShiftRetryError: string;
  restartingOpenShift: boolean;
  onRetryOpenShift: () => void;
};

export default function OpenShiftRetryModal({
  opened,
  onClose,
  installationId,
  openShiftRetryPullSecret,
  onPullSecretChange,
  openShiftRetrySshKey,
  onSshKeyChange,
  openShiftRetryTrustBundle,
  onTrustBundleChange,
  openShiftRetryError,
  restartingOpenShift,
  onRetryOpenShift,
}: OpenShiftRetryModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Restart OpenShift SNO installation"
      centered
      size="lg"
      closeOnClickOutside={!restartingOpenShift}
      closeOnEscape={!restartingOpenShift}
    >
      <Stack gap="md">
        <Alert color="blue" variant="light" title="Saved configuration will be reused">
          Cluster, KVM host, VM, network, storage and disk-erasure approval are copied from execution
          {installationId ? ` #${installationId}` : ""}. Only the short-lived credentials must be supplied again because LinDeploy
          securely destroyed them after the failed run.
        </Alert>
        {openShiftRetryError && (
          <Alert color="red" variant="light" title="Restart blocked">
            {openShiftRetryError}
          </Alert>
        )}
        <Textarea
          label="Red Hat pull secret"
          description="Paste the complete pull-secret JSON. It is encrypted and consumed once."
          placeholder='{"auths":{"cloud.openshift.com":{"auth":"..."}}}'
          required
          minRows={5}
          autosize
          value={openShiftRetryPullSecret}
          onChange={(event) => onPullSecretChange(event.currentTarget.value)}
        />
        <Textarea
          label="SSH public key"
          description="Enter only a public key, never a private key."
          placeholder="ssh-ed25519 AAAAC3... operator@workstation"
          required
          minRows={2}
          autosize
          value={openShiftRetrySshKey}
          onChange={(event) => onSshKeyChange(event.currentTarget.value)}
        />
        <Textarea
          label="Additional trust bundle"
          description="Optional. Re-enter it only when the original connected installation required a custom CA."
          placeholder="-----BEGIN CERTIFICATE-----"
          minRows={3}
          autosize
          value={openShiftRetryTrustBundle}
          onChange={(event) => onTrustBundleChange(event.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" disabled={restartingOpenShift} onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="red"
            leftSection={<IconRefresh size={16} />}
            loading={restartingOpenShift}
            onClick={onRetryOpenShift}
          >
            Restart same installation
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

