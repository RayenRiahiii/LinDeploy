import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Drawer,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconActivity,
  IconArrowRight,
  IconCheck,
  IconDatabase,
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
  if (status === "running") return "blue";
  return "gray";
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mirrorDrawerOpened, setMirrorDrawerOpened] = useState(false);

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

  const activeRunsCount = (summary?.installations.running ?? 0) + (summary?.installations.pending ?? 0);

  return (
    <Stack gap="lg">
      <PageHeader
        icon={<IconLayoutDashboard size={22} />}
        badge={t("dashboard.badge", "Vue d'ensemble")}
        badgeColor="red"
        title={t("dashboard.title", "Résumé Opérationnel")}
        subtitle={t(
          "dashboard.subtitle",
          "Surveillance en temps réel de votre inventaire, identifiants d'accès et pipelines de déploiement."
        )}
        stats={
          summary ? (
            <>
              <Badge color="red" variant="light">
                {t("nav.hosts", "Hôtes")}: {summary.hosts.total}
              </Badge>
              <Badge color={activeRunsCount > 0 ? "blue" : "gray"} variant="light">
                {t("dashboard.activeQueue", "Pipeline actif")}: {activeRunsCount}
              </Badge>
              <Badge color="gray" variant="outline">
                {t("dashboard.totalRuns", "Exécutions")}: {summary.installations.total}
              </Badge>
            </>
          ) : undefined
        }
        actions={
          <Group gap="sm" wrap="wrap">
            <Button
              color="red"
              leftSection={<IconPlayerPlay size={16} />}
              component={Link}
              to="/installers"
            >
              {t("dashboard.newDeployment", "+ Nouveau Déploiement")}
            </Button>
            <Button
              variant="default"
              leftSection={<IconServer size={16} />}
              component={Link}
              to="/hosts"
            >
              {t("hosts.addHost", "+ Ajouter un hôte")}
            </Button>
            <Button
              variant="subtle"
              leftSection={<IconRefresh size={16} />}
              onClick={() => void fetchSummary()}
              loading={loading}
            >
              {t("common.refresh", "Actualiser")}
            </Button>
          </Group>
        }
      />

      {error && (
        <Alert color="red" variant="light" title={t("common.error", "Erreur Dashboard")}>
          {error}
        </Alert>
      )}

      {summary && (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>
                  {t("dashboard.hostsInventory", "Hôtes Détectés")}
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
                defaultValue: `${summary.hosts.enabled} activés · ${summary.hosts.control_plane} CP · ${summary.hosts.worker} worker`,
              })}
            </Text>
          </Card>

          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>
                  {t("dashboard.credentials", "Accès SSH")}
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
                defaultValue: `${summary.credentials.password} mot de passe · ${summary.credentials.ssh_key} clé SSH`,
              })}
            </Text>
          </Card>

          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>
                  {t("dashboard.totalDeployments", "Déploiements Totaux")}
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
                defaultValue: `${summary.installations.success} réussis · ${summary.installations.failed} échoués`,
              })}
            </Text>
          </Card>

          <Card className="console-panel dashboard-stat-card" padding="lg">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text c="dimmed" size="xs" fw={700} tt="uppercase" style={{ letterSpacing: "0.5px" }}>
                  {t("dashboard.activePipeline", "Pipeline Actif")}
                </Text>
                <Title order={2} mt={4}>{activeRunsCount}</Title>
              </div>
              <ThemeIcon color="red" variant="light" size={36} radius="md">
                <IconActivity size={18} />
              </ThemeIcon>
            </Group>
            <Text size="xs" c="dimmed" mt="sm">
              {t("dashboard.pipelineStats", {
                running: summary.installations.running,
                queued: summary.installations.pending,
                defaultValue: `${summary.installations.running} en cours · ${summary.installations.pending} en attente`,
              })}
            </Text>
          </Card>
        </SimpleGrid>
      )}

      {/* How LinDeploy works (Workflow moderne inspire du modele SaaS) */}
      <Card className="console-panel" padding="xl" radius="md">
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="md" mb={32}>
          <div>
            <Title order={2} style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.4px" }}>
              {t("dashboard.howItWorksTitle", "How LinDeploy works")}
            </Title>
          </div>
          <Text size="sm" c="dimmed">
            {t("dashboard.howItWorksSubtitle", "Deploy clusters easily in minutes.")}
          </Text>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xl">
          {/* Etape 01 : Prepare Inventory */}
          <Box
            component={Link}
            to="/hosts"
            className="workflow-step-item"
          >
            <Group wrap="nowrap" align="center" mb="lg">
              <Box className="workflow-step-circle">01</Box>
              <Box className="workflow-step-line" visibleFrom="md" />
            </Group>
            <Text fw={700} size="lg" className="workflow-step-title" mb={6}>
              {t("dashboard.step1Title", "Prepare Inventory")}
            </Text>
            <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
              {t(
                "dashboard.step1Desc",
                "Register your target host machines and SSH credentials with automatic reachability validation."
              )}
            </Text>
          </Box>

          {/* Etape 02 : Select Installer */}
          <Box
            component={Link}
            to="/installers"
            className="workflow-step-item"
          >
            <Group wrap="nowrap" align="center" mb="lg">
              <Box className="workflow-step-circle">02</Box>
              <Box className="workflow-step-line" visibleFrom="md" />
            </Group>
            <Text fw={700} size="lg" className="workflow-step-title" mb={6}>
              {t("dashboard.step2Title", "Select Installer")}
            </Text>
            <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
              {t(
                "dashboard.step2Desc",
                "Choose the cluster orchestrator and topology for your infrastructure with optional local mirror caching."
              )}
            </Text>
          </Box>

          {/* Etape 03 : Deploy & Monitor */}
          <Box
            component={Link}
            to="/executions"
            className="workflow-step-item"
          >
            <Group wrap="nowrap" align="center" mb="lg">
              <Box className="workflow-step-circle">03</Box>
            </Group>
            <Text fw={700} size="lg" className="workflow-step-title" mb={6}>
              {t("dashboard.step3Title", "Deploy & Monitor")}
            </Text>
            <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
              {t(
                "dashboard.step3Desc",
                "Launch the automated deployment pipeline and monitor task-by-task execution with live logs in real time."
              )}
            </Text>
          </Box>
        </SimpleGrid>
      </Card>

      {/* Carte du Dernier Déploiement / Activité Récente */}
      {summary?.latest_installation && (
        <Card className="console-panel" padding="lg" radius="md">
          <Group justify="space-between" align="center" wrap="wrap" gap="sm">
            <Group gap="sm">
              <ThemeIcon
                color={getStatusColor(summary.latest_installation.status)}
                variant="light"
                size={36}
                radius="md"
              >
                {summary.latest_installation.status === "running" ? (
                  <IconActivity size={18} />
                ) : summary.latest_installation.status === "success" ? (
                  <IconCheck size={18} />
                ) : (
                  <IconTerminal2 size={18} />
                )}
              </ThemeIcon>
              <div>
                <Group gap="xs">
                  <Title order={4}>
                    {t("dashboard.latestInstallation", "Dernière Exécution")} #{summary.latest_installation.id}
                  </Title>
                  <Badge color={getStatusColor(summary.latest_installation.status)} variant="light">
                    {summary.latest_installation.status === "running"
                      ? t("execution.statusRunning", "Running")
                      : summary.latest_installation.status === "success"
                        ? t("execution.statusSuccess", "Success")
                        : summary.latest_installation.status === "failed"
                          ? t("execution.statusFailed", "Failed")
                          : summary.latest_installation.status === "cancelled"
                            ? t("execution.statusCancelled", "Cancelled")
                            : summary.latest_installation.status.toUpperCase()}
                  </Badge>
                </Group>
                <Text c="dimmed" size="xs" mt={2}>
                  {summary.latest_installation.template_name} · {t("dashboard.phaseLabel", "Phase")} : {summary.latest_installation.phase} ({summary.latest_installation.progress}%)
                </Text>
              </div>
            </Group>
            <Button
              component={Link}
              to={`/executions/${summary.latest_installation.id}`}
              variant="light"
              color="red"
              size="xs"
              rightSection={<IconArrowRight size={14} />}
            >
              {t("dashboard.viewExecution", "Voir l'exécution")}
            </Button>
          </Group>

          <Progress
            value={summary.latest_installation.progress}
            color={getStatusColor(summary.latest_installation.status)}
            size="sm"
            radius="xl"
            striped={summary.latest_installation.status === "running"}
            animated={summary.latest_installation.status === "running"}
            mt="md"
          />
        </Card>
      )}

      {/* Option A : Bandeau compact pour le Miroir Local */}
      <Card className="console-panel" padding="md" radius="md">
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Group gap="sm">
            <ThemeIcon color="teal" variant="light" size={32} radius="md">
              <IconDatabase size={18} />
            </ThemeIcon>
            <div>
              <Group gap="xs">
                <Text size="sm" fw={700}>
                  {t("mirror.compactTitle", "Cache & Miroir Local LAN")}
                </Text>
                <Badge color="teal" size="xs" variant="light">
                  {t("common.ready", "Prêt (Actif)")}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {t(
                  "mirror.compactSub",
                  "Paquets Kubernetes et K3s mis en cache sur le réseau local pour accélérer les installations"
                )}
              </Text>
            </div>
          </Group>
          <Button
            variant="light"
            color="red"
            size="xs"
            leftSection={<IconDatabase size={14} />}
            onClick={() => setMirrorDrawerOpened(true)}
          >
            {t("mirror.manageDrawer", "Gérer le cache & préchauffage")} →
          </Button>
        </Group>
      </Card>

      {/* Drawer Latéral pour la gestion du Miroir Local */}
      <Drawer
        opened={mirrorDrawerOpened}
        onClose={() => setMirrorDrawerOpened(false)}
        position="right"
        size="lg"
        title={
          <Group gap="xs">
            <ThemeIcon color="red" variant="light" size={28} radius="md">
              <IconDatabase size={16} />
            </ThemeIcon>
            <Text fw={700} size="sm">
              {t("mirror.drawerTitle", "Gestion du Miroir Local & Préchauffage")}
            </Text>
          </Group>
        }
        padding="md"
      >
        <MirrorStatusPanel />
      </Drawer>
    </Stack>
  );
}
