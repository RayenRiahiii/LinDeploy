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
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconActivity,
  IconFolders,
  IconKey,
  IconLayoutDashboard,
  IconPlayerPlay,
  IconRefresh,
  IconServer,
  IconTerminal2,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
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
  if (status === "success") return "teal";
  if (status === "partial_success") return "yellow";
  if (status === "failed") return "red";
  if (status === "cancelled") return "yellow";
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
      <PageHeader
        icon={<IconLayoutDashboard size={22} />}
        badge="Platform Overview"
        badgeColor="red"
        title="Operational Summary"
        subtitle="Real-time status of your infrastructure inventory, saved credentials, and deployment pipelines."
        stats={
          summary ? (
            <>
              <Badge color="red" variant="light">
                Hosts: {summary.hosts.total}
              </Badge>
              <Badge color="teal" variant="light">
                Active Queue: {summary.installations.running + summary.installations.pending}
              </Badge>
              <Badge color="gray" variant="outline">
                Total Runs: {summary.installations.total}
              </Badge>
            </>
          ) : undefined
        }
        actions={
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            onClick={() => void fetchSummary()}
            loading={loading}
          >
            Refresh
          </Button>
        }
      />

      {error && (
        <Alert color="red" variant="light" title="Dashboard error">
          {error}
        </Alert>
      )}

      {summary && (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>Hosts Inventory</Text>
                <Title order={2} mt={4}>{summary.hosts.total}</Title>
              </div>
              <ThemeIcon color="red" variant="light" size={36} radius="md">
                <IconServer size={18} />
              </ThemeIcon>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {summary.hosts.enabled} enabled · {summary.hosts.control_plane} CP · {summary.hosts.worker} worker
            </Text>
          </Card>

          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>Credentials</Text>
                <Title order={2} mt={4}>{summary.credentials.total}</Title>
              </div>
              <ThemeIcon color="red" variant="light" size={36} radius="md">
                <IconKey size={18} />
              </ThemeIcon>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {summary.credentials.password} password · {summary.credentials.ssh_key} SSH key
            </Text>
          </Card>

          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>Total Deployments</Text>
                <Title order={2} mt={4}>{summary.installations.total}</Title>
              </div>
              <ThemeIcon color="red" variant="light" size={36} radius="md">
                <IconPlayerPlay size={18} />
              </ThemeIcon>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {summary.installations.success} passed · {summary.installations.failed} failed
            </Text>
          </Card>

          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>Active Pipeline</Text>
                <Title order={2} mt={4}>{summary.installations.running + summary.installations.pending}</Title>
              </div>
              <ThemeIcon color="red" variant="light" size={36} radius="md">
                <IconActivity size={18} />
              </ThemeIcon>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {summary.installations.running} running · {summary.installations.pending} queued
            </Text>
          </Card>
        </SimpleGrid>
      )}

      <MirrorStatusPanel />

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        <Card className="installer-card" padding="lg" component={Link} to="/installers">
          <Group gap="sm" mb="sm">
            <ThemeIcon color="red" variant="light" size={36} radius="md">
              <IconPlayerPlay size={18} />
            </ThemeIcon>
            <Title order={4}>Installer Catalog</Title>
          </Group>
          <Text c="dimmed" size="sm">
            Choose the target system, then move into the dedicated Kubernetes or K3s configuration page.
          </Text>
        </Card>

        <Card className="installer-card" padding="lg" component={Link} to="/executions">
          <Group gap="sm" mb="sm">
            <ThemeIcon color="red" variant="light" size={36} radius="md">
              <IconTerminal2 size={18} />
            </ThemeIcon>
            <Title order={4}>Execution Center</Title>
          </Group>
          <Text c="dimmed" size="sm">
            Resume active installations, inspect the live pipeline, and review final playbook output.
          </Text>
        </Card>

        <Card className="installer-card" padding="lg" component={Link} to="/history">
          <Group gap="sm" mb="sm">
            <ThemeIcon color="red" variant="light" size={36} radius="md">
              <IconFolders size={18} />
            </ThemeIcon>
            <Title order={4}>History</Title>
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
