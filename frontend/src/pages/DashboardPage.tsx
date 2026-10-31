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
import { useTranslation } from "react-i18next";
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

const BASE_URL = (import.meta.env.VITE_DJANGO_BASE_URL || "").replace(/\/+$/, "");

function getStatusColor(status?: string | null) {
  if (status === "success") return "teal";
  if (status === "partial_success") return "yellow";
  if (status === "failed") return "red";
  if (status === "cancelled") return "yellow";
  return "gray";
}

export default function DashboardPage() {
  const { t } = useTranslation();
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
        badge={t("dashboard.badge", "Platform Overview")}
        badgeColor="red"
        title={t("dashboard.title", "Operational Summary")}
        subtitle={t("dashboard.subtitle", "Real-time status of your infrastructure inventory, saved credentials, and deployment pipelines.")}
        stats={
          summary ? (
            <>
              <Badge color="red" variant="light">
                {t("nav.hosts", "Hosts")}: {summary.hosts.total}
              </Badge>
              <Badge color="teal" variant="light">
                {t("dashboard.activeQueue", "Active Queue")}: {summary.installations.running + summary.installations.pending}
              </Badge>
              <Badge color="gray" variant="outline">
                {t("dashboard.totalRuns", "Total Runs")}: {summary.installations.total}
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
            {t("common.refresh", "Refresh")}
          </Button>
        }
      />

      {error && (
        <Alert color="red" variant="light" title={t("common.error", "Dashboard error")}>
          {error}
        </Alert>
      )}

      {summary && (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>
                  {t("dashboard.hostsInventory", "Hosts Inventory")}
                </Text>
                <Title order={2} mt={4}>{summary.hosts.total}</Title>
              </div>
              <ThemeIcon color="red" variant="light" size={36} radius="md">
                <IconServer size={18} />
              </ThemeIcon>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {t("dashboard.hostsStats", {
                enabled: summary.hosts.enabled,
                cp: summary.hosts.control_plane,
                worker: summary.hosts.worker,
                defaultValue: `${summary.hosts.enabled} enabled · ${summary.hosts.control_plane} CP · ${summary.hosts.worker} worker`,
              })}
            </Text>
          </Card>

          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>
                  {t("dashboard.credentials", "Credentials")}
                </Text>
                <Title order={2} mt={4}>{summary.credentials.total}</Title>
              </div>
              <ThemeIcon color="red" variant="light" size={36} radius="md">
                <IconKey size={18} />
              </ThemeIcon>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {t("dashboard.credStats", {
                password: summary.credentials.password,
                sshKey: summary.credentials.ssh_key,
                defaultValue: `${summary.credentials.password} password · ${summary.credentials.ssh_key} SSH key`,
              })}
            </Text>
          </Card>

          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>
                  {t("dashboard.totalDeployments", "Total Deployments")}
                </Text>
                <Title order={2} mt={4}>{summary.installations.total}</Title>
              </div>
              <ThemeIcon color="red" variant="light" size={36} radius="md">
                <IconPlayerPlay size={18} />
              </ThemeIcon>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {t("dashboard.deployStats", {
                passed: summary.installations.success,
                failed: summary.installations.failed,
                defaultValue: `${summary.installations.success} passed · ${summary.installations.failed} failed`,
              })}
            </Text>
          </Card>

          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>
                  {t("dashboard.activePipeline", "Active Pipeline")}
                </Text>
                <Title order={2} mt={4}>{summary.installations.running + summary.installations.pending}</Title>
              </div>
              <ThemeIcon color="red" variant="light" size={36} radius="md">
                <IconActivity size={18} />
              </ThemeIcon>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {t("dashboard.pipelineStats", {
                running: summary.installations.running,
                queued: summary.installations.pending,
                defaultValue: `${summary.installations.running} running · ${summary.installations.pending} queued`,
              })}
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
            <Title order={4}>{t("installers.title", "Installer Catalog")}</Title>
          </Group>
          <Text c="dimmed" size="sm">
            {t("dashboard.installerCatalogDesc", "Choose the target system, then move into the dedicated Kubernetes or K3s configuration page.")}
          </Text>
        </Card>

        <Card className="installer-card" padding="lg" component={Link} to="/executions">
          <Group gap="sm" mb="sm">
            <ThemeIcon color="red" variant="light" size={36} radius="md">
              <IconTerminal2 size={18} />
            </ThemeIcon>
            <Title order={4}>{t("sections.executions.badge", "Execution Center")}</Title>
          </Group>
          <Text c="dimmed" size="sm">
            {t("dashboard.executionCenterDesc", "Resume active installations, inspect the live pipeline, and review final playbook output.")}
          </Text>
        </Card>

        <Card className="installer-card" padding="lg" component={Link} to="/history">
          <Group gap="sm" mb="sm">
            <ThemeIcon color="red" variant="light" size={36} radius="md">
              <IconFolders size={18} />
            </ThemeIcon>
            <Title order={4}>{t("nav.history", "History")}</Title>
          </Group>
          <Text c="dimmed" size="sm">
            {t("dashboard.historyDesc", "Review completed runs separately from the live execution workspace and delete obsolete records.")}
          </Text>
        </Card>
      </SimpleGrid>

      {summary?.latest_installation && (
        <Card className="console-panel" padding="lg">
          <Group justify="space-between" align="center">
            <div>
              <Title order={3}>{t("dashboard.latestInstallation", "Latest Installation")}</Title>
              <Text c="dimmed" size="sm" mt={4}>
                {t("dashboard.installationNum", {
                  id: summary.latest_installation.id,
                  name: summary.latest_installation.template_name,
                  defaultValue: `installation #${summary.latest_installation.id} | ${summary.latest_installation.template_name}`,
                })}
              </Text>
            </div>
            <Badge color={getStatusColor(summary.latest_installation.status)} variant="light">
              {summary.latest_installation.status}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed" mt="md">
            {t("dashboard.phaseProgress", {
              phase: summary.latest_installation.phase,
              progress: summary.latest_installation.progress,
              defaultValue: `phase ${summary.latest_installation.phase} | progress ${summary.latest_installation.progress}%`,
            })}
          </Text>
        </Card>
      )}
    </Stack>
  );
}
