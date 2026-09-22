import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
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
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import PageHeader from "../common/PageHeader";
import ConfirmDeleteModal from "../crud/ConfirmDeleteModal";
import { formatApiError, parseApiPayload } from "../../lib/api";

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

const credentialApiErrorOptions = {
  fieldLabels: {
    name: "Credential name",
    auth_type: "Authentication type",
    username: "Username",
    private_key: "Private key",
    password: "SSH password",
    become_password: "Become password",
  },
  conflictMessages: {
    name: "This credential name is already used by another saved credential.",
  },
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
  const [credentialPendingDelete, setCredentialPendingDelete] = useState<Credential | null>(null);
  const [editorOpened, setEditorOpened] = useState(false);
  const [detailsOpened, setDetailsOpened] = useState(false);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [deleteError, setDeleteError] = useState("");
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
    setEditorError("");
    setEditorOpened(false);
  }

  function openCreateModal() {
    setEditingId(null);
    setFormData(emptyForm);
    setEditorError("");
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
    setEditorError("");
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
    setEditorError("");

    const payload =
      formData.auth_type === "password"
        ? { ...formData, private_key: "" }
        : { ...formData, password: "" };

    const url =
      editingId === null
        ? `${BASE_URL}/api/credentials/`
        : `${BASE_URL}/api/credentials/${editingId}/`;

    const method = editingId === null ? "POST" : "PATCH";

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await parseApiPayload(response);

      if (!response.ok) {
        throw new Error(
          formatApiError(data, "Unable to save credential.", credentialApiErrorOptions)
        );
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
      setEditorError(err instanceof Error ? err.message : "Unable to save credential.");
    } finally {
      setSaving(false);
    }
  }

  function openDeleteModal(credential: Credential) {
    setDeleteError("");
    setCredentialPendingDelete(credential);
  }

  function closeDeleteModal() {
    if (deletingId !== null) {
      return;
    }
    setDeleteError("");
    setCredentialPendingDelete(null);
  }

  async function handleDelete() {
    if (!credentialPendingDelete) {
      return;
    }

    const id = credentialPendingDelete.id;

    setDeletingId(id);
    setError("");
    setDeleteError("");
    try {
      const response = await fetch(`${BASE_URL}/api/credentials/${id}/`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await parseApiPayload(response);
        throw new Error(
          formatApiError(payload, "Unable to delete credential.", credentialApiErrorOptions)
        );
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

      setCredentialPendingDelete(null);
      await fetchCredentials();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unable to delete credential.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Stack gap="lg">
        <PageHeader
          icon={<IconKey size={22} />}
          badge="Access Management"
          badgeColor="red"
          title="Credentials Vault"
          description="Manage SSH usernames, password-based access, and key-based credentials used by your targets."
          badges={
            <>
              <Badge color="red" variant="light" size="sm">
                Total: {credentials.length}
              </Badge>
              <Badge color="teal" variant="light" size="sm">
                Password: {passwordAuthCount}
              </Badge>
              <Badge color="gray" variant="outline" size="sm">
                SSH Key: {sshKeyAuthCount}
              </Badge>
            </>
          }
          actions={
            <>
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
            </>
          }
        />

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
                operator@lindeploy:~$ ls credentials
              </Badge>
            </Group>

            <TextInput
              leftSection={<IconSearch size={16} />}
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
                  <Card key={credential.id} className="host-panel card-grid-item" padding="lg">
                    <Stack gap="sm" style={{ height: "100%" }}>
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

                      <Group grow mt="auto">
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
                          onClick={() => openDeleteModal(credential)}
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
            {editorError && (
              <Alert color="red" title="Unable to save credential" variant="light">
                {editorError}
              </Alert>
            )}

            <TextInput
              label="Credential Name"
              description="Reusable label for this SSH access profile."
              placeholder="linux-admin-ssh-key"
              value={formData.name}
              onChange={(event) => handleChange("name", event.currentTarget.value)}
              required
            />

            <TextInput
              label="Username"
              description="Remote account used to connect over SSH."
              placeholder="adminuser"
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
                description="Password used for SSH login on the target host."
                placeholder="Enter the remote user's SSH password"
                value={formData.password}
                onChange={(event) => handleChange("password", event.currentTarget.value)}
                required
              />
            ) : (
              <Textarea
                label="Private Key"
                description="Paste the private key that matches the public key installed on the host."
                placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
                value={formData.private_key}
                onChange={(event) => handleChange("private_key", event.currentTarget.value)}
                minRows={6}
                required
              />
            )}

            <PasswordInput
              label="Become Password"
              description="Optional sudo or become password if privilege escalation requires it."
              placeholder="Leave empty if sudo does not require a password"
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

      <ConfirmDeleteModal
        opened={credentialPendingDelete !== null}
        title="Delete Credential"
        itemName={credentialPendingDelete?.name || "this credential"}
        inventoryLabel="credentials inventory"
        description="This removes the saved SSH credential from LinDeploy. Hosts linked to it may need another credential before execution."
        error={deleteError}
        errorTitle="Unable to delete credential"
        loading={deletingId !== null}
        onClose={closeDeleteModal}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
