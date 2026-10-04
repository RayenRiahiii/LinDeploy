import {
  Badge,
  Button,
  Card,
  Center,
  Group,
  Radio,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCircleMinus,
  IconCrown,
  IconHammer,
  IconPlugConnected,
  IconServer,
} from "@tabler/icons-react";
import { type DeploymentTopology } from "../../installers/DeploymentTopologySelector";
import { type InstallerId } from "../../../features/installers/catalog";
import {
  type ClusterConfig,
  type Host,
  type HostOverrideForm,
} from "../types";
import { buildDefaultHostOverride, normalizeNodeName } from "../presentation";

interface TargetHostsStepProps {
  hosts: Host[];
  selectedHostIds: number[];
  controlPlaneHostIds: number[];
  workerHostIds: number[];
  bootstrapHostId: number | null;
  hostOverrides: Record<number, HostOverrideForm>;
  topology: DeploymentTopology;
  selectedInstaller: InstallerId;
  clusterConfig: ClusterConfig;
  loading: boolean;
  showGuidedInstaller: boolean;
  topologyReady: boolean;
  onToggleHost: (hostId: number, isSelected: boolean) => void;
  onSetMultiNodeHostRole: (
    hostId: number,
    role: "unassigned" | "control_plane" | "worker"
  ) => void;
  onSetBootstrapHostId: (hostId: number) => void;
  onUpdateHostIdentity: (
    hostId: number,
    field: "cluster_name" | "node_name",
    value: string
  ) => void;
  onClusterConfigChange: (updater: (prev: ClusterConfig) => ClusterConfig) => void;
  onBackToTopology?: () => void;
  onContinueToInstallation?: () => void;
}

export default function TargetHostsStep({
  hosts,
  selectedHostIds,
  controlPlaneHostIds,
  workerHostIds: _workerHostIds,
  bootstrapHostId,
  hostOverrides,
  topology,
  selectedInstaller,
  clusterConfig,
  loading,
  showGuidedInstaller,
  topologyReady,
  onToggleHost,
  onSetMultiNodeHostRole,
  onSetBootstrapHostId,
  onUpdateHostIdentity,
  onClusterConfigChange,
  onBackToTopology,
  onContinueToInstallation,
}: TargetHostsStepProps) {
  const enabledHosts = hosts.filter((host) => host.enabled);

  return (
    <Card className="console-panel" padding="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Group gap="sm">
            <ThemeIcon color="red" variant="light">
              <IconPlugConnected size={16} />
            </ThemeIcon>
            <div>
              <Title order={3}>
                {topology === "multi_node" ? "Assign Host Roles" : "Select Hosts"}
              </Title>
              <Text size="sm" c="dimmed" mt={4}>
                {topology === "multi_node"
                  ? "Assign each machine to the Master or Worker role, then select the initialization host."
                  : "Choose one or more enabled targets from the inventory. SSH user and port are taken directly from the host record."}
              </Text>
            </div>
          </Group>
          <Badge color="gray" variant="light">
            {topology === "multi_node" ? "role assignment" : "hosts inventory"}
          </Badge>
        </Group>

        {topology === "multi_node" && (
          <TextInput
            label="Cluster name"
            description="Optional shared name. Changing it on an existing cluster requires Reset Cluster first."
            placeholder={`${selectedInstaller}-production`}
            value={clusterConfig.cluster_name}
            onChange={(event) => {
              const clusterName = event.currentTarget.value;
              onClusterConfigChange((current) => ({
                ...current,
                cluster_name: clusterName,
              }));
            }}
            disabled={loading}
          />
        )}

        {enabledHosts.length === 0 ? (
          <Text c="dimmed">
            No enabled hosts are available. Add or enable a host before launching an installation.
          </Text>
        ) : (
          <div className="host-selection-grid">
            {enabledHosts.map((host) => {
              const isSelected = selectedHostIds.includes(host.id);
              const isControlPlane = controlPlaneHostIds.includes(host.id);
              const isWorker = _workerHostIds.includes(host.id);
              const assignedRole = isControlPlane
                ? "control_plane"
                : isWorker
                  ? "worker"
                  : "unassigned";
              const hostIdentity =
                hostOverrides[host.id] || buildDefaultHostOverride(host, selectedInstaller);

              return (
                <div
                  key={host.id}
                  className={`host-selection-card${isSelected ? " is-selected" : ""}${isControlPlane ? " is-control-plane" : ""}${isWorker ? " is-worker" : ""}${topology === "multi_node" ? " has-role-control" : ""}`}
                  onClick={
                    topology === "single_node"
                      ? () => onToggleHost(host.id, !isSelected)
                      : undefined
                  }
                  role={topology === "single_node" ? "button" : undefined}
                  tabIndex={topology === "single_node" ? 0 : undefined}
                  onKeyDown={(event) => {
                    if (
                      topology === "single_node" &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      onToggleHost(host.id, !isSelected);
                    }
                  }}
                >
                  <Group justify="space-between" align="flex-start">
                    <Group gap="sm" align="center">
                      <ThemeIcon
                        size={32}
                        radius="md"
                        color={
                          isControlPlane
                            ? "blue"
                            : isWorker
                              ? "teal"
                              : isSelected
                                ? "red"
                                : "gray"
                        }
                        variant="light"
                      >
                        {isControlPlane ? (
                          <IconCrown size={16} />
                        ) : isWorker ? (
                          <IconHammer size={16} />
                        ) : (
                          <IconServer size={16} />
                        )}
                      </ThemeIcon>
                      <div>
                        <Text fw={700}>{host.name}</Text>
                        <Text size="xs" c="dimmed">
                          {host.ip_address}
                        </Text>
                      </div>
                    </Group>
                    <Badge
                      color={
                        isControlPlane
                          ? "blue"
                          : isWorker
                            ? "teal"
                            : isSelected
                              ? "red"
                              : "gray"
                      }
                      variant="light"
                      size="sm"
                    >
                      {topology === "multi_node"
                        ? isControlPlane
                          ? bootstrapHostId === host.id
                            ? "Bootstrap Master"
                            : "Master"
                          : isWorker
                            ? "Worker"
                            : "Available"
                        : isSelected
                          ? "Selected"
                          : "Available"}
                    </Badge>
                  </Group>

                  <div className="host-selection-metrics">
                    <div className="host-selection-metric">
                      <Text size="xs" c="dimmed">SSH User</Text>
                      <Text fw={700}>{host.credential_username || "-"}</Text>
                    </div>
                    <div className="host-selection-metric">
                      <Text size="xs" c="dimmed">SSH Port</Text>
                      <Text fw={700}>{host.ssh_port}</Text>
                    </div>
                  </div>

                  {isSelected && (
                    <Stack
                      gap="xs"
                      mt="md"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      {topology === "single_node" && (
                        <TextInput
                          label="Cluster name"
                          description="Optional. Changing it after installation requires Reset Cluster first."
                          placeholder={`${selectedInstaller}-${normalizeNodeName(host.hostname || host.name)}`}
                          value={hostIdentity.cluster_name}
                          onChange={(event) =>
                            onUpdateHostIdentity(host.id, "cluster_name", event.currentTarget.value)
                          }
                          disabled={loading}
                        />
                      )}
                      <TextInput
                        label="Node name"
                        description="Optional DNS name. Changing it after installation requires Reset Cluster first."
                        placeholder={normalizeNodeName(host.hostname || host.name, `node-${host.id}`)}
                        value={hostIdentity.node_name}
                        onChange={(event) =>
                          onUpdateHostIdentity(host.id, "node_name", event.currentTarget.value)
                        }
                        disabled={loading}
                      />
                    </Stack>
                  )}

                  {topology === "multi_node" && (
                    <div className="host-role-control" style={{ marginTop: 12 }}>
                      <Text size="xs" fw={700} c="dimmed" mb={8}>
                        Cluster Role
                      </Text>
                      <SegmentedControl
                        value={assignedRole}
                        onChange={(value) =>
                          onSetMultiNodeHostRole(
                            host.id,
                            value as "unassigned" | "control_plane" | "worker"
                          )
                        }
                        fullWidth
                        size="xs"
                        disabled={loading}
                        data={[
                          {
                            label: (
                              <Center style={{ gap: 6 }}>
                                <IconCircleMinus size={13} />
                                <span>Unused</span>
                              </Center>
                            ),
                            value: "unassigned",
                          },
                          {
                            label: (
                              <Center style={{ gap: 6 }}>
                                <IconCrown size={13} />
                                <span>Master</span>
                              </Center>
                            ),
                            value: "control_plane",
                          },
                          {
                            label: (
                              <Center style={{ gap: 6 }}>
                                <IconHammer size={13} />
                                <span>Worker</span>
                              </Center>
                            ),
                            value: "worker",
                          },
                        ]}
                        aria-label={`Cluster role for ${host.name}`}
                      />

                      {isControlPlane && (
                        <Radio
                          mt="xs"
                          checked={bootstrapHostId === host.id}
                          onChange={() => onSetBootstrapHostId(host.id)}
                          disabled={loading}
                          label="Bootstrap Master (initializes cluster)"
                          size="xs"
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {showGuidedInstaller && (
          <Group className="wizard-stage-actions" justify="space-between">
            <Button
              variant="default"
              onClick={onBackToTopology}
              leftSection={<IconArrowLeft size={16} />}
            >
              Back to topology
            </Button>
            <Button
              onClick={onContinueToInstallation}
              disabled={!topologyReady}
              rightSection={<IconArrowRight size={16} />}
            >
              Continue to installation
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
