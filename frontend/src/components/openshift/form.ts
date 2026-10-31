import type {
  OpenShiftFieldErrors,
  OpenShiftLaunchPayload,
  OpenShiftReadinessItem,
  OpenShiftSNOFormValues,
} from "./types";

export const defaultOpenShiftValues: OpenShiftSNOFormValues = {
  clusterName: "sno-01",
  baseDomain: "lab.test",
  openshiftVersion: "4.20.3",
  architecture: "amd64",
  fips: false,
  description: "",
  provisioningHostId: null,
  vmName: "sno-01",
  libvirtNetwork: "sno-workshop",
  storagePool: "sno-pool",
  vcpu: 8,
  memoryGib: 16,
  diskGib: 120,
  vmAutostart: false,
  bootMode: "uefi",
  installationDisk: "/dev/vda",
  nodeName: "sno-01-node",
  networkMode: "dhcp_reservation",
  machineIp: "192.168.130.10",
  prefixLength: 24,
  gateway: "192.168.130.1",
  dnsServers: "192.168.130.1",
  interfaceName: "enp1s0",
  macAddress: "",
  machineNetworkCidr: "192.168.130.0/24",
  rendezvousIp: "192.168.130.10",
  clusterNetworkCidr: "10.128.0.0/14",
  hostPrefix: 23,
  serviceNetworkCidr: "172.30.0.0/16",
  dnsManagement: "managed",
  pullSecret: "",
  sshPublicKey: "",
  additionalTrustBundle: "",
  disconnected: true,
  mirrorRegistry: "registry.lab.test:8443",
  mirrorCaBundle: "",
  mirrorRepositoryConfig: "",
  mirrorStoragePath: "/home/lindeploy/openshift-mirror",
  mirrorRegistryArchivePath: "",
  mirrorRegistryArchiveUrl: "",
  mirrorRegistryArchiveChecksum: "",
  mirrorUsername: "init",
  mirrorPassword: "",
  mirrorIncludeGraph: true,
  installConfirmation: "",
};

const rfc1123 = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
const domain = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const mac = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;
const sshKey = /^(ssh-(?:rsa|ed25519)|ecdsa-sha2-nistp(?:256|384|521)|sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)\s+/;

type ParsedNetwork = { family: 4 | 6; network: bigint; last: bigint };

function parseIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((result, part) => (result << 8n) + BigInt(part), 0n);
}

function parseIpv6(value: string) {
  if (!value.includes(":")) return null;
  const halves = value.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) + BigInt(`0x${group}`), 0n);
}

function parseIp(value: string) {
  const ipv4 = parseIpv4(value.trim());
  if (ipv4 !== null) return { family: 4 as const, value: ipv4, bits: 32 };
  const ipv6 = parseIpv6(value.trim());
  if (ipv6 !== null) return { family: 6 as const, value: ipv6, bits: 128 };
  return null;
}

function parseNetwork(value: string): ParsedNetwork | null {
  const [address, prefixText, ...rest] = value.trim().split("/");
  const ip = parseIp(address);
  const prefix = Number(prefixText);
  if (rest.length || !ip || !Number.isInteger(prefix) || prefix < 0 || prefix > ip.bits) return null;
  const hostBits = BigInt(ip.bits - prefix);
  const hostMask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
  const network = ip.value & ~hostMask;
  return { family: ip.family, network, last: network + hostMask };
}

function isUsableHostAddress(ipText: string, cidr: string) {
  const ip = parseIp(ipText);
  const network = parseNetwork(cidr);
  if (!ip || !network || ip.family !== network.family) return false;
  if (ip.family === 4) return ip.value > network.network && ip.value < network.last;
  return ip.value >= network.network && ip.value <= network.last;
}

function overlaps(left: string, right: string) {
  const a = parseNetwork(left);
  const b = parseNetwork(right);
  return Boolean(a && b && a.family === b.family && a.network <= b.last && b.network <= a.last);
}

export function dnsServers(values: OpenShiftSNOFormValues) {
  return values.dnsServers.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

export function derivedDnsNames(values: OpenShiftSNOFormValues) {
  const suffix = `${values.clusterName}.${values.baseDomain}`;
  return [`api.${suffix}`, `api-int.${suffix}`, `*.apps.${suffix}`];
}

export function validateOpenShiftForm(values: OpenShiftSNOFormValues): OpenShiftFieldErrors {
  const errors: OpenShiftFieldErrors = {};
  if (!rfc1123.test(values.clusterName) || values.clusterName.length > 54) errors.clusterName = "Use a lowercase RFC-1123 name (maximum 54 characters).";
  if (!domain.test(values.baseDomain)) errors.baseDomain = "Enter a valid lowercase DNS base domain.";
  if (values.openshiftVersion !== "4.20.3") errors.openshiftVersion = "The managed disconnected mirror provides OpenShift 4.20.3 only.";
  if (values.provisioningHostId === null) errors.provisioningHostId = "Select exactly one enabled provisioning host.";
  if (!rfc1123.test(values.vmName)) errors.vmName = "Use a lowercase RFC-1123 VM name.";
  if (!rfc1123.test(values.nodeName)) errors.nodeName = "Use a lowercase RFC-1123 node name.";
  if (!values.libvirtNetwork.trim()) errors.libvirtNetwork = "Enter a libvirt network or bridge.";
  if (!values.storagePool.trim()) errors.storagePool = "Enter a libvirt storage pool.";
  if (values.vcpu < 8) errors.vcpu = "SNO requires at least 8 vCPU.";
  if (values.memoryGib < 16) errors.memoryGib = "SNO requires at least 16 GiB RAM.";
  if (values.diskGib < 120) errors.diskGib = "SNO requires at least 120 GiB storage.";
  if (!/^\/dev\/[a-zA-Z0-9._/-]+$/.test(values.installationDisk)) errors.installationDisk = "Enter an explicit /dev path.";
  if (!parseIp(values.machineIp)) errors.machineIp = "Enter a valid IPv4 or IPv6 address.";
  const machineIp = parseIp(values.machineIp);
  if (!Number.isInteger(values.prefixLength) || values.prefixLength < 0 || values.prefixLength > (machineIp?.bits ?? 128)) errors.prefixLength = "Enter a valid prefix length for the machine IP.";
  if (!parseNetwork(values.machineNetworkCidr)) errors.machineNetworkCidr = "Enter a valid machine network CIDR.";
  if (parseIp(values.machineIp) && parseNetwork(values.machineNetworkCidr) && !isUsableHostAddress(values.machineIp, values.machineNetworkCidr)) errors.machineIp = "Machine IP must be a usable host address, not the network or broadcast address.";
  if (!parseIp(values.rendezvousIp) || !isUsableHostAddress(values.rendezvousIp, values.machineNetworkCidr)) errors.rendezvousIp = "Rendezvous IP must be a usable host address in the machine network.";
  if (!parseIp(values.gateway) || !isUsableHostAddress(values.gateway, values.machineNetworkCidr)) errors.gateway = "Gateway must be a usable host address in the machine network.";
  const servers = dnsServers(values);
  if (!servers.length || servers.some((server) => !parseIp(server))) errors.dnsServers = "Enter at least one valid DNS server.";
  if (!values.interfaceName.trim()) errors.interfaceName = "Enter the host network interface.";
  if (values.macAddress && !mac.test(values.macAddress)) errors.macAddress = "Enter a valid MAC address or leave it empty.";
  if (!parseNetwork(values.clusterNetworkCidr)) errors.clusterNetworkCidr = "Enter a valid cluster network CIDR.";
  if (!parseNetwork(values.serviceNetworkCidr)) errors.serviceNetworkCidr = "Enter a valid service network CIDR.";
  if (parseNetwork(values.machineNetworkCidr) && parseNetwork(values.clusterNetworkCidr) && overlaps(values.machineNetworkCidr, values.clusterNetworkCidr)) errors.clusterNetworkCidr = "Cluster and machine networks must not overlap.";
  if (parseNetwork(values.machineNetworkCidr) && parseNetwork(values.serviceNetworkCidr) && overlaps(values.machineNetworkCidr, values.serviceNetworkCidr)) errors.serviceNetworkCidr = "Service and machine networks must not overlap.";
  if (parseNetwork(values.clusterNetworkCidr) && parseNetwork(values.serviceNetworkCidr) && overlaps(values.clusterNetworkCidr, values.serviceNetworkCidr)) errors.serviceNetworkCidr = "Service and cluster networks must not overlap.";
  if (values.hostPrefix < 1 || values.hostPrefix > 32) errors.hostPrefix = "Host prefix must be between 1 and 32.";
  try {
    const pullSecret = JSON.parse(values.pullSecret) as { auths?: unknown };
    if (!pullSecret || typeof pullSecret !== "object" || !pullSecret.auths || typeof pullSecret.auths !== "object") errors.pullSecret = "Pull secret JSON must contain an auths object.";
  } catch { errors.pullSecret = "Enter a valid Red Hat pull secret JSON document."; }
  if (!sshKey.test(values.sshPublicKey.trim())) errors.sshPublicKey = "Enter a supported SSH public key; never enter a private key.";
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(values.mirrorRegistry)) errors.mirrorRegistry = "The managed mirror registry identity is invalid.";
  if (values.installConfirmation !== `ERASE ${values.installationDisk}`) errors.installConfirmation = `Enter exactly ERASE ${values.installationDisk}.`;
  return errors;
}

export function canLaunchOpenShift(errors: OpenShiftFieldErrors, hostAvailable: boolean, templateAvailable: boolean, submitting = false) {
  return templateAvailable && hostAvailable && Object.keys(errors).length === 0 && !submitting;
}

export function buildOpenShiftPayload(values: OpenShiftSNOFormValues, templateId: number, secretReference: string): OpenShiftLaunchPayload {
  if (values.provisioningHostId === null) throw new Error("Provisioning host is required.");
  return {
    deployment_mode: "manual", system_type: "openshift_sno", topology: "single_node", template_id: templateId, host_ids: [values.provisioningHostId],
    cluster_config: {
      cluster_name: values.clusterName, base_domain: values.baseDomain, openshift_version: values.openshiftVersion,
      architecture: values.architecture, fips: values.fips, platform: "none", network_type: "OVNKubernetes",
      cluster_network_cidr: values.clusterNetworkCidr, host_prefix: values.hostPrefix,
      service_network_cidr: values.serviceNetworkCidr, machine_network_cidr: values.machineNetworkCidr,
      rendezvous_ip: values.rendezvousIp, dns_servers: dnsServers(values), dns_management: values.dnsManagement,
      disconnected: values.disconnected, mirror_registry: values.disconnected ? values.mirrorRegistry : "",
      mirror_ca_configured: values.disconnected && values.mirrorCaBundle.includes("BEGIN CERTIFICATE"),
      mirror_storage_path: values.mirrorStoragePath,
      mirror_registry_archive_path: values.mirrorRegistryArchivePath,
      mirror_registry_archive_url: values.mirrorRegistryArchiveUrl,
      mirror_registry_archive_checksum: values.mirrorRegistryArchiveChecksum,
      mirror_include_graph: values.mirrorIncludeGraph,
      description: values.description, vm_autostart: values.vmAutostart, boot_mode: values.bootMode,
      secret_reference: secretReference, target_modification_approved: true,
      install_confirmation: values.installConfirmation,
    },
    host_overrides: [{
      host_id: values.provisioningHostId, vm_name: values.vmName, node_name: values.nodeName,
      node_ip: values.machineIp, prefix_length: values.prefixLength, gateway: values.gateway,
      interface_name: values.interfaceName, mac_address: values.macAddress,
      installation_disk: values.installationDisk, libvirt_network: values.libvirtNetwork,
      storage_pool: values.storagePool, vcpu: values.vcpu, memory_gib: values.memoryGib, disk_gib: values.diskGib,
      network_mode: values.networkMode,
    }],
  };
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, /(pull.?secret|password|token|auth|secret|private.?key|trust.?bundle|ca.?bundle)/i.test(key) ? "<redacted>" : redactSecrets(item)]));
}

export function buildYamlPreviews(values: OpenShiftSNOFormValues) {
  const ipFamily = values.machineIp.includes(":") ? "ipv6" : "ipv4";
  return {
    installConfig: `apiVersion: v1\nbaseDomain: ${values.baseDomain}\nmetadata:\n  name: ${values.clusterName}\ncompute:\n  - name: worker\n    replicas: 0\ncontrolPlane:\n  name: master\n  replicas: 1\nplatform:\n  none: {}\nnetworking:\n  networkType: OVNKubernetes\n  machineNetwork:\n    - cidr: ${values.machineNetworkCidr}\n  clusterNetwork:\n    - cidr: ${values.clusterNetworkCidr}\n      hostPrefix: ${values.hostPrefix}\n  serviceNetwork:\n    - ${values.serviceNetworkCidr}\npullSecret: '<redacted>'\nsshKey: '<redacted>'\nfips: ${values.fips}`,
    agentConfig: `apiVersion: v1alpha1\nkind: AgentConfig\nmetadata:\n  name: ${values.clusterName}\nrendezvousIP: ${values.rendezvousIp}\nhosts:\n  - hostname: ${values.nodeName}\n    role: master\n    interfaces:\n      - name: ${values.interfaceName}\n        macAddress: ${values.macAddress || "<assigned-by-libvirt>"}\n    networkConfig:\n      interfaces:\n        - name: ${values.interfaceName}\n          type: ethernet\n          state: up\n          ${ipFamily}:\n            enabled: true\n            address:\n              - ip: ${values.machineIp}\n                prefix-length: ${values.prefixLength}`,
  };
}

export function buildReadiness(values: OpenShiftSNOFormValues, errors: OpenShiftFieldErrors, hostAvailable: boolean, templateAvailable: boolean): OpenShiftReadinessItem[] {
  return [
    { label: "Configuration", detail: Object.keys(errors).length ? `${Object.keys(errors).length} blocking field(s) remain.` : "All form validation checks passed.", state: Object.keys(errors).length ? "blocking" : "passed" },
    { label: "Provisioning host", detail: hostAvailable ? "Exactly one enabled KVM/libvirt host is selected." : "Select an enabled LinDeploy host.", state: hostAvailable ? "passed" : "blocking" },
    { label: "Credentials", detail: "Pull secret and SSH public key are encrypted into a short-lived, one-use backend bundle and never enter installation history.", state: values.pullSecret && values.sshPublicKey ? "passed" : "blocking" },
    { label: "Disk erasure", detail: errors.installConfirmation ? `Type ERASE ${values.installationDisk} to approve the selected blank VM disk.` : `Explicit approval matches ${values.installationDisk}.`, state: errors.installConfirmation ? "blocking" : "passed" },
    { label: "DNS ownership", detail: values.dnsManagement === "managed" ? "LinDeploy creates the isolated libvirt DNS zone, DHCP reservation, API records and wildcard apps record." : "LinDeploy validates the supplied external DNS server before boot; its required records must already exist.", state: values.dnsManagement === "managed" ? "passed" : "warning" },
    { label: "Automation template", detail: templateAvailable ? "An OpenShift SNO template is registered." : "OpenShift automation is not registered on this controller yet.", state: templateAvailable ? "passed" : "blocking" },
    { label: "Connectivity mode", detail: values.disconnected ? "Agent-Based Installer will use the exact release synchronized to the local Quay registry." : "Connected installation uses the hosted Red Hat Assisted Installer API.", state: "passed" },
    { label: "Mirror content", detail: values.disconnected ? "Run Prepare mirror content first. Installation independently verifies the exact release marker, TLS endpoint, and registry authentication." : "A local release mirror is not required in connected mode.", state: values.disconnected ? "warning" : "passed" },
  ];
}
