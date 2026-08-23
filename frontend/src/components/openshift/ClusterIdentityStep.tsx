import { Alert, Badge, Grid, SegmentedControl, Select, Stack, Switch, Textarea, TextInput } from "@mantine/core";
import { IconFingerprint, IconShieldCheck } from "@tabler/icons-react";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftSNOFormValues } from "./types";

type Props = {
  values: OpenShiftSNOFormValues;
  errors: OpenShiftFieldErrors;
  update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void;
};

export default function ClusterIdentityStep({ values, errors, update }: Props) {
  return (
    <Stack gap="lg">
      <Alert color={values.disconnected ? "orange" : "blue"} title="Installation source">
        {values.disconnected
          ? "Disconnected mode generates an Agent ISO and pulls the exact release only from a verified local Quay registry."
          : "Connected mode provisions one SNO virtual machine through the hosted Red Hat Assisted Installer."}
      </Alert>
      <SegmentedControl
        fullWidth
        data={[
          { value: "connected", label: "Connected Assisted Installer" },
          { value: "disconnected", label: "Disconnected Agent-Based" },
        ]}
        value={values.disconnected ? "disconnected" : "connected"}
        onChange={(value) => update("disconnected", value === "disconnected")}
      />

      <OpenShiftFormSection
        icon={IconFingerprint}
        title="Cluster identity"
        description="These values define the permanent DNS identity of the cluster. Changing them after installation requires a new cluster."
        badge={<Badge color="red" variant="light">Required</Badge>}
      >
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="Cluster name" description="Lowercase DNS label used in every cluster URL." placeholder="workshop-01" required value={values.clusterName} error={errors.clusterName} onChange={(event) => update("clusterName", event.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="Base domain" description={`The API and console will use ${values.clusterName || "<cluster>"}.<base-domain>.`} placeholder="training.example.com" required value={values.baseDomain} error={errors.baseDomain} onChange={(event) => update("baseDomain", event.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select label="OpenShift release channel" description="Stable resolves to the supported stable release returned by Red Hat." required searchable data={[{ value: "stable", label: "Stable release" }, { value: "4.20", label: "OpenShift 4.20" }, { value: "4.19", label: "OpenShift 4.19" }, { value: "4.18", label: "OpenShift 4.18" }]} value={values.openshiftVersion} error={errors.openshiftVersion} onChange={(value) => update("openshiftVersion", value || "stable")} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select label="CPU architecture" description="The current LinDeploy libvirt adapter supports x86_64 only." required data={[{ value: "amd64", label: "x86_64 / amd64" }]} value={values.architecture} onChange={(value) => update("architecture", (value || "amd64") as OpenShiftSNOFormValues["architecture"])} />
          </Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      <OpenShiftFormSection icon={IconShieldCheck} title="Installation policy" description="The Agent-based Assisted Installer creates and monitors the discovery ISO and final SNO installation.">
        <Switch label="Enable FIPS mode" description="Leave disabled unless your organization requires FIPS and all planned Operators and workloads support it." checked={values.fips} onChange={(event) => update("fips", event.currentTarget.checked)} />
        <Textarea label="Description" description="Optional note saved with this installation request." placeholder="SNO cluster for the platform workshop" minRows={3} value={values.description} onChange={(event) => update("description", event.currentTarget.value)} />
      </OpenShiftFormSection>
    </Stack>
  );
}
