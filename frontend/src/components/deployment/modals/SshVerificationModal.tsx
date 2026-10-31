import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck } from "@tabler/icons-react";
import { formatDurationDetailed, getStatusColor } from "../../../features/executions/presentation";
import { getConnectivityOperatorAction, getPrecheckPresentation } from "../presentation";
import { type PrecheckResult } from "../types";

type SshVerificationModalProps = {
  opened: boolean;
  onClose: () => void;
  precheckResult: PrecheckResult | null;
};

export default function SshVerificationModal({
  opened,
  onClose,
  precheckResult,
}: SshVerificationModalProps) {
  const precheckSucceeded =
    precheckResult !== null &&
    (precheckResult?.summary?.failed_hosts ?? 1) === 0 &&
    (precheckResult?.summary?.reachable_hosts ?? 0) > 0;

  const presentation = getPrecheckPresentation(precheckResult);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="SSH Verification Report"
      size="72rem"
      centered
      classNames={{ content: "success-modal-content", header: "terminal-modal-header" }}
    >
      <Stack gap="lg">
        <Stack gap="md" align="center" className="modal-status-hero">
          <ThemeIcon
            size={72}
            radius={18}
            color={precheckSucceeded ? "teal" : "red"}
            variant="light"
          >
            {precheckSucceeded ? <IconCheck size={42} /> : <IconAlertCircle size={42} />}
          </ThemeIcon>
          <div>
            <Title order={2}>{presentation.title}</Title>
            <Text c="dimmed" size="sm" mt={4}>
              {presentation.summary}
            </Text>
          </div>
        </Stack>

        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md" className="modal-summary-grid">
          <Card className="host-panel" padding="sm">
            <Text size="sm" c="dimmed">Selected Hosts</Text>
            <Text fw={700}>{precheckResult?.summary?.selected_hosts ?? 0}</Text>
          </Card>
          <Card className="host-panel" padding="sm">
            <Text size="sm" c="dimmed">Reachable Hosts</Text>
            <Text fw={700}>{precheckResult?.summary?.reachable_hosts ?? 0}</Text>
          </Card>
          <Card className="host-panel" padding="sm">
            <Text size="sm" c="dimmed">Failed Hosts</Text>
            <Text fw={700}>{precheckResult?.summary?.failed_hosts ?? 0}</Text>
          </Card>
          <Card className="host-panel" padding="sm">
            <Text size="sm" c="dimmed">SSH Check Duration</Text>
            <Text fw={700}>{formatDurationDetailed(precheckResult?.timings?.ssh_check_seconds)}</Text>
          </Card>
        </SimpleGrid>

        <Alert color={presentation.color} variant="light" title="Operational next step">
          {presentation.recommendation}
        </Alert>

        {precheckResult?.connectivity && precheckResult.connectivity.length > 0 && (
          <Stack gap="sm">
            <div>
              <Title order={4}>Host Connectivity Summary</Title>
              <Text size="sm" c="dimmed" mt={4}>
                Review each selected host below before launching the installer.
              </Text>
            </div>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              {precheckResult.connectivity.map((item) => (
                <Card key={item.host} className="host-panel target-result-card" padding="lg">
                  <Stack gap="md">
                    <Group justify="space-between" align="center">
                      <Text fw={700}>{item.host}</Text>
                      <Badge color={getStatusColor(item.status)} variant="light">
                        {item.status}
                      </Badge>
                    </Group>
                    <Alert color={getStatusColor(item.status)} variant="light">
                      {item.detail}
                    </Alert>
                    <div className="target-output-panel">
                      <Text fw={600} mb="sm">
                        Recommended action
                      </Text>
                      <Text size="sm">{getConnectivityOperatorAction(item)}</Text>
                    </div>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          </Stack>
        )}

        <Group justify="flex-end">
          <Button onClick={onClose}>
            {precheckSucceeded ? "Continue" : "Close"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

