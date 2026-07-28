import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Modal,
  PasswordInput,
  Radio,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconEdit,
  IconEye,
  IconKey,
  IconLockPassword,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUserShield,
} from "@tabler/icons-react";

type Credential = {
  id: number;
  name: string;
  auth_type: "ssh_key" | "password";
  username: string;
  private_key: string;
  password: string;
  become_password: string;
  created_at?: string;
  updated_at?: string;
};

type CredentialFormData = {
  name: string;
  auth_type: "ssh_key" | "password";
  username: string;
  private_key: string;
  password: string;
  become_password: string;
};

const BASE_URL = import.meta.env.VITE_DJANGO_BASE_URL;

const emptyForm: CredentialFormData = {
  name: "",
  auth_type: "password",
  username: "",
  private_key: "",
  password: "",
  become_password: "",
};

function maskSecret(value: string) {
  if (!value) {
    return "-";
  }

  return "*".repeat(Math.min(10, Math.max(4, value.length)));
}

export default function CredentialsList() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [formData, setFormData] = useState<CredentialFormData>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null);
  const [editorOpened, setEditorOpened] = useState(false);
  const [detailsOpened, setDetailsOpened] = useState(false);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const passwordAuthCount = useMemo(
    () => credentials.filter((credential) => credential.auth_type === "password").length,
    [credentials]
  );

  const sshKeyAuthCount = useMemo(
    () => credentials.filter((credential) => credential.auth_type === "ssh_key").length,
    [credentials]
  );

  const filteredCredentials = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return credentials;
    }

    return credentials.filter((credential) =>
      [credential.name, credential.username, credential.auth_type]
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [credentials, search]);

  async function fetchCredentials() {
    setLoadingCredentials(true);
    setError("");
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

  useEffect(() => {
    fetchCredentials();
  }, []);

  function handleChange<K extends keyof CredentialFormData>(
    field: K,
    value: CredentialFormData[K]
  ) {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function resetEditor() {
    setEditingId(null);
    setFormData(emptyForm);
    setEditorOpened(false);
  }

  function openCreateModal() {
    setEditingId(null);
    setFormData(emptyForm);
    setEditorOpened(true);
  }

  function openEditModal(credential: Credential) {
    setEditingId(credential.id);
    setFormData({
      name: credential.name,
      auth_type: credential.auth_type,
      username: credential.username,
      private_key: credential.private_key || "",
      password: credential.password || "",
      become_password: credential.become_password || "",
    });
    setEditorOpened(true);
  }

  function openDetailsModal(credential: Credential) {
    setSelectedCredential(credential);
    setDetailsOpened(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const payload =
      formData.auth_type === "password"
        ? { ...formData, private_key: "" }
        : { ...formData, password: "" };

    const url =
      editingId === null
        ? `${BASE_URL}/api/credentials/`
        : `${BASE_URL}/api/credentials/${editingId}/`;

    const method = editingId === null ? "POST" : "PUT";

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(JSON.stringify(data));
      }

      notifications.show({
        title: editingId === null ? "Credential created" : "Credential updated",
        message:
          editingId === null
            ? "The credential was added successfully."
            : "The credential was updated successfully.",
        color: "teal",
      });

      resetEditor();
      await fetchCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save credential.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this credential?")) {
      return;
    }

    setDeletingId(id);
    setError("");
    try {
      const response = await fetch(`${BASE_URL}/api/credentials/${id}/`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Delete failed");
      }

      notifications.show({
        title: "Credential deleted",
        message: "The credential was removed successfully.",
        color: "red",
      });

      if (selectedCredential?.id === id) {
        setDetailsOpened(false);
        setSelectedCredential(null);
      }

      if (editingId === id) {
        resetEditor();
      }

      await fetchCredentials();
    } catch {
      setError("Unable to delete credential.");
    } finally {
      setDeletingId(null);
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
                  <IconUserShield size={18} />
                </ThemeIcon>
                <div>
                  <Title order={2}>Credentials Vault</Title>
                  <Text c="dimmed" size="sm">
                    Manage SSH usernames, password-based access, and key-based credentials used by your targets.
                  </Text>
                </div>
              </Group>

              <Group gap="sm">
                <Badge color="red" variant="light">
                  Total: {credentials.length}
                </Badge>
                <Badge color="teal" variant="light">
                  Password: {passwordAuthCount}
                </Badge>
                <Badge color="gray" variant="outline">
                  SSH Key: {sshKeyAuthCount}
                </Badge>
              </Group>
            </Stack>

            <Group>
              <Button
                variant="default"
                leftSection={<IconRefresh size={16} />}
                onClick={fetchCredentials}
                loading={loadingCredentials}
              >
                Refresh
              </Button>
              <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
                Add Credential
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
                <Title order={3}>Credential Entries</Title>
                <Text c="dimmed" size="sm">
                  Review the SSH identity used by hosts. Secrets stay masked in the list and are only editable in the modal.
                </Text>
              </div>
              <Badge color="red" variant="dot">
                operator@auto-k8s:~$ ls credentials
              </Badge>
            </Group>

            <TextInput
              placeholder="Search by credential name, username, or auth type"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />

            {loadingCredentials ? (
              <Text c="dimmed">Loading credentials...</Text>
            ) : filteredCredentials.length === 0 ? (
              <Text c="dimmed">No credentials found.</Text>
            ) : (
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                {filteredCredentials.map((credential) => (
                  <Card key={credential.id} className="host-panel" padding="lg">
                    <Stack gap="sm">
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Text fw={700} size="lg">
                            {credential.name}
                          </Text>
                          <Text size="sm" c="dimmed">
                            {credential.username}
                          </Text>
                        </div>

                        <Badge
                          color={credential.auth_type === "ssh_key" ? "teal" : "red"}
                          variant="light"
                        >
                          {credential.auth_type}
                        </Badge>
                      </Group>

                      <Box className="terminal-code">
                        <Text className="terminal-line">$ auth inspect {credential.name}</Text>
                        <Text className="terminal-line">
                          method: {credential.auth_type} | username: {credential.username}
                        </Text>
                      </Box>

                      <Table withColumnBorders={false} horizontalSpacing="sm" verticalSpacing="xs">
                        <Table.Tbody>
                          <Table.Tr>
                            <Table.Td c="dimmed">Auth Type</Table.Td>
                            <Table.Td>{credential.auth_type}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">Password</Table.Td>
                            <Table.Td>{maskSecret(credential.password)}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">Private Key</Table.Td>
                            <Table.Td>{credential.private_key ? "stored" : "-"}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">Become Password</Table.Td>
                            <Table.Td>{maskSecret(credential.become_password)}</Table.Td>
                          </Table.Tr>
                        </Table.Tbody>
                      </Table>

                      <Group grow>
                        <Button
                          variant="default"
                          leftSection={<IconEye size={16} />}
                          onClick={() => openDetailsModal(credential)}
                        >
                          Info
                        </Button>
                        <Button
                          variant="light"
                          leftSection={<IconEdit size={16} />}
                          onClick={() => openEditModal(credential)}
                        >
                          Edit
                        </Button>
                        <Button
                          color="red"
                          variant="filled"
                          leftSection={<IconTrash size={16} />}
                          onClick={() => handleDelete(credential.id)}
                          loading={deletingId === credential.id}
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
        title={editingId === null ? "Create Credential" : "Edit Credential"}
        centered
        size="lg"
        classNames={{ content: "terminal-modal", header: "terminal-modal-header" }}
      >
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <TextInput
              label="Credential Name"
              placeholder="target5-password"
              value={formData.name}
              onChange={(event) => handleChange("name", event.currentTarget.value)}
              required
            />

            <TextInput
              label="Username"
              placeholder="user"
              value={formData.username}
              onChange={(event) => handleChange("username", event.currentTarget.value)}
              required
            />

            <Radio.Group
              label="Authentication Type"
              value={formData.auth_type}
              onChange={(value) => handleChange("auth_type", value as "ssh_key" | "password")}
            >
              <Group mt="xs">
                <Radio
                  value="password"
                  label={
                    <Group gap={6}>
                      <IconLockPassword size={16} />
                      <span>Password</span>
                    </Group>
                  }
                />
                <Radio
                  value="ssh_key"
                  label={
                    <Group gap={6}>
                      <IconKey size={16} />
                      <span>SSH Key</span>
                    </Group>
                  }
                />
              </Group>
            </Radio.Group>

            {formData.auth_type === "password" ? (
              <PasswordInput
                label="SSH Password"
                placeholder="Enter SSH password"
                value={formData.password}
                onChange={(event) => handleChange("password", event.currentTarget.value)}
                required
              />
            ) : (
              <Textarea
                label="Private Key"
                placeholder="Paste the SSH private key"
                value={formData.private_key}
                onChange={(event) => handleChange("private_key", event.currentTarget.value)}
                minRows={6}
                required
              />
            )}

            <PasswordInput
              label="Become Password"
              placeholder="Optional sudo password"
              value={formData.become_password}
              onChange={(event) => handleChange("become_password", event.currentTarget.value)}
            />

            <Group justify="flex-end">
              <Button variant="default" onClick={resetEditor}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} leftSection={<IconEdit size={16} />}>
                {editingId === null ? "Create Credential" : "Save Changes"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={detailsOpened}
        onClose={() => setDetailsOpened(false)}
        title={selectedCredential ? `Credential Info: ${selectedCredential.name}` : "Credential Info"}
        centered
        size="md"
        classNames={{ content: "terminal-modal", header: "terminal-modal-header" }}
      >
        {selectedCredential && (
          <Stack gap="md">
            <Box className="terminal-code">
              <Text className="terminal-line">$ credential inspect {selectedCredential.name}</Text>
              <Text className="terminal-line">
                auth_type={selectedCredential.auth_type} username={selectedCredential.username}
              </Text>
            </Box>

            <Divider />

            <Table>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td c="dimmed">Name</Table.Td>
                  <Table.Td>{selectedCredential.name}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Username</Table.Td>
                  <Table.Td>{selectedCredential.username}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Auth Type</Table.Td>
                  <Table.Td>{selectedCredential.auth_type}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Private Key</Table.Td>
                  <Table.Td>{selectedCredential.private_key ? "stored" : "-"}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Password</Table.Td>
                  <Table.Td>{maskSecret(selectedCredential.password)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">Become Password</Table.Td>
                  <Table.Td>{maskSecret(selectedCredential.become_password)}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>

            <Group justify="flex-end">
              <Button
                variant="default"
                leftSection={<IconEdit size={16} />}
                onClick={() => {
                  setDetailsOpened(false);
                  openEditModal(selectedCredential);
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
