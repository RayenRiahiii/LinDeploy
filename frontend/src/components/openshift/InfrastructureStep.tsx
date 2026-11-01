import { Alert, Badge, Button, Grid, NumberInput, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { IconDatabase, IconPlus, IconServer2 } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftHost, OpenShiftSNOFormValues } from "./types";

type Props = {
  values: OpenShiftSNOFormValues;
  errors: OpenShiftFieldErrors;
  hosts: OpenShiftHost[];
  update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void;
};

export default function InfrastructureStep({ values, errors, hosts, update }: Props) {
  const { t } = useTranslation();
  const hostOptions = hosts.filter((host) => host.enabled).map((host) => ({ value: String(host.id), label: `${host.name || host.hostname || host.ip_address} - ${host.ip_address}` }));

  return (
    <Stack gap="lg">
      <Alert color="blue" title={t("openshift.kvmReq", "Provisioning host requirement")}>
        {t("openshift.kvmReqDesc", "Select the registered RHEL 9 or compatible host that runs KVM/libvirt. LinDeploy connects to it over SSH and creates the SNO virtual machine there.")}
      </Alert>

      <OpenShiftFormSection
        icon={IconServer2}
        title={t("openshift.kvmHostTitle", "KVM host and virtual machine")}
        description={t("openshift.kvmHostDesc", "Choose the hypervisor and assign stable names to the VM and its OpenShift node.")}
        badge={<Badge color="red" variant="light">{t("openshift.oneVm", "One VM")}</Badge>}
      >
        <Select
          label={t("openshift.kvmHostSelectLabel", "KVM provisioning host")}
          description={t("openshift.kvmHostSelectDesc", "The host must provide hardware virtualization, libvirt, enough capacity, and outbound access to Red Hat services.")}
          placeholder={t("openshift.selectKvmHost", "Select a registered KVM host")}
          required
          searchable
          data={hostOptions}
          value={values.provisioningHostId === null ? null : String(values.provisioningHostId)}
          error={errors.provisioningHostId}
          onChange={(value) => update("provisioningHostId", value ? Number(value) : null)}
          nothingFoundMessage={t("openshift.noKvmHost", "No enabled KVM host is registered")}
        />
        {hostOptions.length === 0 && (
          <Alert
            color="orange"
            title={
              hosts.length === 0
                ? t("targets.noHostsAvailable", "No target hosts available")
                : t("targets.noEnabledHostsAvailable", "No enabled target hosts available")
            }
            icon={<IconServer2 size={18} />}
          >
            <Stack gap="xs" align="flex-start">
              <Text size="sm">
                {hosts.length === 0
                  ? t(
                      "targets.noHostsDesc",
                      "Your inventory has no target machines. Add a target host to proceed with the deployment."
                    )
                  : t(
                      "targets.allDisabledDesc",
                      "All registered hosts are currently disabled. Enable at least one host or register a new target."
                    )}
              </Text>
              <Button
                component={Link}
                to="/hosts"
                size="xs"
                color="red"
                leftSection={<IconPlus size={14} />}
              >
                {t("targets.addTargets", "Add target hosts")}
              </Button>
            </Stack>
          </Alert>
        )}
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.vmName", "Virtual machine name")}
              description={t("openshift.vmNameDesc", "Unique libvirt domain name on the selected KVM host.")}
              placeholder="sno-workshop-01"
              required
              value={values.vmName}
              error={errors.vmName}
              onChange={(event) => update("vmName", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.nodeName", "OpenShift node hostname")}
              description={t("openshift.nodeNameDesc", "Hostname registered by the single OpenShift node.")}
              placeholder="sno-workshop-01-node"
              required
              value={values.nodeName}
              error={errors.nodeName}
              onChange={(event) => update("nodeName", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.libvirtNetwork", "libvirt network name")}
              description={t("openshift.libvirtNetworkDesc", "Existing compatible libvirt network or a new network managed by LinDeploy.")}
              placeholder="sno-workshop-01"
              required
              value={values.libvirtNetwork}
              error={errors.libvirtNetwork}
              onChange={(event) => update("libvirtNetwork", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.storagePool", "libvirt storage pool")}
              description={t("openshift.storagePoolDesc", "Pool that contains the VM disk and discovery ISO.")}
              placeholder="default"
              required
              value={values.storagePool}
              error={errors.storagePool}
              onChange={(event) => update("storagePool", event.currentTarget.value)}
            />
          </Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      <OpenShiftFormSection
        icon={IconDatabase}
        title={t("openshift.computeTitle", "Compute, storage, and boot")}
        description={t("openshift.computeDesc", "Defaults exceed the OpenShift SNO minimum. Increase them when additional Operators or workloads require more capacity.")}
      >
        <Grid>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <NumberInput
              label={t("openshift.vcpu", "Virtual CPUs")}
              description={t("openshift.vcpuDesc", "Minimum: 8 vCPU.")}
              required
              min={8}
              value={values.vcpu}
              error={errors.vcpu}
              onChange={(value) => update("vcpu", Number(value) || 0)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <NumberInput
              label={t("openshift.memory", "Memory (GiB)")}
              description={t("openshift.memoryDesc", "Minimum: 16 GiB.")}
              required
              min={16}
              value={values.memoryGib}
              error={errors.memoryGib}
              onChange={(value) => update("memoryGib", Number(value) || 0)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <NumberInput
              label={t("openshift.disk", "Virtual disk (GiB)")}
              description={t("openshift.diskDesc", "Minimum: 120 GiB.")}
              required
              min={120}
              value={values.diskGib}
              error={errors.diskGib}
              onChange={(value) => update("diskGib", Number(value) || 0)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select
              label={t("openshift.firmware", "Firmware")}
              description={t("openshift.firmwareDesc", "UEFI is recommended for the current KVM profile.")}
              data={[
                { value: "uefi", label: t("openshift.uefiRecommended", "UEFI (recommended)") },
                { value: "bios", label: t("openshift.legacyBios", "Legacy BIOS") },
              ]}
              value={values.bootMode}
              onChange={(value) => update("bootMode", (value || "uefi") as OpenShiftSNOFormValues["bootMode"])}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.installDevice", "Installation device inside the VM")}
              description={t("openshift.installDeviceDesc", "RHCOS erases this guest device, not a physical disk on the KVM host. Keep /dev/vda for the managed virtio disk.")}
              placeholder="/dev/vda"
              required
              value={values.installationDisk}
              error={errors.installationDisk}
              onChange={(event) => update("installationDisk", event.currentTarget.value)}
            />
          </Grid.Col>
        </Grid>
        <Switch
          label={t("openshift.autostartVm", "Start the VM automatically with the KVM host")}
          description={t("openshift.autostartVmDesc", "Enable libvirt autostart after a successful installation.")}
          checked={values.vmAutostart}
          onChange={(event) => update("vmAutostart", event.currentTarget.checked)}
        />
      </OpenShiftFormSection>
    </Stack>
  );
}
