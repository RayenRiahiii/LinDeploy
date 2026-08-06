import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";

type ConfirmDeleteModalProps = {
  opened: boolean;
  title: string;
  itemName: string;
  inventoryLabel: string;
  description: string;
  error?: string;
  errorTitle: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function ConfirmDeleteModal({
  opened,
  title,
  itemName,
  inventoryLabel,
  description,
  error,
  errorTitle,
  loading,
  onClose,
  onConfirm,
}: ConfirmDeleteModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      centered
      size="md"
      classNames={{ content: "terminal-modal", header: "terminal-modal-header" }}
    >
      <Stack gap="md">
        <Text>
          Delete <Text span fw={700}>{itemName}</Text> from the {inventoryLabel}?
        </Text>

        <Text size="sm" c="dimmed">{description}</Text>

        {error && (
          <Alert color="red" title={errorTitle} variant="light">
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            No
          </Button>
          <Button color="red" onClick={onConfirm} loading={loading}>
            Yes, Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
