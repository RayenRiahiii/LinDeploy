import { Alert, Badge, Grid, Select, Stack, TextInput } from "@mantine/core";
import { IconFingerprint } from "@tabler/icons-react";
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
            <TextInput label="Cluster name" description="Lowercase DNS label used in every cluster URL." placeholder="workshop-01" required value={values.clusterName} error={errors.clusterName} onChange={(event) => update("clusterName", event.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput label="Base domain" description={`The API and console will use ${values.clusterName || "<cluster>"}.<base-domain>.`} placeholder="training.example.com" required value={values.baseDomain} error={errors.baseDomain} onChange={(event) => update("baseDomain", event.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select label="OpenShift release" description="The server mirror is preloaded with this exact release." required data={[{ value: "4.20.3", label: "OpenShift 4.20.3 (mirrored)" }]} value="4.20.3" readOnly error={errors.openshiftVersion} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select label="CPU architecture" description="The current LinDeploy libvirt adapter supports x86_64 only." required data={[{ value: "amd64", label: "x86_64 / amd64" }]} value={values.architecture} onChange={(value) => update("architecture", (value || "amd64") as OpenShiftSNOFormValues["architecture"])} />
          </Grid.Col>
        </Grid>
      </OpenShiftFormSection>
    </Stack>
  );
}
