import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Container,
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
  IconCpu,
  IconEdit,
  IconEye,
  IconPlus,
  IconRefresh,
  IconServer,
  IconTrash,
} from "@tabler/icons-react";

type Host = {
  id: number;
  name: string;
  hostname: string;
  ip_address: string;
  ssh_port: number;
  os_type: string;
  node_role: "standalone" | "control_plane" | "worker";
  baseline_state: "unknown" | "fresh" | "prepared" | "initialized";
  last_detection_at?: string | null;
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

const BASE_URL = import.meta.env.VITE_DJANGO_BASE_URL;

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
  const [hosts, setHosts] = useState<Host[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [formData, setFormData] = useState<HostFormData>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [editorOpened, setEditorOpened] = useState(false);
  const [detailsOpened, setDetailsOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [detectingId, setDetectingId] = useState<number | null>(null);
  const [error, setError] = useState("");
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

  useEffect(() => {
    async function fetchCredentials() {
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

    fetchCredentials();
  }, []);

  function handleChange<K extends keyof HostFormData>(field: K, value: HostFormData[K]) {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function openCreateModal() {
    setEditingId(null);
    setFormData(emptyForm);
    setEditorOpened(true);
  }

  function openEditModal(host: Host) {
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
    setEditorOpened(true);
  }

  function openDetailsModal(host: Host) {
    setSelectedHost(host);
    setDetailsOpened(true);
  }

  function resetEditor() {
    setEditingId(null);
    setFormData(emptyForm);
    setEditorOpened(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const url =
      editingId === null
        ? `${BASE_URL}/api/hosts/`
        : `${BASE_URL}/api/hosts/${editingId}/`;

    const method = editingId === null ? "POST" : "PUT";

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(JSON.stringify(data));
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
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this host from the inventory?")) {
      return;
    }

    setDeletingId(id);
    setError("");
    try {
      const response = await fetch(`${BASE_URL}/api/hosts/${id}/`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Delete failed");
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

      await fetchHosts();
    } catch {
      setError("Unable to delete host.");
    } finally {
      setDeletingId(null);
    }
  }

  function getBaselineColor(state: Host["baseline_state"]) {
    if (state === "prepared") {
      return "teal";
    }
    if (state === "initialized") {
      return "yellow";
    }
    if (state === "fresh") {
      return "blue";
    }
    return "gray";
  }

  async function handleDetectState(host: Host) {
    setDetectingId(host.id);
    setError("");

    try {
      const response = await fetch(`${BASE_URL}/api/hosts/${host.id}/detect/`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Host state detection failed.");
      }

      notifications.show({
        title: "Detection completed",
        message: `${host.name} detected as ${data.host?.baseline_state || "unknown"}.`,
        color: "teal",
      });

      await fetchHosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Host state detection failed.");
    } finally {
      setDetectingId(null);
    }
  }

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Card className="console-panel" padding="xl">
          <Group justify="space-between" align="flex-start" gap="lg">
            <Stack gap={6}>
              <Group gap="sm">
                <ThemeIcon color="red" variant="light" size="lg" radius="md">
                  <IconServer size={18} />
                </ThemeIcon>
                <div>
                  <Title order={2}>Hosts Registry</Title>
                  <Text c="dimmed" size="sm">
                    Register targets, inspect them, and edit connection properties from a compact operator view.
                  </Text>
                </div>
              </Group>

              <Group gap="sm">
                <Badge color="red" variant="light">
                  Total: {hosts.length}
                </Badge>
                <Badge color="teal" variant="light">
                  Enabled: {enabledHostsCount}
                </Badge>
                <Badge color="blue" variant="light">
                  Prepared: {hosts.filter((host) => host.baseline_state === "prepared").length}
                </Badge>
                <Badge color="gray" variant="outline">
                  Credentials: {credentials.length}
                </Badge>
              </Group>
            </Stack>

            <Group>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={fetchHosts}
                loading={loadingHosts}
              >
                Refresh
              </Button>
              <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
                Add Host
              </Button>
            </Group>
          </Group>
        </Card>

        {error && (
          <Alert color="red" title="Request failed" variant="light">
            {error}
          </Alert>
        )}

        <Card className="console-panel" padding="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <div>
                <Title order={3}>Inventory</Title>
                <Text c="dimmed" size="sm">
                  Click Info to inspect a host or Edit to change its properties in a modal window.
                </Text>
              </div>
              <Badge color="red" variant="dot">
                operator@auto-k8s:~$ ls hosts
              </Badge>
            </Group>

            <TextInput
              placeholder="Search by name, IP, hostname, role, or credential"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />

            {loadingHosts ? (
              <Text c="dimmed">Loading hosts...</Text>
            ) : filteredHosts.length === 0 ? (
              <Text c="dimmed">No hosts found.</Text>
            ) : (
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                {filteredHosts.map((host) => (
                  <Card key={host.id} className="host-panel" padding="lg">
                    <Stack gap="sm">
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

                      <Group gap="xs">
                        <Badge color={getBaselineColor(host.baseline_state)} variant="light">
                          {host.baseline_state}
                        </Badge>
                        {host.last_detection_at && (
                          <Text size="xs" c="dimmed">
                            detected {new Date(host.last_detection_at).toLocaleString()}
                          </Text>
                        )}
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

                      <Group grow>
                        <Button
                          variant="default"
                          leftSection={<IconCpu size={16} />}
                          onClick={() => void handleDetectState(host)}
                          loading={detectingId === host.id}
                        >
                          Detect
                        </Button>
                        <Button
                          variant="default"
                          leftSection={<IconEye size={16} />}
                          onClick={() => openDetailsModal(host)}
                        >
                          Info
                        </Button>
                        <Button
                          variant="light"
                          leftSection={<IconEdit size={16} />}
                          onClick={() => openEditModal(host)}
                        >
                          Edit
                        </Button>
                        <Button
                          color="red"
                          variant="filled"
                          leftSection={<IconTrash size={16} />}
                          onClick={() => handleDelete(host.id)}
                          loading={deletingId === host.id}
                        >
                          Delete
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
        title={editingId === null ? "Create Host" : "Edit Host"}
        centered
        size="lg"
        classNames={{ content: "terminal-modal", header: "terminal-modal-header" }}
      >
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <TextInput
              label="Name"
              placeholder="target3"
              value={formData.name}
              onChange={(event) => handleChange("name", event.currentTarget.value)}
              required
            />

            <TextInput
              label="Hostname"
              placeholder="target3.local"
              value={formData.hostname}
              onChange={(event) => handleChange("hostname", event.currentTarget.value)}
            />

            <TextInput
              label="IP Address"
              placeholder="192.168.100.135"
              value={formData.ip_address}
              onChange={(event) => handleChange("ip_address", event.currentTarget.value)}
              required
            />

            <NumberInput
              label="SSH Port"
              value={formData.ssh_port}
              onChange={(value) => handleChange("ssh_port", Number(value) || 22)}
              min={1}
              max={65535}
              required
            />

            <TextInput
              label="OS Type"
              placeholder="centos9"
              value={formData.os_type}
              onChange={(event) => handleChange("os_type", event.currentTarget.value)}
            />

            <Select
              label="Node Role"
              data={[
                { value: "standalone", label: "Standalone" },
                { value: "control_plane", label: "Control Plane" },
                { value: "worker", label: "Worker" },
              ]}
              value={formData.node_role}
              onChange={(value) =>
                handleChange(
                  "node_role",
                  (value as HostFormData["node_role"]) || "standalone"
                )
              }
              allowDeselect={false}
            />

            <Select
              label="Credential"
              placeholder={loadingCredentials ? "Loading credentials..." : "Select a credential"}
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
              label="Enabled"
              checked={formData.enabled}
              onChange={(event) => handleChange("enabled", event.currentTarget.checked)}
            />

            <Group justify="flex-end">
              <Button variant="default" onClick={resetEditor}>
                Cancel
              </Button>
              <Button type="submit" loading={loading} leftSection={<IconEdit size={16} />}>
                {editingId === null ? "Create Host" : "Save Changes"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={detailsOpened}
        onClose={() => setDetailsOpened(false)}
        title={selectedHost ? `Host Info: ${selectedHost.name}` : "Host Info"}
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
                  <Table.Td c="dimmed">Name</Table.Td>
                  <Table.Td>{selectedHost.name}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Hostname</Table.Td>
                  <Table.Td>{selectedHost.hostname || "-"}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">IP Address</Table.Td>
                  <Table.Td>{selectedHost.ip_address}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">SSH Port</Table.Td>
                  <Table.Td>{selectedHost.ssh_port}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">OS Type</Table.Td>
                  <Table.Td>{selectedHost.os_type || "-"}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Node Role</Table.Td>
                  <Table.Td>{selectedHost.node_role}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Credential</Table.Td>
                  <Table.Td>{selectedHost.credential_name || "-"}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Baseline State</Table.Td>
                  <Table.Td>
                    <Badge color={getBaselineColor(selectedHost.baseline_state)} variant="light">
                      {selectedHost.baseline_state}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Last Detection</Table.Td>
                  <Table.Td>
                    {selectedHost.last_detection_at
                      ? new Date(selectedHost.last_detection_at).toLocaleString()
                      : "-"}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Status</Table.Td>
                  <Table.Td>
                    <Badge color={selectedHost.enabled ? "teal" : "gray"} variant="light">
                      {selectedHost.enabled ? "enabled" : "disabled"}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>

            <Group justify="flex-end">
              <Button
                variant="default"
                leftSection={<IconCpu size={16} />}
                onClick={() => void handleDetectState(selectedHost)}
                loading={detectingId === selectedHost.id}
              >
                Detect State
              </Button>
              <Button
                variant="default"
                leftSection={<IconEdit size={16} />}
                onClick={() => {
                  setDetailsOpened(false);
                  openEditModal(selectedHost);
                }}
              >
                Edit
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Container>
  );
}
