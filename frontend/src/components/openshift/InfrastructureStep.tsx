import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Grid,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronUp,
  IconCpu,
  IconDatabase,
  IconServer2,
  IconSettings,
} from "@tabler/icons-react";
import { useState } from "react";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftHost, OpenShiftSNOFormValues } from "./types";

type Props = {
  values: OpenShiftSNOFormValues;
  errors: OpenShiftFieldErrors;
  hosts: OpenShiftHost[];
  update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void;
};

function getHostCapacityColor(vcpu: number, memGib: number, diskGib: number) {
  if (vcpu >= 16 && memGib >= 32 && diskGib >= 200) return "teal";
  if (vcpu >= 8 && memGib >= 16 && diskGib >= 120) return "orange";
  return "red";
}

export default function InfrastructureStep({ values, errors, hosts, update }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const hostOptions = hosts
    .filter((host) => host.enabled)
    .map((host) => ({
      value: String(host.id),
      label: `${host.name || host.hostname || host.ip_address} (${host.ip_address})`,
    }));

  const selectedHost = values.provisioningHostId !== null
    ? hosts.find((h) => h.id === values.provisioningHostId)
    : null;

  return (
    <Stack gap="lg">
      <Alert color="blue" title="Provisioning host requirement">
        Select the registered RHEL 9 (or compatible) host running KVM/libvirt. LinDeploy connects via SSH and
        creates the SNO virtual machine there. The host must have at least 8 vCPU, 24 GiB RAM, and 160 GiB
        free storage available.
      </Alert>

      <OpenShiftFormSection
        icon={IconServer2}
        title="KVM host and virtual machine"
        description="Choose the hypervisor and assign stable names to the VM and its OpenShift node."
        badge={<Badge color="red" variant="light">One VM</Badge>}
      >
        <Select
          label="KVM provisioning host"
          description="The host must provide hardware virtualization, libvirt, enough capacity, and outbound network access."
          placeholder="Select a registered KVM host"
          required
          searchable
          data={hostOptions}
          value={values.provisioningHostId === null ? null : String(values.provisioningHostId)}
          error={errors.provisioningHostId}
          onChange={(value) => update("provisioningHostId", value ? Number(value) : null)}
          nothingFoundMessage="No enabled KVM host is registered"
        />

        {selectedHost && (
          <Card padding="xs" withBorder mt="xs" radius="md">
            <Group gap="sm" wrap="wrap">
              <ThemeIcon color="teal" variant="light" size="sm" radius="sm">
                <IconServer2 size={14} />
              </ThemeIcon>
              <div>
                <Text size="xs" fw={700}>{selectedHost.name || selectedHost.hostname}</Text>
                <Text size="xs" c="dimmed">{selectedHost.ip_address} · Port {selectedHost.ssh_port}</Text>
              </div>
              {selectedHost.os_type && (
                <Badge size="xs" color="gray" variant="light">{selectedHost.os_type}</Badge>
              )}
            </Group>
          </Card>
        )}

        <Grid mt="sm">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="Virtual machine name"
              description="Unique libvirt domain name on the selected KVM host."
              placeholder="sno-01"
              required
              value={values.vmName}
              error={errors.vmName}
              onChange={(event) => update("vmName", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="OpenShift node hostname"
              description="Hostname registered by the single OpenShift node."
              placeholder="sno-01-node"
              required
              value={values.nodeName}
              error={errors.nodeName}
              onChange={(event) => update("nodeName", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="libvirt network name"
              description="Existing or LinDeploy-managed libvirt network."
              placeholder="sno-workshop"
              required
              value={values.libvirtNetwork}
              error={errors.libvirtNetwork}
              onChange={(event) => update("libvirtNetwork", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="libvirt storage pool"
              description="Pool that will hold the VM disk and agent ISO."
              placeholder="sno-pool"
              required
              value={values.storagePool}
              error={errors.storagePool}
              onChange={(event) => update("storagePool", event.currentTarget.value)}
            />
          </Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      {/* Compute summary (simple display) */}
      <Card padding="sm" withBorder radius="md">
        <Group justify="space-between" wrap="wrap">
          <Group gap="lg">
            <Group gap="xs">
              <ThemeIcon
                color={getHostCapacityColor(values.vcpu, values.memoryGib, values.diskGib)}
                variant="light"
                size="sm"
              >
                <IconCpu size={14} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">vCPU</Text>
                <Text size="sm" fw={700}>{values.vcpu}</Text>
              </div>
            </Group>
            <Group gap="xs">
              <ThemeIcon color="blue" variant="light" size="sm">
                <IconDatabase size={14} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">Memory</Text>
                <Text size="sm" fw={700}>{values.memoryGib} GiB</Text>
              </div>
            </Group>
            <Group gap="xs">
              <ThemeIcon color="grape" variant="light" size="sm">
                <IconDatabase size={14} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed">Disk</Text>
                <Text size="sm" fw={700}>{values.diskGib} GiB</Text>
              </div>
            </Group>
            <Group gap="xs">
              <div>
                <Text size="xs" c="dimmed">Firmware</Text>
                <Text size="sm" fw={700}>{values.bootMode.toUpperCase()}</Text>
              </div>
            </Group>
            <Group gap="xs">
              <div>
                <Text size="xs" c="dimmed">Install disk</Text>
                <Text size="sm" fw={700}>{values.installationDisk}</Text>
              </div>
            </Group>
          </Group>
          <Button
            variant="subtle"
            size="xs"
            color="gray"
            leftSection={<IconSettings size={14} />}
            rightSection={advancedOpen ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? "Hide sizing" : "Change sizing"}
          </Button>
        </Group>
      </Card>

      <Collapse expanded={advancedOpen}>
        <OpenShiftFormSection
          icon={IconDatabase}
          title="Compute, storage, and boot"
          description="Defaults exceed the OpenShift SNO minimum. Increase when additional Operators or workloads require more capacity."
        >
          <Grid>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <NumberInput
                label="Virtual CPUs"
                description="Minimum: 8 vCPU."
                required
                min={8}
                value={values.vcpu}
                error={errors.vcpu}
                onChange={(value) => update("vcpu", Number(value) || 0)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <NumberInput
                label="Memory (GiB)"
                description="Minimum: 16 GiB."
                required
                min={16}
                value={values.memoryGib}
                error={errors.memoryGib}
                onChange={(value) => update("memoryGib", Number(value) || 0)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <NumberInput
                label="Virtual disk (GiB)"
                description="Minimum: 120 GiB."
                required
                min={120}
                value={values.diskGib}
                error={errors.diskGib}
                onChange={(value) => update("diskGib", Number(value) || 0)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Select
                label="Firmware"
                description="UEFI is recommended for the current KVM profile."
                data={[{ value: "uefi", label: "UEFI (recommended)" }, { value: "bios", label: "Legacy BIOS" }]}
                value={values.bootMode}
                onChange={(value) => update("bootMode", (value || "uefi") as OpenShiftSNOFormValues["bootMode"])}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <TextInput
                label="Installation device inside the VM"
                description="RHCOS erases this guest device, not a physical disk. Keep /dev/vda for the managed virtio disk."
                placeholder="/dev/vda"
                required
                value={values.installationDisk}
                error={errors.installationDisk}
                onChange={(event) => update("installationDisk", event.currentTarget.value)}
              />
            </Grid.Col>
          </Grid>
          <Switch
            label="Start the VM automatically with the KVM host"
            description="Enable libvirt autostart after a successful installation."
            checked={values.vmAutostart}
            onChange={(event) => update("vmAutostart", event.currentTarget.checked)}
          />
        </OpenShiftFormSection>
      </Collapse>

      {!advancedOpen && (
        <Box>
          <TextInput
            label="Installation device inside the VM"
            description="RHCOS erases this guest device, not a physical disk on the KVM host. Keep /dev/vda for the managed virtio disk."
            placeholder="/dev/vda"
            required
            value={values.installationDisk}
            error={errors.installationDisk}
            onChange={(event) => update("installationDisk", event.currentTarget.value)}
          />
        </Box>
      )}
    </Stack>
  );
}
