import { Alert, Stack } from "@mantine/core";
import RunDeployment from "./RunDeployment";

export default function ExecutionDetailsPage() {
  return (
    <Stack gap="lg">
      <Alert color="gray" variant="light" title="Execution details">
        The route is in place for installation-specific execution views. The shared execution monitor is shown below until the per-installation detail page is extracted fully.
      </Alert>
      <RunDeployment mode="execution" />
    </Stack>
  );
}
