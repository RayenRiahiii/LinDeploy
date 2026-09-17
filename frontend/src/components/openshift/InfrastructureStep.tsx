import { Alert, Badge, Grid, NumberInput, Select, Stack, Switch, TextInput } from "@mantine/core";
import { IconDatabase, IconServer2 } from "@tabler/icons-react";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftHost, OpenShiftSNOFormValues } from "./types";

type Props = {
  values: OpenShiftSNOFormValues;
  errors: OpenShiftFieldErrors;
  hosts: OpenShiftHost[];
  update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void;
};

export default function InfrastructureStep({ values, errors, hosts, update }: Props) {
  const hostOptions = hosts.filter((host) => host.enabled).map((host) => ({ value: String(host.id), label: `${host.name || host.hostname || host.ip_address} - ${host.ip_address}` }));

  return (
    <Stack gap="lg">
      <Alert color="blue" title="Provisioning host requirement">
        Select the registered RHEL 9 or compatible host that runs KVM/libvirt. LinDeploy connects to it over SSH and creates the SNO virtual machine there.
      </Alert>

      <OpenShiftFormSection icon={IconServer2} title="KVM host and virtual machine" description="Choose the hypervisor and assign stable names to the VM and its OpenShift node." badge={<Badge color="red" variant="light">One VM</Badge>}>
        <Select label="KVM provisioning host" description="The host must provide hardware virtualization, libvirt, enough capacity, and outbound access to Red Hat services." placeholder="Select a registered KVM host" required searchable data={hostOptions} value={values.provisioningHostId === null ? null : String(values.provisioningHostId)} error={errors.provisioningHostId} onChange={(value) => update("provisioningHostId", value ? Number(value) : null)} nothingFoundMessage="No enabled KVM host is registered" />
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Virtual machine name" description="Unique libvirt domain name on the selected KVM host." placeholder="sno-workshop-01" required value={values.vmName} error={errors.vmName} onChange={(event) => update("vmName", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="OpenShift node hostname" description="Hostname registered by the single OpenShift node." placeholder="sno-workshop-01-node" required value={values.nodeName} error={errors.nodeName} onChange={(event) => update("nodeName", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="libvirt network name" description="Existing compatible libvirt network or a new network managed by LinDeploy." placeholder="sno-workshop-01" required value={values.libvirtNetwork} error={errors.libvirtNetwork} onChange={(event) => update("libvirtNetwork", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="libvirt storage pool" description="Pool that contains the VM disk and discovery ISO." placeholder="default" required value={values.storagePool} error={errors.storagePool} onChange={(event) => update("storagePool", event.currentTarget.value)} /></Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      <OpenShiftFormSection icon={IconDatabase} title="Compute, storage, and boot" description="Defaults exceed the OpenShift SNO minimum. Increase them when additional Operators or workloads require more capacity.">
        <Grid>
          <Grid.Col span={{ base: 12, sm: 4 }}><NumberInput label="Virtual CPUs" description="Minimum: 8 vCPU." required min={8} value={values.vcpu} error={errors.vcpu} onChange={(value) => update("vcpu", Number(value) || 0)} /></Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}><NumberInput label="Memory (GiB)" description="Minimum: 16 GiB." required min={16} value={values.memoryGib} error={errors.memoryGib} onChange={(value) => update("memoryGib", Number(value) || 0)} /></Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}><NumberInput label="Virtual disk (GiB)" description="Minimum: 120 GiB." required min={120} value={values.diskGib} error={errors.diskGib} onChange={(value) => update("diskGib", Number(value) || 0)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><Select label="Firmware" description="UEFI is recommended for the current KVM profile." data={[{ value: "uefi", label: "UEFI (recommended)" }, { value: "bios", label: "Legacy BIOS" }]} value={values.bootMode} onChange={(value) => update("bootMode", (value || "uefi") as OpenShiftSNOFormValues["bootMode"])} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Installation device inside the VM" description="RHCOS erases this guest device, not a physical disk on the KVM host. Keep /dev/vda for the managed virtio disk." placeholder="/dev/vda" required value={values.installationDisk} error={errors.installationDisk} onChange={(event) => update("installationDisk", event.currentTarget.value)} /></Grid.Col>
        </Grid>
        <Switch label="Start the VM automatically with the KVM host" description="Enable libvirt autostart after a successful installation." checked={values.vmAutostart} onChange={(event) => update("vmAutostart", event.currentTarget.checked)} />
      </OpenShiftFormSection>
    </Stack>
  );
}
