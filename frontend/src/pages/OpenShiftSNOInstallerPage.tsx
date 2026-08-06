import { Alert, Card, Stack, Text, Title } from "@mantine/core";

export default function OpenShiftSNOInstallerPage() {
  return (
    <Stack gap="lg">
      <Card className="console-panel" padding="lg">
        <Title order={3}>OpenShift SNO Workflow</Title>
        <Text c="dimmed" size="sm" mt={4}>
          This page is intentionally reserved for the installer-specific Single Node OpenShift form and execution flow.
        </Text>
      </Card>

      <Alert color="gray" variant="light" title="Not yet implemented">
        The route exists now so the frontend structure is ready, but the OpenShift SNO installer form and backend execution path have not been added yet.
      </Alert>
    </Stack>
  );
}
