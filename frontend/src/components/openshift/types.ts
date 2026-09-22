export type OpenShiftNetworkMode = "static" | "dhcp_reservation";
export type OpenShiftBootMode = "uefi" | "bios";
export type OpenShiftDnsManagement = "managed" | "external";

export type OpenShiftHost = {
  id: number;
  name: string;
  hostname?: string;
  ip_address: string;
  ssh_port: number;
  enabled: boolean;
  os_type?: string;
  credential_username?: string | null;
};

export type OpenShiftTemplate = {
  id: number;
  name: string;
  system_type: "openshift_sno";
  playbook_path: string;
  description?: string;
  deployment_type: string;
};

export type OpenShiftSNOFormValues = {
  clusterName: string;
  baseDomain: string;
  openshiftVersion: string;
  architecture: "amd64" | "arm64";
  fips: boolean;
  description: string;
  provisioningHostId: number | null;
  vmName: string;
  libvirtNetwork: string;
  storagePool: string;
  vcpu: number;
  memoryGib: number;
  diskGib: number;
  vmAutostart: boolean;
  bootMode: OpenShiftBootMode;
  installationDisk: string;
  nodeName: string;
  networkMode: OpenShiftNetworkMode;
  machineIp: string;
  prefixLength: number;
  gateway: string;
  dnsServers: string;
  interfaceName: string;
  macAddress: string;
  machineNetworkCidr: string;
  rendezvousIp: string;
  clusterNetworkCidr: string;
  hostPrefix: number;
  serviceNetworkCidr: string;
  dnsManagement: OpenShiftDnsManagement;
  pullSecret: string;
  sshPublicKey: string;
  additionalTrustBundle: string;
  disconnected: boolean;
  mirrorRegistry: string;
  mirrorCaBundle: string;
  mirrorRepositoryConfig: string;
  mirrorStoragePath: string;
  mirrorRegistryArchivePath: string;
  mirrorRegistryArchiveUrl: string;
  mirrorRegistryArchiveChecksum: string;
  mirrorUsername: string;
  mirrorPassword: string;
  mirrorIncludeGraph: boolean;
  installConfirmation: string;
};

export type OpenShiftFieldErrors = Partial<Record<keyof OpenShiftSNOFormValues, string>>;

export type OpenShiftLaunchPayload = {
  deployment_mode: "manual";
  system_type: "openshift_sno";
  topology: "single_node";
  template_id: number;
  host_ids: number[];
  cluster_config: {
    cluster_name: string;
    base_domain: string;
    openshift_version: string;
    architecture: "amd64" | "arm64";
    fips: boolean;
    platform: "none";
    network_type: "OVNKubernetes";
    cluster_network_cidr: string;
    host_prefix: number;
    service_network_cidr: string;
    machine_network_cidr: string;
    rendezvous_ip: string;
    dns_servers: string[];
    dns_management: OpenShiftDnsManagement;
    disconnected: boolean;
    mirror_registry: string;
    mirror_ca_configured: boolean;
    mirror_storage_path: string;
    mirror_registry_archive_path: string;
    mirror_registry_archive_url: string;
    mirror_registry_archive_checksum: string;
    mirror_include_graph: boolean;
    description: string;
    vm_autostart: boolean;
    boot_mode: OpenShiftBootMode;
    secret_reference: string;
    target_modification_approved: true;
    install_confirmation: string;
    cleanup_mode?: string;
    preserve_iso?: boolean;
  };
  host_overrides: Array<{
    host_id: number;
    vm_name: string;
    node_name: string;
    node_ip: string;
    prefix_length: number;
    gateway: string;
    interface_name: string;
    mac_address: string;
    installation_disk: string;
    libvirt_network: string;
    storage_pool: string;
    vcpu: number;
    memory_gib: number;
    disk_gib: number;
    network_mode: OpenShiftNetworkMode;
  }>;
};

export type OpenShiftSecretBundlePayload = {
  pull_secret: string;
  ssh_public_key: string;
  additional_trust_bundle: string;
  mirror_ca_bundle: string;
  mirror_username: string;
  mirror_password: string;
};

export type OpenShiftReadinessItem = {
  label: string;
  detail: string;
  state: "passed" | "warning" | "blocking";
};
