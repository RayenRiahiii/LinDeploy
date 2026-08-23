import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconFolders,
  IconPlayerPlay,
  IconRefresh,
  IconTerminal2,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import MirrorStatusPanel from "../components/mirror/MirrorStatusPanel";

type DashboardSummary = {
  hosts: {
    total: number;
    enabled: number;
    control_plane: number;
    worker: number;
  };
  credentials: {
    total: number;
    password: number;
    ssh_key: number;
  };
  installations: {
    total: number;
    success: number;
    partial_success?: number;
    failed: number;
    cancelled?: number;
    running: number;
    pending: number;
  };
  latest_installation: {
    id: number;
    template_name: string;
    status: string;
    phase: string;
    progress: number;
  } | null;
};

const BASE_URL = import.meta.env.VITE_DJANGO_BASE_URL;

function getStatusColor(status?: string | null) {
  if (status === "success") {
    return "teal";
  }

  if (status === "partial_success") {
    return "yellow";
  }

  if (status === "failed") {
    return "red";
  }

  if (status === "cancelled") {
    return "yellow";
  }

  return "gray";
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function fetchSummary() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${BASE_URL}/api/dashboard/`);
      if (!response.ok) {
        throw new Error("Failed to load dashboard summary.");
      }

      setSummary(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard summary.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchSummary();
  }, []);

  return (
    <Stack gap="lg">
      <Card className="console-panel" padding="lg">
        <Group justify="space-between" align="center">
          <div>
            <Title order={3}>Operational Summary</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Use this page as the starting point before opening an installer workflow or resuming execution monitoring.
            </Text>
          </div>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            onClick={() => void fetchSummary()}
            loading={loading}
          >
            Refresh
          </Button>
        </Group>
      </Card>

      {error && (
        <Alert color="red" variant="light" title="Dashboard error">
          {error}
        </Alert>
      )}

      {summary && (
        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md">
          <Card className="console-panel" padding="md">
            <Text c="dimmed" size="sm">Hosts</Text>
            <Title order={3}>{summary.hosts.total}</Title>
            <Text size="sm" c="dimmed">
              enabled {summary.hosts.enabled} | cp {summary.hosts.control_plane} | workers {summary.hosts.worker}
            </Text>
            <Text size="sm" c="dimmed">
              inventory and role distribution
            </Text>
          </Card>
          <Card className="console-panel" padding="md">
            <Text c="dimmed" size="sm">Credentials</Text>
            <Title order={3}>{summary.credentials.total}</Title>
            <Text size="sm" c="dimmed">
              password {summary.credentials.password} | ssh key {summary.credentials.ssh_key}
            </Text>
          </Card>
          <Card className="console-panel" padding="md">
            <Text c="dimmed" size="sm">Installations</Text>
            <Title order={3}>{summary.installations.total}</Title>
            <Text size="sm" c="dimmed">
              success {summary.installations.success} | partial {summary.installations.partial_success ?? 0} | failed {summary.installations.failed} | cancelled {summary.installations.cancelled ?? 0}
            </Text>
          </Card>
          <Card className="console-panel" padding="md">
            <Text c="dimmed" size="sm">Active Queue</Text>
            <Title order={3}>{summary.installations.running + summary.installations.pending}</Title>
            <Text size="sm" c="dimmed">
              running {summary.installations.running} | pending {summary.installations.pending}
            </Text>
          </Card>
        </SimpleGrid>
      )}

      <MirrorStatusPanel />

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        <Card className="installer-card" padding="lg" component={Link} to="/installers">
          <Group gap="sm" mb="sm">
            <IconPlayerPlay size={18} />
            <Title order={4}>Open Installer Catalog</Title>
          </Group>
          <Text c="dimmed" size="sm">
            Choose the target system, then move into the dedicated Kubernetes or K3s configuration page.
          </Text>
        </Card>

        <Card className="installer-card" padding="lg" component={Link} to="/executions">
          <Group gap="sm" mb="sm">
            <IconTerminal2 size={18} />
            <Title order={4}>Open Execution Center</Title>
          </Group>
          <Text c="dimmed" size="sm">
            Resume active installations, inspect the live pipeline, and review final playbook output.
          </Text>
        </Card>

        <Card className="installer-card" padding="lg" component={Link} to="/history">
          <Group gap="sm" mb="sm">
            <IconFolders size={18} />
            <Title order={4}>Open History</Title>
          </Group>
          <Text c="dimmed" size="sm">
            Review completed runs separately from the live execution workspace and delete obsolete records.
          </Text>
        </Card>
      </SimpleGrid>

      {summary?.latest_installation && (
        <Card className="console-panel" padding="lg">
          <Group justify="space-between" align="center">
            <div>
              <Title order={3}>Latest Installation</Title>
              <Text c="dimmed" size="sm" mt={4}>
                installation #{summary.latest_installation.id} | {summary.latest_installation.template_name}
              </Text>
            </div>
            <Badge color={getStatusColor(summary.latest_installation.status)} variant="light">
              {summary.latest_installation.status}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed" mt="md">
            phase {summary.latest_installation.phase} | progress {summary.latest_installation.progress}%
          </Text>
        </Card>
      )}
    </Stack>
  );
}
