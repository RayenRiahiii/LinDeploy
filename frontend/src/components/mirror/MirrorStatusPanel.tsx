import { useEffect, useMemo, useState } from "react";
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
  IconBolt,
  IconCloudDownload,
  IconDatabase,
  IconRefresh,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { formatApiError, parseApiPayload, parseJsonResponse } from "../../lib/api";

type MirrorComponentState = {
  status: string;
  active_version: string;
  available_version: string;
  last_checked_at: string;
  last_prewarm_at: string;
  error: string;
};

type MirrorStatus = {
  enabled: boolean;
  automatic: boolean;
  interval_hours: number;
  updated_at: string;
  components: {
    kubernetes: MirrorComponentState;
    k3s: MirrorComponentState;
  };
};

const BASE_URL = (import.meta.env.VITE_DJANGO_BASE_URL || "").replace(/\/+$/, "");
const ACTIVE_STATES = new Set(["queued", "checking", "running"]);

function statusColor(status: string) {
  if (status === "ready") return "teal";
  if (status === "failed") return "red";
  if (ACTIVE_STATES.has(status)) return "blue";
  return "gray";
}

function formatDate(value: string, fallback: string) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function ComponentStatus({
  name,
  state,
}: {
  name: string;
  state: MirrorComponentState;
}) {
  const { t } = useTranslation();
  return (
    <div className="mirror-component-status">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text fw={700}>{name}</Text>
          <Text size="sm" c="dimmed">
            {t("mirror.active", { version: state.active_version || t("mirror.notPrewarmed", "Not prewarmed"), defaultValue: `Active: ${state.active_version || "Not prewarmed"}` })}
          </Text>
        </div>
        <Badge color={statusColor(state.status)} variant="light">
          {state.status || "idle"}
        </Badge>
      </Group>
      <Text size="sm" mt="sm">
        {t("mirror.available", { version: state.available_version || "Pending check", defaultValue: `Available: ${state.available_version || "Pending check"}` })}
      </Text>
      <Text size="xs" c="dimmed" mt={4}>
        {t("mirror.lastCheck", { date: formatDate(state.last_checked_at, t("mirror.notCheckedYet", "Not checked yet")), defaultValue: `Last check: ${formatDate(state.last_checked_at, "Not checked yet")}` })}
      </Text>
      <Text size="xs" c="dimmed">
        {t("mirror.lastReady", { date: formatDate(state.last_prewarm_at, t("mirror.notCheckedYet", "Not checked yet")), defaultValue: `Last ready: ${formatDate(state.last_prewarm_at, "Not checked yet")}` })}
      </Text>
      {state.error && (
        <Text size="xs" c="red" mt="xs">
          {state.error}
        </Text>
      )}
    </div>
  );
}

export default function MirrorStatusPanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MirrorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"check" | "force" | "">("");
  const [error, setError] = useState("");

  const prewarmActive = useMemo(
    () =>
      status
        ? Object.values(status.components).some((component) =>
            ACTIVE_STATES.has(component.status)
          )
        : false,
    [status]
  );

  async function fetchStatus(showLoader = false) {
    if (showLoader) setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/api/mirror/`);
      const payload = await parseJsonResponse<MirrorStatus>(response);
      if (!response.ok) throw new Error("Unable to load mirror status.");
      setStatus(payload);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load mirror status.");
    } finally {
      if (showLoader) setLoading(false);
    }
  }

  async function requestPrewarm(force: boolean) {
    setAction(force ? "force" : "check");
    setError("");
    try {
      const response = await fetch(`${BASE_URL}/api/mirror/prewarm/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const payload = await parseApiPayload(response);
      if (!response.ok) {
        throw new Error(formatApiError(payload, "Unable to queue mirror prewarm."));
      }
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to queue mirror prewarm.");
    } finally {
      setAction("");
    }
  }

  useEffect(() => {
    void fetchStatus(true);
  }, []);

  useEffect(() => {
    if (!prewarmActive) return undefined;
    const timer = window.setInterval(() => void fetchStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [prewarmActive]);

  return (
    <Card className="console-panel mirror-status-panel" padding="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Group gap="sm" align="flex-start">
          <div className="mirror-status-icon">
            <IconDatabase size={20} />
          </div>
          <div>
            <Title order={3}>{t("mirror.title", "Local Mirror")}</Title>
            <Text c="dimmed" size="sm" mt={4}>
              {t("mirror.description", "Verified Kubernetes and K3s content cached on the LAN for faster deployments.")}
            </Text>
          </div>
        </Group>
        <Badge color={status?.enabled ? "teal" : "gray"} variant="light">
          {status?.enabled ? t("common.enabled", "Enabled") : t("common.disabled", "Disabled")}
        </Badge>
      </Group>

      {error && (
        <Alert color="red" variant="light" mt="md" title="Mirror operation failed">
          {error}
        </Alert>
      )}

      {status?.enabled && (
        <Stack gap="md" mt="lg">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <ComponentStatus name="Kubernetes" state={status.components.kubernetes} />
            <ComponentStatus name="K3s" state={status.components.k3s} />
          </SimpleGrid>
          <Group justify="space-between" align="center" gap="sm">
            <Text size="xs" c="dimmed">
              {t("mirror.autoCheck", { hours: status.interval_hours, defaultValue: `Automatic stable-release check every ${status.interval_hours} hours.` })}
            </Text>
            <Group gap="sm">
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                loading={loading || action === "check"}
                disabled={prewarmActive || action === "force"}
                onClick={() => void requestPrewarm(false)}
              >
                {t("mirror.checkForUpdates", "Check for updates")}
              </Button>
              <Button
                leftSection={prewarmActive ? <IconCloudDownload size={16} /> : <IconBolt size={16} />}
                loading={action === "force" || prewarmActive}
                disabled={action === "check"}
                onClick={() => void requestPrewarm(true)}
              >
                {prewarmActive ? t("mirror.prewarming", "Prewarming") : t("mirror.prewarmNow", "Prewarm now")}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Card>
  );
}
