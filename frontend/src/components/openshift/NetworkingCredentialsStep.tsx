import { Alert, Badge, Grid, Group, NumberInput, SegmentedControl, Stack, Switch, Text, Textarea, TextInput } from "@mantine/core";
import { IconKey, IconNetwork, IconRoute, IconWorld } from "@tabler/icons-react";
import { derivedDnsNames } from "./form";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftSNOFormValues } from "./types";

type Props = {
  values: OpenShiftSNOFormValues;
  errors: OpenShiftFieldErrors;
  update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void;
};

export default function NetworkingCredentialsStep({ values, errors, update }: Props) {
  const dnsNames = derivedDnsNames(values);

  return (
    <Stack gap="lg">
      <Alert color="blue" title="Network profile">
        The current KVM adapter uses one IPv4 /24 machine network. Reserve one stable address for the SNO VM before installation.
      </Alert>

      <OpenShiftFormSection icon={IconNetwork} title="Node addressing" description="Define how the VM receives its persistent address. The same address serves the API, ingress routes, and node." badge={<Badge color="red" variant="light">IPv4 /24</Badge>}>
        <SegmentedControl fullWidth data={[{ value: "dhcp_reservation", label: "DHCP reservation" }, { value: "static", label: "Static configuration" }]} value={values.networkMode} onChange={(value) => update("networkMode", value as OpenShiftSNOFormValues["networkMode"])} />
        <Grid>
          <Grid.Col span={{ base: 12, md: 8 }}><TextInput label="Reserved machine IP" description="Persistent, unused IPv4 address assigned to the SNO VM." placeholder="192.168.130.51" required value={values.machineIp} error={errors.machineIp} onChange={(event) => update("machineIp", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}><NumberInput label="Prefix length" description="Fixed by the supported /24 profile." required min={24} max={24} value={values.prefixLength} readOnly /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Default gateway" description="Gateway reachable from the machine network." placeholder="192.168.130.1" required value={values.gateway} error={errors.gateway} onChange={(event) => update("gateway", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="DNS servers" description="One or more IPv4 addresses separated by commas or spaces." placeholder="192.168.130.1, 1.1.1.1" required value={values.dnsServers} error={errors.dnsServers} onChange={(event) => update("dnsServers", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Guest interface name" description="RHCOS network interface inside the VM. Use enp1s0 for the managed libvirt adapter." placeholder="enp1s0" required value={values.interfaceName} error={errors.interfaceName} onChange={(event) => update("interfaceName", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="VM MAC address" description="Stable libvirt MAC address. Keep the generated value unless it conflicts with an existing VM." value={values.macAddress} error={errors.macAddress} placeholder="52:54:00:01:00:51" onChange={(event) => update("macAddress", event.currentTarget.value)} /></Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      <OpenShiftFormSection icon={IconRoute} title="OpenShift networks" description="These CIDRs must not overlap each other or the physical machine network.">
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Machine network CIDR" description="The /24 network containing the VM address and gateway." placeholder="192.168.130.0/24" required value={values.machineNetworkCidr} error={errors.machineNetworkCidr} onChange={(event) => update("machineNetworkCidr", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Rendezvous IP" description="For SNO, this is normally the same address as the machine IP." placeholder="192.168.130.51" required value={values.rendezvousIp} error={errors.rendezvousIp} onChange={(event) => update("rendezvousIp", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}><TextInput label="Pod network CIDR" description="Address range used by OpenShift workloads." placeholder="10.128.0.0/14" required value={values.clusterNetworkCidr} error={errors.clusterNetworkCidr} onChange={(event) => update("clusterNetworkCidr", event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}><NumberInput label="Host prefix" description="Pod subnet size." required min={1} max={32} value={values.hostPrefix} error={errors.hostPrefix} onChange={(value) => update("hostPrefix", Number(value) || 0)} /></Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}><TextInput label="Service network CIDR" description="Virtual address range used by Kubernetes Services." placeholder="172.30.0.0/16" required value={values.serviceNetworkCidr} error={errors.serviceNetworkCidr} onChange={(event) => update("serviceNetworkCidr", event.currentTarget.value)} /></Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      <OpenShiftFormSection icon={IconWorld} title="DNS ownership" description="OpenShift requires API, internal API, wildcard application, and node records to resolve to the SNO address.">
        <SegmentedControl fullWidth data={[{ value: "managed", label: "LinDeploy-managed DNS" }, { value: "external", label: "External DNS managed by operator" }]} value={values.dnsManagement} onChange={(value) => update("dnsManagement", value as OpenShiftSNOFormValues["dnsManagement"])} />
        <div className="openshift-dns-records">
          {dnsNames.map((name) => <Group key={name} justify="space-between" gap="md" wrap="nowrap"><Text ff="monospace" size="sm">{name}</Text><Text size="sm" c="dimmed">to {values.machineIp || "machine IP"}</Text></Group>)}
        </div>
        <Text size="xs" c="dimmed">When external DNS is selected, create and verify these records before launch. Reverse DNS must also resolve the node address to its hostname.</Text>
      </OpenShiftFormSection>

      <OpenShiftFormSection icon={IconKey} title="Red Hat and node access" description="Credentials are encrypted into a short-lived, one-use bundle. They are not included in previews or stored in the generated inventory.">
        <Textarea className="openshift-secret-input" label="Red Hat pull secret" description="Paste the complete JSON pull secret downloaded from your Red Hat account." placeholder='{"auths":{"cloud.openshift.com":{"auth":"..."}}}' required minRows={4} autoComplete="off" spellCheck={false} value={values.pullSecret} error={errors.pullSecret} onChange={(event) => update("pullSecret", event.currentTarget.value)} />
        <Textarea label="SSH public key" description="Public key installed on the RHCOS node for emergency access. Never paste a private key." placeholder="ssh-ed25519 AAAAC3... operator@workstation" required minRows={3} autoComplete="off" spellCheck={false} value={values.sshPublicKey} error={errors.sshPublicKey} onChange={(event) => update("sshPublicKey", event.currentTarget.value)} />
        <Textarea className="openshift-secret-input" label="Additional certificate authority bundle" description="Optional PEM certificates required to trust organization-managed HTTPS endpoints." placeholder="-----BEGIN CERTIFICATE-----" minRows={3} autoComplete="off" spellCheck={false} value={values.additionalTrustBundle} onChange={(event) => update("additionalTrustBundle", event.currentTarget.value)} />
      </OpenShiftFormSection>

      {values.disconnected && (
        <OpenShiftFormSection icon={IconWorld} title="Disconnected content mirror" description="Configure the permanent RHEL-hosted Quay registry. Prepare content once for each exact OpenShift release, then reuse it for every SNO installation.">
          <Alert color="orange" title="Permanent infrastructure">
            This registry must have a stable DNS name and remain online whenever the OpenShift cluster runs. Cluster cleanup never removes mirror content.
          </Alert>
          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Mirror registry" description="DNS name and TLS port reachable by both the KVM host and RHCOS VM." placeholder="registry.lab.example.com:8443" required value={values.mirrorRegistry} error={errors.mirrorRegistry} onChange={(event) => update("mirrorRegistry", event.currentTarget.value)} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Persistent mirror storage" description="Filesystem path with at least 400 GiB free; operator catalogs can require more." placeholder="/var/lib/lindeploy/openshift-mirror" required value={values.mirrorStoragePath} error={errors.mirrorStoragePath} onChange={(event) => update("mirrorStoragePath", event.currentTarget.value)} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Quay initialization user" description="Used only through the encrypted one-use execution bundle." placeholder="init" required value={values.mirrorUsername} error={errors.mirrorUsername} onChange={(event) => update("mirrorUsername", event.currentTarget.value)} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}><TextInput type="password" label="Quay initialization password" description="Not saved in installation history or generated inventory." required autoComplete="new-password" value={values.mirrorPassword} error={errors.mirrorPassword} onChange={(event) => update("mirrorPassword", event.currentTarget.value)} /></Grid.Col>
            <Grid.Col span={12}><TextInput label="mirror-registry archive path on RHEL host" description="Download the Red Hat mirror-registry archive from console.redhat.com and place it on the selected host. Use the URL fields only when an authenticated HTTPS source is available." placeholder="/opt/lindeploy/mirror-registry.tar.gz" value={values.mirrorRegistryArchivePath} error={errors.mirrorRegistryArchivePath} onChange={(event) => update("mirrorRegistryArchivePath", event.currentTarget.value)} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 8 }}><TextInput label="Verified archive URL (optional)" description="HTTPS source used only when no local archive path is provided." placeholder="https://download.example.com/mirror-registry.tar.gz" value={values.mirrorRegistryArchiveUrl} error={errors.mirrorRegistryArchiveUrl} onChange={(event) => update("mirrorRegistryArchiveUrl", event.currentTarget.value)} /></Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}><TextInput label="Archive checksum" description="Required with an archive URL." placeholder="sha256:..." value={values.mirrorRegistryArchiveChecksum} error={errors.mirrorRegistryArchiveChecksum} onChange={(event) => update("mirrorRegistryArchiveChecksum", event.currentTarget.value)} /></Grid.Col>
          </Grid>
          <Textarea className="openshift-secret-input" label="External mirror CA (optional)" description="Leave empty when LinDeploy prepared Quay on this KVM host. Paste the PEM root CA only when using an external registry." placeholder="-----BEGIN CERTIFICATE-----" minRows={4} autoComplete="off" spellCheck={false} value={values.mirrorCaBundle} error={errors.mirrorCaBundle} onChange={(event) => update("mirrorCaBundle", event.currentTarget.value)} />
          <Switch checked={values.mirrorIncludeGraph} label="Mirror the OpenShift update graph" description="Recommended for lifecycle visibility; it adds a small amount of content." onChange={(event) => update("mirrorIncludeGraph", event.currentTarget.checked)} />
        </OpenShiftFormSection>
      )}
    </Stack>
  );
}
