import { Alert, Badge, Grid, NumberInput, SegmentedControl, Stack, Textarea, TextInput } from "@mantine/core";
import { IconKey, IconNetwork, IconRoute } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftSNOFormValues } from "./types";

type Props = {
  values: OpenShiftSNOFormValues;
  errors: OpenShiftFieldErrors;
  update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void;
};

export default function NetworkingCredentialsStep({ values, errors, update }: Props) {
  const { t } = useTranslation();

  return (
    <Stack gap="lg">
      <Alert color="blue" title={t("openshift.networkProfile", "Network profile")}>
        {t("openshift.networkProfileDesc", "The current KVM adapter uses one IPv4 /24 machine network. Reserve one stable address for the SNO VM before installation.")}
      </Alert>

      <OpenShiftFormSection
        icon={IconNetwork}
        title={t("openshift.nodeAddressing", "Node addressing")}
        description={t("openshift.nodeAddressingDesc", "Define how the VM receives its persistent address. The same address serves the API, ingress routes, and node.")}
        badge={<Badge color="red" variant="light">IPv4 /24</Badge>}
      >
        <SegmentedControl
          fullWidth
          data={[
            { value: "dhcp_reservation", label: t("openshift.dhcpReservation", "DHCP reservation") },
            { value: "static", label: t("openshift.staticConfig", "Static configuration") },
          ]}
          value={values.networkMode}
          onChange={(value) => update("networkMode", value as OpenShiftSNOFormValues["networkMode"])}
        />
        <Grid>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <TextInput
              label={t("openshift.reservedMachineIp", "Reserved machine IP")}
              description={t("openshift.reservedMachineIpDesc", "Persistent, unused IPv4 address assigned to the SNO VM.")}
              placeholder="192.168.130.51"
              required
              value={values.machineIp}
              error={errors.machineIp}
              onChange={(event) => update("machineIp", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <NumberInput
              label={t("openshift.prefixLength", "Prefix length")}
              description={t("openshift.prefixLengthDesc", "Fixed by the supported /24 profile.")}
              required
              min={24}
              max={24}
              value={values.prefixLength}
              readOnly
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.gateway", "Default gateway")}
              description={t("openshift.gatewayDesc", "Gateway reachable from the machine network.")}
              placeholder="192.168.130.1"
              required
              value={values.gateway}
              error={errors.gateway}
              onChange={(event) => update("gateway", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.dnsServers", "DNS servers")}
              description={t("openshift.dnsServersDesc", "One or more IPv4 addresses separated by commas or spaces.")}
              placeholder="192.168.130.1, 1.1.1.1"
              required
              value={values.dnsServers}
              error={errors.dnsServers}
              onChange={(event) => update("dnsServers", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.guestInterface", "Guest interface name")}
              description={t("openshift.guestInterfaceDesc", "RHCOS network interface inside the VM. Use enp1s0 for the managed libvirt adapter.")}
              placeholder="enp1s0"
              required
              value={values.interfaceName}
              error={errors.interfaceName}
              onChange={(event) => update("interfaceName", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.vmMacAddress", "VM MAC address")}
              description={t("openshift.vmMacAddressDesc", "Stable libvirt MAC address. Keep the generated value unless it conflicts with an existing VM.")}
              value={values.macAddress}
              error={errors.macAddress}
              placeholder="52:54:00:01:00:51"
              onChange={(event) => update("macAddress", event.currentTarget.value)}
            />
          </Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      <OpenShiftFormSection
        icon={IconRoute}
        title={t("openshift.openShiftNetworks", "OpenShift networks")}
        description={t("openshift.openShiftNetworksDesc", "These CIDRs must not overlap each other or the physical machine network.")}
      >
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.machineNetworkCidr", "Machine network CIDR")}
              description={t("openshift.machineNetworkCidrDesc", "The /24 network containing the VM address and gateway.")}
              placeholder="192.168.130.0/24"
              required
              value={values.machineNetworkCidr}
              error={errors.machineNetworkCidr}
              onChange={(event) => update("machineNetworkCidr", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label={t("openshift.rendezvousIp", "Rendezvous IP")}
              description={t("openshift.rendezvousIpDesc", "For SNO, this is normally the same address as the machine IP.")}
              placeholder="192.168.130.51"
              required
              value={values.rendezvousIp}
              error={errors.rendezvousIp}
              onChange={(event) => update("rendezvousIp", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <TextInput
              label={t("openshift.podNetworkCidr", "Pod network CIDR")}
              description={t("openshift.podNetworkCidrDesc", "Address range used by OpenShift workloads.")}
              placeholder="10.128.0.0/14"
              required
              value={values.clusterNetworkCidr}
              error={errors.clusterNetworkCidr}
              onChange={(event) => update("clusterNetworkCidr", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <NumberInput
              label={t("openshift.hostPrefix", "Host prefix")}
              description={t("openshift.hostPrefixDesc", "Pod subnet size.")}
              required
              min={1}
              max={32}
              value={values.hostPrefix}
              error={errors.hostPrefix}
              onChange={(value) => update("hostPrefix", Number(value) || 0)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <TextInput
              label={t("openshift.serviceNetworkCidr", "Service network CIDR")}
              description={t("openshift.serviceNetworkCidrDesc", "Virtual address range used by Kubernetes Services.")}
              placeholder="172.30.0.0/16"
              required
              value={values.serviceNetworkCidr}
              error={errors.serviceNetworkCidr}
              onChange={(event) => update("serviceNetworkCidr", event.currentTarget.value)}
            />
          </Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      <OpenShiftFormSection
        icon={IconKey}
        title={t("openshift.redHatAccess", "Red Hat and node access")}
        description={t("openshift.redHatAccessDesc", "Credentials are encrypted into a short-lived, one-use bundle. They are not included in previews or stored in the generated inventory.")}
      >
        <Textarea
          className="openshift-secret-input"
          label={t("openshift.pullSecret", "Red Hat pull secret")}
          description={t("openshift.pullSecretDesc", "Paste the complete JSON pull secret downloaded from your Red Hat account.")}
          placeholder='{"auths":{"cloud.openshift.com":{"auth":"..."}}}'
          required
          minRows={4}
          autoComplete="off"
          spellCheck={false}
          value={values.pullSecret}
          error={errors.pullSecret}
          onChange={(event) => update("pullSecret", event.currentTarget.value)}
        />
        <Textarea
          label={t("openshift.sshPublicKey", "SSH public key")}
          description={t("openshift.sshPublicKeyDesc", "Public key installed on the RHCOS node for emergency access. Never paste a private key.")}
          placeholder="ssh-ed25519 AAAAC3... operator@workstation"
          required
          minRows={3}
          autoComplete="off"
          spellCheck={false}
          value={values.sshPublicKey}
          error={errors.sshPublicKey}
          onChange={(event) => update("sshPublicKey", event.currentTarget.value)}
        />
        <Textarea
          className="openshift-secret-input"
          label={t("openshift.trustBundle", "Additional certificate authority bundle")}
          description={t("openshift.trustBundleDesc", "Optional PEM certificates required to trust organization-managed HTTPS endpoints.")}
          placeholder="-----BEGIN CERTIFICATE-----"
          minRows={3}
          autoComplete="off"
          spellCheck={false}
          value={values.additionalTrustBundle}
          onChange={(event) => update("additionalTrustBundle", event.currentTarget.value)}
        />
      </OpenShiftFormSection>

      <Alert color="teal" title={t("openshift.serverManagedMirror", "Server-managed mirror")}>
        {t("openshift.serverManagedMirrorDesc", {
          mirror: values.mirrorRegistry,
          defaultValue: `Mirror registry: ${values.mirrorRegistry}. Release content, TLS configuration, and registry credentials are managed by the LinDeploy server and reused for every disconnected SNO installation.`,
        })}
      </Alert>
    </Stack>
  );
}
