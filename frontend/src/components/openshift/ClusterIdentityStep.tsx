import { Alert, Badge, Grid, Select, Stack, TextInput } from "@mantine/core";
import { IconFingerprint } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftSNOFormValues } from "./types";

type Props = {
  values: OpenShiftSNOFormValues;
  errors: OpenShiftFieldErrors;
  update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void;
};

export default function ClusterIdentityStep({ values, errors, update }: Props) {
  const { t } = useTranslation();

  return (
    <Stack gap="lg">
      <Alert color="orange" title={t("openshift.managedDisconnected", "Managed disconnected installation")}>
        {t("openshift.managedDisconnectedDesc", "LinDeploy uses the permanent Quay mirror configured on the server. The cluster never downloads release content from the Internet.")}
      </Alert>

      <OpenShiftFormSection
        icon={IconFingerprint}
        title={t("openshift.clusterIdentity", "Cluster identity")}
        description={t("openshift.clusterIdentityDesc", "These values define the permanent DNS identity of the cluster. Changing them after installation requires a new cluster.")}
        badge={<Badge color="red" variant="light">{t("common.required", "Required")}</Badge>}
      >
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.clusterName", "Cluster name")}
              description={t("openshift.clusterNameDesc", "Lowercase DNS label used in every cluster URL.")}
              placeholder="workshop-01"
              required
              value={values.clusterName}
              error={errors.clusterName}
              onChange={(event) => update("clusterName", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.baseDomain", "Base domain")}
              description={t("openshift.baseDomainDesc", { clusterName: values.clusterName || "<cluster>", defaultValue: `The API and console will use ${values.clusterName || "<cluster>"}.<base-domain>.` })}
              placeholder="training.example.com"
              required
              value={values.baseDomain}
              error={errors.baseDomain}
              onChange={(event) => update("baseDomain", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select
              label={t("openshift.release", "OpenShift release")}
              description={t("openshift.releaseDesc", "The server mirror is preloaded with this exact release.")}
              required
              data={[{ value: "4.20.3", label: t("openshift.releaseMirrored", "OpenShift 4.20.3 (mirrored)") }]}
              value="4.20.3"
              readOnly
              error={errors.openshiftVersion}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select
              label={t("openshift.architecture", "CPU architecture")}
              description={t("openshift.architectureDesc", "The current LinDeploy libvirt adapter supports x86_64 only.")}
              required
              data={[{ value: "amd64", label: "x86_64 / amd64" }]}
              value={values.architecture}
              onChange={(value) => update("architecture", (value || "amd64") as OpenShiftSNOFormValues["architecture"])}
            />
          </Grid.Col>
        </Grid>
      </OpenShiftFormSection>
    </Stack>
  );
}
