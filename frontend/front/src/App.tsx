import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconKey,
  IconPlayerPlay,
  IconServer,
  IconTerminal2,
} from "@tabler/icons-react";
import CredentialsList from "./pages/CredentialsList";
import HostsList from "./pages/HostsList";
import RunDeployment from "./pages/RunDeployment";
import "./App.css";

export default function App() {
  const [page, setPage] = useState<"hosts" | "credentials" | "run">("hosts");

  return (
    <Box className="app-shell">
      <div className="workspace-shell">
        <aside className="workspace-sidebar">
          <Paper className="sidebar-panel" p="lg">
            <Stack gap="xl">
              <div>
                <Badge color="red" variant="light" size="md">
                  Control Center
                </Badge>
                <Title order={1} className="brand-title" mt="md">
                  auto-K8S
                </Title>
                <Text c="dimmed" size="sm" mt={8}>
                  Cluster automation workspace for host inventory, installer selection, and controlled rollout.
                </Text>
              </div>

              <Stack gap="sm">
                <Button
                  className="nav-button"
                  variant={page === "hosts" ? "filled" : "subtle"}
                  onClick={() => setPage("hosts")}
                  leftSection={<IconServer size={16} />}
                  justify="space-between"
                  rightSection={<Text size="xs">Inventory</Text>}
                >
                  Hosts
                </Button>

                <Button
                  className="nav-button"
                  variant={page === "credentials" ? "filled" : "subtle"}
                  onClick={() => setPage("credentials")}
                  leftSection={<IconKey size={16} />}
                  justify="space-between"
                  rightSection={<Text size="xs">Access</Text>}
                >
                  Credentials
                </Button>

                <Button
                  className="nav-button"
                  variant={page === "run" ? "filled" : "subtle"}
                  onClick={() => setPage("run")}
                  leftSection={page === "run" ? <IconTerminal2 size={16} /> : <IconPlayerPlay size={16} />}
                  justify="space-between"
                  rightSection={<Text size="xs">Execution</Text>}
                >
                  Installers
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </aside>

        <main className="workspace-main">
          <Paper className="hero-panel" p="xl">
            <Group justify="space-between" align="flex-start" gap="xl">
              <Stack gap={8}>
                <Badge color="red" variant="light" size="lg">
                  {page === "hosts"
                    ? "Infrastructure Inventory"
                    : page === "credentials"
                      ? "Access Management"
                      : "Installer Console"}
                </Badge>
                <Title order={2} className="hero-title">
                  {page === "hosts"
                    ? "Manage targets with a clean operator workflow"
                    : page === "credentials"
                      ? "Maintain reusable SSH credentials safely and clearly"
                      : "Launch cluster installers with a future-ready workflow"}
                </Title>
                <Text c="dimmed" maw={760}>
                  {page === "hosts"
                    ? "Review host definitions, credentials linkage, and machine properties from a structured CRUD workspace."
                    : page === "credentials"
                      ? "Create and edit password-based or key-based SSH credentials used by your host inventory."
                      : "Choose an installer, apply the required configuration, monitor execution live, and inspect exact automation output from one place."}
                </Text>
              </Stack>

              <Box className="hero-terminal">
                <Text className="hero-terminal-line">$ session attach auto-k8s</Text>
                <Text className="hero-terminal-line">
                  section: {page === "hosts"
                    ? "hosts_registry"
                    : page === "credentials"
                      ? "credentials_vault"
                      : "installer_runner"}
                </Text>
              </Box>
            </Group>
          </Paper>

          <Box className="page-content">
            {page === "hosts"
              ? <HostsList />
              : page === "credentials"
                ? <CredentialsList />
                : <RunDeployment />}
          </Box>
        </main>
      </div>
    </Box>
  );
}
