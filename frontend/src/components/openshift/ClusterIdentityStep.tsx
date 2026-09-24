import { Alert, Badge, Box, Button, Collapse, Grid, Group, Select, Stack, Switch, Text, Textarea, TextInput, ThemeIcon } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconFingerprint, IconServer2, IconShieldCheck, IconWifi } from "@tabler/icons-react";
import { useState } from "react";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftSNOFormValues } from "./types";

const BASE_URL = import.meta.env.VITE_DJANGO_BASE_URL;

type Props = {
  values: OpenShiftSNOFormValues;
  errors: OpenShiftFieldErrors;
  update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void;
};

type MirrorCheckResult = "idle" | "checking" | "ok" | "failed";

export default function ClusterIdentityStep({ values, errors, update }: Props) {
  const [mirrorCheck, setMirrorCheck] = useState<MirrorCheckResult>("idle");
  const [mirrorMessage, setMirrorMessage] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  async function checkMirror() {
    setMirrorCheck("checking");
    setMirrorMessage("");
    try {
      const response = await fetch(`${BASE_URL}/api/mirror/`, { signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const data = (await response.json()) as { enabled?: boolean; updated_at?: string };
        setMirrorCheck("ok");
        setMirrorMessage(data.updated_at ? `Mirror is available. Last updated: ${new Date(data.updated_at).toLocaleString()}.` : "Mirror endpoint reachable.");
      } else {
        setMirrorCheck("failed");
        setMirrorMessage(`Mirror API returned HTTP ${response.status}.`);
      }
    } catch {
      setMirrorCheck("failed");
      setMirrorMessage("Mirror is not reachable from the LinDeploy controller.");
    }
  }

  return (
    <Stack gap="lg">
      {/* Mirror health indicator */}
      <Box className="openshift-mirror-status-bar">
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Group gap="sm">
            <ThemeIcon
              color={mirrorCheck === "ok" ? "teal" : mirrorCheck === "failed" ? "red" : mirrorCheck === "checking" ? "blue" : "gray"}
              variant="light"
              size="md"
              radius="md"
            >
              <IconServer2 size={16} />
            </ThemeIcon>
            <div>
              <Group gap="xs">
                <Text size="sm" fw={600}>Mirror registry</Text>
                <Badge
                  color={mirrorCheck === "ok" ? "teal" : mirrorCheck === "failed" ? "red" : mirrorCheck === "checking" ? "blue" : "gray"}
                  variant="light"
                  size="sm"
                >
                  {values.mirrorRegistry}
                </Badge>
                {mirrorCheck === "ok" && <Badge color="teal" variant="dot" size="sm">Reachable</Badge>}
                {mirrorCheck === "failed" && <Badge color="red" variant="dot" size="sm">Unreachable</Badge>}
                {mirrorCheck === "checking" && <Badge color="blue" variant="dot" size="sm">Checking…</Badge>}
              </Group>
              {mirrorMessage && <Text size="xs" c={mirrorCheck === "failed" ? "red" : "dimmed"} mt={2}>{mirrorMessage}</Text>}
            </div>
          </Group>
          <Button
            size="xs"
            variant="light"
            color={mirrorCheck === "ok" ? "teal" : mirrorCheck === "failed" ? "red" : "blue"}
            leftSection={<IconWifi size={14} />}
            loading={mirrorCheck === "checking"}
            onClick={() => void checkMirror()}
          >
            Test mirror
          </Button>
        </Group>
      </Box>

      <Alert color="orange" title="Managed disconnected installation">
        LinDeploy uses the permanent Quay mirror configured on the server. The cluster never downloads release content from the Internet.
      </Alert>

      <OpenShiftFormSection
        icon={IconFingerprint}
        title="Cluster identity"
        description="These values define the permanent DNS identity of the cluster. Changing them after installation requires a new cluster."
        badge={<Badge color="red" variant="light">Required</Badge>}
      >
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="Cluster name"
              description="Lowercase DNS label used in every cluster URL."
              placeholder="sno-01"
              required
              value={values.clusterName}
              error={errors.clusterName}
              onChange={(event) => update("clusterName", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="Base domain"
              description={`The API and console will use ${values.clusterName || "<cluster>"}.<base-domain>.`}
              placeholder="lab.test"
              required
              value={values.baseDomain}
              error={errors.baseDomain}
              onChange={(event) => update("baseDomain", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select
              label="OpenShift release"
              description="The server mirror is preloaded with this exact release."
              required
              data={[{ value: "4.20.3", label: "OpenShift 4.20.3 (mirrored)" }]}
              value="4.20.3"
              readOnly
              error={errors.openshiftVersion}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select
              label="CPU architecture"
              description="The current LinDeploy libvirt adapter supports x86_64 only."
              required
              data={[{ value: "amd64", label: "x86_64 / amd64" }]}
              value={values.architecture}
              onChange={(value) => update("architecture", (value || "amd64") as OpenShiftSNOFormValues["architecture"])}
            />
          </Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      <OpenShiftFormSection
        icon={IconShieldCheck}
        title="Installation policy"
        description="The Agent-based Assisted Installer creates and monitors the discovery ISO and final SNO installation."
      >
        <Switch
          label="Enable FIPS mode"
          description="Leave disabled unless your organization requires FIPS and all planned Operators and workloads support it."
          checked={values.fips}
          onChange={(event) => update("fips", event.currentTarget.checked)}
        />
        <Textarea
          label="Description"
          description="Optional note saved with this installation request."
          placeholder="SNO cluster for the platform workshop"
          minRows={2}
          value={values.description}
          onChange={(event) => update("description", event.currentTarget.value)}
        />
      </OpenShiftFormSection>

      {/* Professional mode toggle */}
      <Box>
        <Button
          variant="subtle"
          size="sm"
          color="gray"
          leftSection={advancedOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? "Hide professional options" : "Show professional options"}
        </Button>
        <Collapse expanded={advancedOpen}>
          <Box mt="md">
            <Alert color="blue" title="Professional options">
              These settings use the LinDeploy defaults for most environments. Only change them if your lab configuration differs.
            </Alert>
          </Box>
        </Collapse>
      </Box>
    </Stack>
  );
}
