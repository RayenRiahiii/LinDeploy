import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconEdit,
  IconEye,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconServer,
  IconTrash,
} from "@tabler/icons-react";
import PageHeader from "../common/PageHeader";
import ConfirmDeleteModal from "../crud/ConfirmDeleteModal";
import { formatApiError, parseApiPayload } from "../../lib/api";
import { useTranslation } from "react-i18next";

type Host = {
  id: number;
  name: string;
  hostname: string;
  ip_address: string;
  ssh_port: number;
  os_type: string;
  node_role: "standalone" | "control_plane" | "worker";
  baseline_facts?: Record<string, boolean>;
  enabled: boolean;
  credential: number | null;
  credential_name?: string;
};

type HostFormData = {
  name: string;
  hostname: string;
  ip_address: string;
  ssh_port: number;
  os_type: string;
  node_role: "standalone" | "control_plane" | "worker";
  enabled: boolean;
  credential: number | null;
};

type Credential = {
  id: number;
  name: string;
  auth_type: string;
  username: string;
};

const BASE_URL = (import.meta.env.VITE_DJANGO_BASE_URL || "").replace(/\/+$/, "");
const CUSTOM_OS_TYPE_VALUE = "__custom__";
const OS_TYPE_OPTIONS = [
  { value: "ubuntu24.04", label: "Ubuntu 24.04" },
  { value: "ubuntu22.04", label: "Ubuntu 22.04" },
  { value: "debian12", label: "Debian 12" },
  { value: "debian11", label: "Debian 11" },
  { value: "rocky9", label: "Rocky Linux 9" },
  { value: "rocky8", label: "Rocky Linux 8" },
  { value: "centos9", label: "CentOS Stream 9" },
  { value: "rhel9", label: "RHEL 9" },
  { value: "rhel8", label: "RHEL 8" },
  { value: "fedora", label: "Fedora" },
  { value: "opensuse-leap", label: "openSUSE Leap" },
  { value: "sles15", label: "SLES 15" },
];

const hostApiErrorOptions = {
  fieldLabels: {
    name: "Host name",
    hostname: "Hostname",
    ip_address: "IP address",
    ssh_port: "SSH port",
    os_type: "OS type",
    credential: "Credential",
    enabled: "Enabled state",
  },
  conflictMessages: {
    ip_address: "This IP address is already assigned to another host.",
    name: "This host name is already used by another host.",
  },
};

function isPredefinedOsType(value: string) {
  return OS_TYPE_OPTIONS.some((option) => option.value === value);
}

function getCustomOsTypeValidationError(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  if (trimmedValue.length > 50) {
    return "Use 50 characters or fewer.";
  }

  if (!/^[a-zA-Z0-9._ -]+$/.test(trimmedValue)) {
    return "Use only letters, digits, spaces, dots, underscores, or hyphens.";
  }

  return null;
}

const emptyForm: HostFormData = {
  name: "",
  hostname: "",
  ip_address: "",
  ssh_port: 22,
  os_type: "",
  node_role: "standalone",
  enabled: true,
  credential: null,
};

export default function HostsList() {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [formData, setFormData] = useState<HostFormData>(emptyForm);
  const [customOsType, setCustomOsType] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [hostPendingDelete, setHostPendingDelete] = useState<Host | null>(null);
  const [editorOpened, setEditorOpened] = useState(false);
  const [detailsOpened, setDetailsOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [search, setSearch] = useState("");

  const enabledHostsCount = useMemo(
    () => hosts.filter((host) => host.enabled).length,
    [hosts]
  );

  const filteredHosts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return hosts;
    }

    return hosts.filter((host) =>
      [host.name, host.hostname, host.ip_address, host.credential_name, host.node_role]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [hosts, search]);

  async function fetchHosts() {
    setLoadingHosts(true);
    setError("");
    try {
      const response = await fetch(`${BASE_URL}/api/hosts/`);
      if (!response.ok) {
        throw new Error("Failed to fetch hosts");
      }
      const data = await response.json();
      setHosts(data);
    } catch {
      setError("Unable to load hosts from backend.");
    } finally {
      setLoadingHosts(false);
    }
  }

  useEffect(() => {
    fetchHosts();
  }, []);

  async function fetchCredentials() {
    if (credentials.length > 0) return;
    setLoadingCredentials(true);
    try {
      const response = await fetch(`${BASE_URL}/api/credentials/`);
      if (!response.ok) {
        throw new Error("Failed to fetch credentials");
      }
      const data = await response.json();
      setCredentials(data);
    } catch {
      setError("Unable to load credentials from backend.");
    } finally {
      setLoadingCredentials(false);
    }
  }

  function handleChange<K extends keyof HostFormData>(field: K, value: HostFormData[K]) {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function openCreateModal() {
    void fetchCredentials();
    setEditingId(null);
    setFormData(emptyForm);
    setCustomOsType("");
    setEditorError("");
    setEditorOpened(true);
  }

  function openEditModal(host: Host) {
    void fetchCredentials();
    setEditingId(host.id);
    setFormData({
      name: host.name,
      hostname: host.hostname,
      ip_address: host.ip_address,
      ssh_port: host.ssh_port,
      os_type: host.os_type,
      node_role: host.node_role,
      enabled: host.enabled,
      credential: host.credential,
    });
    setCustomOsType(isPredefinedOsType(host.os_type) ? "" : host.os_type);
    setEditorError("");
    setEditorOpened(true);
  }

  function openDetailsModal(host: Host) {
    setSelectedHost(host);
    setDetailsOpened(true);
  }

  function resetEditor() {
    setEditingId(null);
    setFormData(emptyForm);
    setCustomOsType("");
    setEditorError("");
    setEditorOpened(false);
  }

  function openDeleteModal(host: Host) {
    setDeleteError("");
    setHostPendingDelete(host);
  }

  function closeDeleteModal() {
    if (deletingId !== null) {
      return;
    }
    setDeleteError("");
    setHostPendingDelete(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setEditorError("");

    const customOsTypeError =
      formData.os_type && !isPredefinedOsType(formData.os_type)
        ? getCustomOsTypeValidationError(formData.os_type)
        : null;

    if (customOsTypeError) {
      setEditorError(`OS type: ${customOsTypeError}`);
      return;
    }

    setLoading(true);

    const url =
      editingId === null
        ? `${BASE_URL}/api/hosts/`
        : `${BASE_URL}/api/hosts/${editingId}/`;

    const method = editingId === null ? "POST" : "PATCH";

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await parseApiPayload(response);

      if (!response.ok) {
        throw new Error(formatApiError(data, "Unable to save host.", hostApiErrorOptions));
      }

      notifications.show({
        title: editingId === null ? "Host created" : "Host updated",
        message:
          editingId === null
            ? "The host was added successfully."
            : "The host was updated successfully.",
        color: "teal",
      });

      resetEditor();
      await fetchHosts();
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "Unable to save host.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!hostPendingDelete) {
      return;
    }

    const id = hostPendingDelete.id;

    setDeletingId(id);
    setError("");
    setDeleteError("");
    try {
      const response = await fetch(`${BASE_URL}/api/hosts/${id}/`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await parseApiPayload(response);
        throw new Error(formatApiError(payload, "Unable to delete host.", hostApiErrorOptions));
      }

      notifications.show({
        title: "Host deleted",
        message: "The host was removed successfully.",
        color: "red",
      });

      if (selectedHost?.id === id) {
        setDetailsOpened(false);
        setSelectedHost(null);
      }

      if (editingId === id) {
        resetEditor();
      }

      setHostPendingDelete(null);
      await fetchHosts();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unable to delete host.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Stack gap="lg">
        <PageHeader
          icon={<IconServer size={22} />}
          badge={t("sections.hosts.badge", "Infrastructure Inventory")}
          badgeColor="red"
          title={t("hosts.title", "Hosts Registry")}
          description={t("hosts.description", "Register targets, inspect connection health, and manage machine properties from a centralized operator view.")}
          badges={
            <>
              <Badge color="red" variant="light" size="sm">
                {t("hosts.total", "Total")}: {hosts.length}
              </Badge>
              <Badge color="teal" variant="light" size="sm">
                {t("hosts.enabled", "Enabled")}: {enabledHostsCount}
              </Badge>
              <Badge color="grape" variant="light" size="sm">
                {t("hosts.roles", "Roles")}: {new Set(hosts.map((host) => host.node_role)).size}
              </Badge>
              <Badge color="gray" variant="outline" size="sm">
                {t("hosts.credentials", "Credentials")}: {credentials.length}
              </Badge>
            </>
          }
          actions={
            <>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={fetchHosts}
                loading={loadingHosts}
              >
                {t("common.refresh", "Refresh")}
              </Button>
              <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
                {t("hosts.addHost", "Add Host")}
              </Button>
            </>
          }
        />

        {error && (
          <Alert color="red" title={t("common.error", "Request failed")} variant="light">
            {error}
          </Alert>
        )}

        <Card className="console-panel" padding="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <div>
                <Title order={3}>{t("hosts.inventoryTitle", "Inventory")}</Title>
                <Text c="dimmed" size="sm">
                  {t("hosts.inventorySubtitle", "Click Info to inspect a host or Edit to change its properties in a modal window.")}
                </Text>
              </div>
              <Badge color="red" variant="dot">
                operator@lindeploy:~$ ls hosts
              </Badge>
            </Group>

            <TextInput
              leftSection={<IconSearch size={16} />}
              placeholder={t("hosts.searchPlaceholder", "Search by name, IP, hostname, role, or credential")}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />

            {loadingHosts ? (
              <Text c="dimmed">{t("hosts.loadingHosts", "Loading hosts...")}</Text>
            ) : hosts.length === 0 ? (
              <Card
                withBorder
                padding="xl"
                radius="md"
                style={{
                  textAlign: "center",
                  background: "var(--soft-bg, rgba(255,255,255,0.02))",
                }}
              >
                <Stack align="center" gap="sm">
                  <ThemeIcon size={52} radius="xl" color="red" variant="light">
                    <IconServer size={28} />
                  </ThemeIcon>
                  <Text fw={600} size="lg">
                    {t("hosts.noHostsAvailable", "No hosts available")}
                  </Text>
                  <Text size="sm" c="dimmed" style={{ maxWidth: 440 }}>
                    {t(
                      "hosts.emptyDesc",
                      "Your inventory has no registered machines. Add your first target host to begin deploying clusters."
                    )}
                  </Text>
                  <Button
                    leftSection={<IconPlus size={16} />}
                    color="red"
                    onClick={openCreateModal}
                    mt="xs"
                  >
                    {t("hosts.addHost", "Add Host")}
                  </Button>
                </Stack>
              </Card>
            ) : filteredHosts.length === 0 ? (
              <Text c="dimmed">{t("hosts.noHostsFound", "No hosts found.")}</Text>
            ) : (
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                {filteredHosts.map((host) => (
                  <Card key={host.id} className="host-panel card-grid-item" padding="lg">
                    <Stack gap="sm" style={{ height: "100%" }}>
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Text fw={700} size="lg">
                            {host.name}
                          </Text>
                          <Text size="sm" c="dimmed">
                            {host.hostname || "hostname not set"}
                          </Text>
                        </div>

                        <Badge color={host.enabled ? "teal" : "gray"} variant="light">
                          {host.enabled ? "enabled" : "disabled"}
                        </Badge>
                      </Group>
                      <Box className="terminal-code">
                        <Text className="terminal-line">$ ssh -p {host.ssh_port} {host.ip_address}</Text>
                        <Text className="terminal-line">
                          user: {host.credential_name || "no credential linked"}
                        </Text>
                      </Box>

                      <Table withColumnBorders={false} horizontalSpacing="sm" verticalSpacing="xs">
                        <Table.Tbody>
                          <Table.Tr>
                            <Table.Td c="dimmed">IP</Table.Td>
                            <Table.Td>{host.ip_address}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">Port</Table.Td>
                            <Table.Td>{host.ssh_port}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">OS</Table.Td>
                            <Table.Td>{host.os_type || "-"}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">Role</Table.Td>
                            <Table.Td>{host.node_role}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">Credential</Table.Td>
                            <Table.Td>{host.credential_name || "-"}</Table.Td>
                          </Table.Tr>
                        </Table.Tbody>
                      </Table>

                      <Group grow mt="auto">
                        <Button
                          variant="default"
                          leftSection={<IconEye size={16} />}
                          onClick={() => openDetailsModal(host)}
                        >
                          {t("common.info", "Info")}
                        </Button>
                        <Button
                          variant="light"
                          leftSection={<IconEdit size={16} />}
                          onClick={() => openEditModal(host)}
                        >
                          {t("common.edit", "Edit")}
                        </Button>
                        <Button
                          color="red"
                          variant="filled"
                          leftSection={<IconTrash size={16} />}
                          onClick={() => openDeleteModal(host)}
                          loading={deletingId === host.id}
                        >
                          {t("common.delete", "Delete")}
                        </Button>
                      </Group>
                    </Stack>
                  </Card>
                ))}
              </SimpleGrid>
            )}
          </Stack>
        </Card>
      </Stack>

      <Modal
        opened={editorOpened}
        onClose={resetEditor}
        title={editingId === null ? t("hosts.addHost", "Add Host") : t("hosts.editHost", "Edit Host")}
        centered
        size="lg"
        classNames={{ content: "terminal-modal", header: "terminal-modal-header" }}
      >
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {editorError && (
              <Alert color="red" title="Unable to save host" variant="light">
                {editorError}
              </Alert>
            )}

            <TextInput
              label={t("common.name", "Name")}
              description="Inventory label used inside the app and generated Ansible inventory."
              placeholder="node-01"
              value={formData.name}
              onChange={(event) => handleChange("name", event.currentTarget.value)}
              required
            />

            <TextInput
              label={t("hosts.hostname", "Hostname")}
              description="Optional DNS name or FQDN of the machine."
              placeholder="node-01.example.local"
              value={formData.hostname}
              onChange={(event) => handleChange("hostname", event.currentTarget.value)}
            />

            <TextInput
              label={t("hosts.ipAddress", "IP Address")}
              description="Reachable management IP used by SSH and Ansible."
              placeholder="192.168.100.135"
              value={formData.ip_address}
              onChange={(event) => handleChange("ip_address", event.currentTarget.value)}
              required
            />

            <NumberInput
              label={t("hosts.sshPort", "SSH Port")}
              description="Default is 22 unless the target exposes SSH on a custom port."
              placeholder="22"
              value={formData.ssh_port}
              onChange={(value) => handleChange("ssh_port", Number(value) || 22)}
              min={1}
              max={65535}
              required
            />

            <Select
              label={t("hosts.osType", "OS Type")}
              description="Used to identify the target distribution during execution."
              placeholder="Select target operating system"
              data={[
                ...OS_TYPE_OPTIONS,
                { value: CUSTOM_OS_TYPE_VALUE, label: "Other (enter manually)" },
              ]}
              value={
                formData.os_type
                  ? isPredefinedOsType(formData.os_type)
                    ? formData.os_type
                    : CUSTOM_OS_TYPE_VALUE
                  : null
              }
              onChange={(value) => {
                if (value === CUSTOM_OS_TYPE_VALUE) {
                  const currentCustomValue = isPredefinedOsType(formData.os_type)
                    ? ""
                    : formData.os_type;
                  setCustomOsType(currentCustomValue);
                  handleChange("os_type", currentCustomValue);
                  return;
                }

                setCustomOsType("");
                handleChange("os_type", value || "");
              }}
              clearable
            />

            {(formData.os_type === "" || !isPredefinedOsType(formData.os_type)) && (
              <TextInput
                label={t("hosts.customOsType", "Custom OS Type")}
                description="Only use this when the distribution is not listed above. The backend will normalize the value automatically."
                placeholder="alma9, oraclelinux9, ubuntu25.04"
                value={customOsType}
                error={getCustomOsTypeValidationError(customOsType)}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setCustomOsType(value);
                  handleChange("os_type", value);
                }}
              />
            )}

            <Select
              label={t("hosts.credential", "Credential")}
              description="Choose the saved SSH credential that Ansible will use for this host."
              placeholder={loadingCredentials ? t("credentials.loadingCredentials", "Loading saved credentials...") : t("hosts.selectCredential", "Select saved SSH credential")}
              data={credentials.map((credential) => ({
                value: String(credential.id),
                label: `${credential.name} (${credential.username})`,
              }))}
              value={formData.credential !== null ? String(formData.credential) : null}
              onChange={(value) => handleChange("credential", value ? Number(value) : null)}
              disabled={loadingCredentials}
              clearable
            />

            <Checkbox
              label={t("hosts.enabledLabel", "Enabled for inventory and execution")}
              checked={formData.enabled}
              onChange={(event) => handleChange("enabled", event.currentTarget.checked)}
            />

            <Group justify="flex-end">
              <Button variant="default" onClick={resetEditor}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button type="submit" loading={loading} leftSection={<IconEdit size={16} />}>
                {editingId === null ? t("hosts.addHost", "Create Host") : t("common.save", "Save Changes")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={detailsOpened}
        onClose={() => setDetailsOpened(false)}
        title={selectedHost ? `${t("hosts.hostDetails", "Host Details")}: ${selectedHost.name}` : t("hosts.hostDetails", "Host Details")}
        centered
        size="md"
        classNames={{ content: "terminal-modal", header: "terminal-modal-header" }}
      >
        {selectedHost && (
          <Stack gap="md">
            <Box className="terminal-code">
              <Text className="terminal-line">$ host inspect {selectedHost.name}</Text>
              <Text className="terminal-line">
                ansible_host={selectedHost.ip_address} ansible_port={selectedHost.ssh_port}
              </Text>
            </Box>

            <Divider />

            <Table>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("common.name", "Name")}</Table.Td>
                  <Table.Td>{selectedHost.name}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("hosts.hostname", "Hostname")}</Table.Td>
                  <Table.Td>{selectedHost.hostname || "-"}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("hosts.ipAddress", "IP Address")}</Table.Td>
                  <Table.Td>{selectedHost.ip_address}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("hosts.sshPort", "SSH Port")}</Table.Td>
                  <Table.Td>{selectedHost.ssh_port}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("hosts.osType", "OS Type")}</Table.Td>
                  <Table.Td>{selectedHost.os_type || "-"}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("hosts.nodeRole", "Node Role")}</Table.Td>
                  <Table.Td>{selectedHost.node_role}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("hosts.credential", "Credential")}</Table.Td>
                  <Table.Td>{selectedHost.credential_name || "-"}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("common.status", "Status")}</Table.Td>
                  <Table.Td>
                    <Badge color={selectedHost.enabled ? "teal" : "gray"} variant="light">
                      {selectedHost.enabled ? t("common.enabled", "enabled") : t("common.disabled", "disabled")}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>

            <Group justify="flex-end">
              <Button
                variant="default"
                leftSection={<IconEdit size={16} />}
                onClick={() => {
                  setDetailsOpened(false);
                  openEditModal(selectedHost);
                }}
              >
                {t("common.edit", "Edit")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <ConfirmDeleteModal
        opened={hostPendingDelete !== null}
        title={t("hosts.deleteConfirmTitle", "Delete Host")}
        itemName={hostPendingDelete?.name || "this host"}
        inventoryLabel={t("hosts.inventoryTitle", "hosts inventory")}
        description={t("hosts.deleteConfirmMessage", { name: hostPendingDelete?.name || "", defaultValue: `Are you sure you want to delete host '${hostPendingDelete?.name}'?` })}
        error={deleteError}
        errorTitle={t("common.error", "Unable to delete host")}
        loading={deletingId !== null}
        onClose={closeDeleteModal}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
