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
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import PageHeader from "../common/PageHeader";
import ConfirmDeleteModal from "../crud/ConfirmDeleteModal";
import { formatApiError, parseApiPayload } from "../../lib/api";
import { useTranslation } from "react-i18next";

type Credential = {
  id: number;
  name: string;
  auth_type: "ssh_key" | "password";
  username: string;
  private_key?: string;
  password?: string;
  become_password?: string;
  has_password?: boolean;
  has_become_password?: boolean;
  has_private_key?: boolean;
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

const BASE_URL = (import.meta.env.VITE_DJANGO_BASE_URL || "").replace(/\/+$/, "");

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
    private_key: "SSH private key",
    password: "SSH password",
    become_password: "Become password",
  },
  conflictMessages: {
    name: "This credential name is already used by another saved credential.",
  },
};

function maskSecret(value?: string, isConfigured?: boolean) {
  if (isConfigured || (value && value.length > 0)) {
    return "••••••••";
  }
  return "-";
}

export default function CredentialsList() {
  const { t } = useTranslation();
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
      private_key: "",
      password: "",
      become_password: "",
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

    let payload: Record<string, unknown>;
    if (editingId === null) {
      payload =
        formData.auth_type === "password"
          ? { ...formData, private_key: "" }
          : { ...formData, password: "" };
    } else {
      payload = {
        name: formData.name,
        auth_type: formData.auth_type,
        username: formData.username,
      };
      if (formData.auth_type === "password") {
        if (formData.password) {
          payload.password = formData.password;
        }
      } else {
        if (formData.private_key) {
          payload.private_key = formData.private_key;
        }
      }
      if (formData.become_password) {
        payload.become_password = formData.become_password;
      }
    }

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
        title: editingId === null ? t("credentials.createSuccessTitle", "Credential created") : t("credentials.updateSuccessTitle", "Credential updated"),
        message:
          editingId === null
            ? t("credentials.createSuccess", "The credential was added successfully.")
            : t("credentials.updateSuccess", "The credential was updated successfully."),
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
        title: t("credentials.deleteSuccess", "Credential deleted"),
        message: t("credentials.deleteSuccess", "The credential was removed successfully."),
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
          badge={t("sections.credentials.badge", "Access Management")}
          badgeColor="red"
          title={t("credentials.title", "Credentials Vault")}
          description={t("credentials.description", "Manage SSH usernames, password-based access, and key-based credentials used by your targets.")}
          badges={
            <>
              <Badge color="red" variant="light" size="sm">
                {t("common.total", "Total")}: {credentials.length}
              </Badge>
              <Badge color="teal" variant="light" size="sm">
                {t("credentials.passwordAuth", "Password")}: {passwordAuthCount}
              </Badge>
              <Badge color="gray" variant="outline" size="sm">
                {t("credentials.sshKeyAuth", "SSH Key")}: {sshKeyAuthCount}
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
                {t("common.refresh", "Refresh")}
              </Button>
              <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
                {t("credentials.addCredential", "Add Credential")}
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
                <Title order={3}>{t("credentials.entriesTitle", "Credential Entries")}</Title>
                <Text c="dimmed" size="sm">
                  {t("credentials.entriesSubtitle", "Review the SSH identity used by hosts. Secrets stay masked in the list and are only editable in the modal.")}
                </Text>
              </div>
              <Badge color="red" variant="dot">
                operator@lindeploy:~$ ls credentials
              </Badge>
            </Group>

            <TextInput
              leftSection={<IconSearch size={16} />}
              placeholder={t("credentials.searchPlaceholder", "Search by credential name, username, or auth type")}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />

            {loadingCredentials ? (
              <Text c="dimmed">{t("credentials.loadingCredentials", "Loading credentials...")}</Text>
            ) : credentials.length === 0 ? (
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
                    <IconKey size={28} />
                  </ThemeIcon>
                  <Text fw={600} size="lg">
                    {t("credentials.noCredentialsAvailable", "No credentials available")}
                  </Text>
                  <Text size="sm" c="dimmed" style={{ maxWidth: 440 }}>
                    {t(
                      "credentials.emptyDesc",
                      "You have not stored any SSH keys or passwords yet. Add credentials to enable secure access to your hosts."
                    )}
                  </Text>
                  <Button
                    leftSection={<IconPlus size={16} />}
                    color="red"
                    onClick={openCreateModal}
                    mt="xs"
                  >
                    {t("credentials.addCredential", "Add Credential")}
                  </Button>
                </Stack>
              </Card>
            ) : filteredCredentials.length === 0 ? (
              <Text c="dimmed">{t("credentials.noCredentialsFound", "No credentials found.")}</Text>
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
                            <Table.Td c="dimmed">{t("credentials.authType", "Auth Type")}</Table.Td>
                            <Table.Td>{credential.auth_type === "ssh_key" ? t("credentials.sshKeyAuth", "SSH Key") : t("credentials.passwordAuth", "Password")}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">{t("credentials.password", "Password")}</Table.Td>
                            <Table.Td>{maskSecret(credential.password, credential.has_password)}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">{t("credentials.sshPublicKey", "SSH Public Key")}</Table.Td>
                            <Table.Td>{credential.has_private_key || credential.private_key ? t("credentials.stored", "stored") : "-"}</Table.Td>
                          </Table.Tr>
                          <Table.Tr>
                            <Table.Td c="dimmed">{t("credentials.becomePassword", "Become Password")}</Table.Td>
                            <Table.Td>{maskSecret(credential.become_password, credential.has_become_password)}</Table.Td>
                          </Table.Tr>
                        </Table.Tbody>
                      </Table>

                      <Group grow mt="auto">
                        <Button
                          variant="default"
                          leftSection={<IconEye size={16} />}
                          onClick={() => openDetailsModal(credential)}
                        >
                          {t("common.info", "Info")}
                        </Button>
                        <Button
                          variant="light"
                          leftSection={<IconEdit size={16} />}
                          onClick={() => openEditModal(credential)}
                        >
                          {t("common.edit", "Edit")}
                        </Button>
                        <Button
                          color="red"
                          variant="filled"
                          leftSection={<IconTrash size={16} />}
                          onClick={() => openDeleteModal(credential)}
                          loading={deletingId === credential.id}
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
        title={editingId === null ? t("credentials.addCredential", "Add Credential") : t("credentials.editCredential", "Edit Credential")}
        centered
        size="lg"
        classNames={{ content: "terminal-modal", header: "terminal-modal-header" }}
      >
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {editorError && (
              <Alert color="red" title={t("common.error", "Unable to save credential")} variant="light">
                {editorError}
              </Alert>
            )}

            <TextInput
              label={t("credentials.name", "Credential Name")}
              description={t("credentials.nameDesc", "Reusable label for this SSH access profile.")}
              placeholder="linux-admin-ssh-key"
              value={formData.name}
              onChange={(event) => handleChange("name", event.currentTarget.value)}
              required
            />

            <TextInput
              label={t("credentials.username", "Username")}
              description={t("credentials.usernameDesc", "Remote account used to connect over SSH.")}
              placeholder="adminuser"
              value={formData.username}
              onChange={(event) => handleChange("username", event.currentTarget.value)}
              required
            />

            <Radio.Group
              label={t("credentials.authType", "Authentication Type")}
              value={formData.auth_type}
              onChange={(value) => handleChange("auth_type", value as "ssh_key" | "password")}
            >
              <Group mt="xs">
                <Radio
                  value="password"
                  label={
                    <Group gap={6}>
                      <IconLockPassword size={16} />
                      <span>{t("credentials.passwordAuth", "Password")}</span>
                    </Group>
                  }
                />
                <Radio
                  value="ssh_key"
                  label={
                    <Group gap={6}>
                      <IconKey size={16} />
                      <span>{t("credentials.sshKeyAuth", "SSH Key")}</span>
                    </Group>
                  }
                />
              </Group>
            </Radio.Group>

            {formData.auth_type === "password" ? (
              <PasswordInput
                label={t("credentials.password", "SSH Password")}
                description={t("credentials.passwordDesc", "Password used for SSH login on the target host.")}
                placeholder={
                  editingId !== null
                    ? t("credentials.leaveBlankToKeep", "Leave blank to keep existing password")
                    : t("credentials.passwordPlaceholder", "Enter the remote user's SSH password")
                }
                value={formData.password}
                onChange={(event) => handleChange("password", event.currentTarget.value)}
                required={editingId === null}
              />
            ) : (
              <Textarea
                label={t("credentials.sshPrivateKey", "SSH Private Key")}
                description={t("credentials.sshPrivateKeyDesc", "Paste the OpenSSH private key used to connect to target hosts.")}
                placeholder={
                  editingId !== null
                    ? t("credentials.leaveBlankToKeepKey", "Leave blank to keep existing SSH key")
                    : t("credentials.sshPrivateKeyPlaceholder", "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----")
                }
                value={formData.private_key}
                onChange={(event) => handleChange("private_key", event.currentTarget.value)}
                minRows={6}
                required={editingId === null}
              />
            )}

            <PasswordInput
              label={t("credentials.becomePassword", "Become Password")}
              description={t("credentials.becomePasswordDesc", "Optional sudo or become password if privilege escalation requires it.")}
              placeholder={
                editingId !== null
                  ? t("credentials.leaveBlankToKeep", "Leave blank to keep existing password")
                  : t("credentials.becomePasswordPlaceholder", "Leave empty if sudo does not require a password")
              }
              value={formData.become_password}
              onChange={(event) => handleChange("become_password", event.currentTarget.value)}
            />

            <Group justify="flex-end">
              <Button variant="default" onClick={resetEditor}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button type="submit" loading={saving} leftSection={<IconEdit size={16} />}>
                {editingId === null ? t("credentials.addCredential", "Create Credential") : t("common.save", "Save Changes")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={detailsOpened}
        onClose={() => setDetailsOpened(false)}
        title={selectedCredential ? `${t("credentials.credentialDetails", "Credential Details")}: ${selectedCredential.name}` : t("credentials.credentialDetails", "Credential Details")}
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
                  <Table.Td c="dimmed">{t("common.name", "Name")}</Table.Td>
                  <Table.Td>{selectedCredential.name}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("credentials.username", "Username")}</Table.Td>
                  <Table.Td>{selectedCredential.username}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("credentials.authType", "Auth Type")}</Table.Td>
                  <Table.Td>{selectedCredential.auth_type}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("credentials.sshPublicKey", "SSH Public Key")}</Table.Td>
                  <Table.Td>{selectedCredential.has_private_key || selectedCredential.private_key ? t("credentials.stored", "stored") : "-"}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("credentials.password", "Password")}</Table.Td>
                  <Table.Td>{maskSecret(selectedCredential.password, selectedCredential.has_password)}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td c="dimmed">{t("credentials.becomePassword", "Become Password")}</Table.Td>
                  <Table.Td>{maskSecret(selectedCredential.become_password, selectedCredential.has_become_password)}</Table.Td>
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
                {t("common.edit", "Edit")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <ConfirmDeleteModal
        opened={credentialPendingDelete !== null}
        title={t("credentials.deleteConfirmTitle", "Delete Credential")}
        itemName={credentialPendingDelete?.name || "this credential"}
        inventoryLabel={t("credentials.entriesTitle", "credentials inventory")}
        description={t("credentials.deleteConfirmMessage", { name: credentialPendingDelete?.name || "", defaultValue: `Are you sure you want to delete credential '${credentialPendingDelete?.name}'?` })}
        error={deleteError}
        errorTitle={t("common.error", "Unable to delete credential")}
        loading={deletingId !== null}
        onClose={closeDeleteModal}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
