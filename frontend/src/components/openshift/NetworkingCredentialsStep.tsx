import {
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  Grid,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronUp,
  IconKey,
  IconNetwork,
  IconRoute,
  IconSettings,
  IconWorld,
} from "@tabler/icons-react";
import { useState } from "react";
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
  const [advancedNetOpen, setAdvancedNetOpen] = useState(false);

  return (
    <Stack gap="lg">
      <Alert color="blue" title="Network profile">
        The current KVM adapter uses one IPv4 /24 machine network. Reserve one stable address for the SNO VM
        before installation. All other OpenShift internal networks use secure defaults.
      </Alert>

      <OpenShiftFormSection
        icon={IconNetwork}
        title="Node addressing"
        description="Define how the VM receives its persistent address. The same IP serves the API, ingress routes, and the node."
        badge={<Badge color="red" variant="light">IPv4 /24</Badge>}
      >
        <SegmentedControl
          fullWidth
          data={[
            { value: "dhcp_reservation", label: "DHCP reservation (recommended)" },
            { value: "static", label: "Static configuration" },
          ]}
          value={values.networkMode}
          onChange={(value) => update("networkMode", value as OpenShiftSNOFormValues["networkMode"])}
        />
        <Grid>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <TextInput
              label="Reserved machine IP"
              description="Persistent, unused IPv4 address assigned to the SNO VM."
              placeholder="192.168.130.10"
              required
              value={values.machineIp}
              error={errors.machineIp}
              onChange={(event) => update("machineIp", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <NumberInput
              label="Prefix length"
              description="Fixed /24 profile."
              required
              min={24}
              max={24}
              value={values.prefixLength}
              readOnly
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="Default gateway"
              description="Gateway reachable from the machine network."
              placeholder="192.168.130.1"
              required
              value={values.gateway}
              error={errors.gateway}
              onChange={(event) => update("gateway", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="DNS servers"
              description="One or more IPv4 addresses separated by commas or spaces."
              placeholder="192.168.130.1"
              required
              value={values.dnsServers}
              error={errors.dnsServers}
              onChange={(event) => update("dnsServers", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="Guest interface name"
              description="RHCOS network interface inside the VM. Use enp1s0 for the managed libvirt adapter."
              placeholder="enp1s0"
              required
              value={values.interfaceName}
              error={errors.interfaceName}
              onChange={(event) => update("interfaceName", event.currentTarget.value)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <TextInput
              label="VM MAC address"
              description="Stable libvirt MAC address. Leave empty to have LinDeploy assign one."
              value={values.macAddress}
              error={errors.macAddress}
              placeholder="52:54:00:01:00:0a (optional)"
              onChange={(event) => update("macAddress", event.currentTarget.value)}
            />
          </Grid.Col>
        </Grid>
      </OpenShiftFormSection>

      {/* OpenShift internal CIDRs — professional accordion */}
      <Box>
        <Button
          variant="subtle"
          size="sm"
          color="gray"
          leftSection={<IconSettings size={14} />}
          rightSection={advancedNetOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          onClick={() => setAdvancedNetOpen((v) => !v)}
        >
          {advancedNetOpen ? "Hide OpenShift internal networks" : "OpenShift internal networks (advanced)"}
        </Button>
        <Collapse expanded={advancedNetOpen}>
          <Box mt="md">
            <OpenShiftFormSection
              icon={IconRoute}
              title="OpenShift internal networks"
              description="These CIDRs define OpenShift's internal pod, service, and routing address spaces. They must not overlap each other or the machine network. The defaults work for most lab environments."
            >
              <Grid>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <TextInput
                    label="Machine network CIDR"
                    description="The /24 network containing the VM address and gateway."
                    placeholder="192.168.130.0/24"
                    required
                    value={values.machineNetworkCidr}
                    error={errors.machineNetworkCidr}
                    onChange={(event) => update("machineNetworkCidr", event.currentTarget.value)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6 }}>
                  <TextInput
                    label="Rendezvous IP"
                    description="For SNO, this is always the same as the machine IP."
                    placeholder="192.168.130.10"
                    required
                    value={values.rendezvousIp}
                    error={errors.rendezvousIp}
                    onChange={(event) => update("rendezvousIp", event.currentTarget.value)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 5 }}>
                  <TextInput
                    label="Pod network CIDR"
                    description="Address range used by OpenShift workloads."
                    placeholder="10.128.0.0/14"
                    required
                    value={values.clusterNetworkCidr}
                    error={errors.clusterNetworkCidr}
                    onChange={(event) => update("clusterNetworkCidr", event.currentTarget.value)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 2 }}>
                  <NumberInput
                    label="Host prefix"
                    description="Pod subnet size."
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
                    label="Service network CIDR"
                    description="Virtual address range used by Kubernetes Services."
                    placeholder="172.30.0.0/16"
                    required
                    value={values.serviceNetworkCidr}
                    error={errors.serviceNetworkCidr}
                    onChange={(event) => update("serviceNetworkCidr", event.currentTarget.value)}
                  />
                </Grid.Col>
              </Grid>
            </OpenShiftFormSection>
          </Box>
        </Collapse>
      </Box>

      <OpenShiftFormSection
        icon={IconWorld}
        title="DNS ownership"
        description="OpenShift requires API, internal API, wildcard application, and node records to resolve to the SNO address."
      >
        <SegmentedControl
          fullWidth
          data={[
            { value: "managed", label: "LinDeploy-managed DNS (recommended)" },
            { value: "external", label: "External DNS — managed by operator" },
          ]}
          value={values.dnsManagement}
          onChange={(value) => update("dnsManagement", value as OpenShiftSNOFormValues["dnsManagement"])}
        />
        <div className="openshift-dns-records">
          {dnsNames.map((name) => (
            <Group key={name} justify="space-between" gap="md" wrap="nowrap">
              <Text ff="monospace" size="sm">{name}</Text>
              <Text size="sm" c="dimmed">→ {values.machineIp || "machine IP"}</Text>
            </Group>
          ))}
        </div>
        {values.dnsManagement === "external" && (
          <Alert color="orange" title="External DNS required">
            Create and verify these DNS records before launch. Reverse DNS must also resolve the node address to its hostname.
          </Alert>
        )}
      </OpenShiftFormSection>

      <OpenShiftFormSection
        icon={IconKey}
        title="Red Hat and node access"
        description="Credentials are encrypted into a short-lived, one-use bundle. They are never stored in installation history."
      >
        <Textarea
          className="openshift-secret-input"
          label="Red Hat pull secret"
          description='Paste the complete JSON pull secret from your Red Hat account (console.redhat.com → Downloads → Pull secret).'
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
          label="SSH public key"
          description="Public key installed on the RHCOS node for emergency access. Never paste a private key here."
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
          label="Additional certificate authority bundle"
          description="Optional PEM certificates required to trust organization-managed HTTPS endpoints."
          placeholder="-----BEGIN CERTIFICATE-----"
          minRows={3}
          autoComplete="off"
          spellCheck={false}
          value={values.additionalTrustBundle}
          onChange={(event) => update("additionalTrustBundle", event.currentTarget.value)}
        />
      </OpenShiftFormSection>

      <Alert color="teal" title="Server-managed mirror">
        Mirror registry: <strong>{values.mirrorRegistry}</strong>. Release content, TLS configuration, and
        registry credentials are managed by the LinDeploy server and reused for every disconnected SNO
        installation. You do not need to re-mirror content between installations.
      </Alert>
    </Stack>
  );
}
