import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();

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
          {t("common.delete", "Delete")} <Text span fw={700}>{itemName}</Text> {t("common.from", "from")} {inventoryLabel}?
        </Text>

        <Text size="sm" c="dimmed">{description}</Text>

        {error && (
          <Alert color="red" title={errorTitle} variant="light">
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {t("common.cancel", "No")}
          </Button>
          <Button color="red" onClick={onConfirm} loading={loading}>
            {t("common.delete", "Yes, Delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
