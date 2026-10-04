import {
  Badge,
  Button,
  Card,
  Center,
  Group,
  Paper,
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
  IconBolt,
  IconCheck,
  IconCircleMinus,
  IconCrown,
  IconHammer,
  IconPlugConnected,
  IconServer,
  IconServer2,
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
  onSetClusterConfigName: (name: string) => void;
  onUpdateHostIdentity: (hostId: number, field: "node_name" | "cluster_name", value: string) => void;
  onSetMultiNodeHostRole: (hostId: number, role: "unassigned" | "control_plane" | "worker") => void;
  onSetBootstrapHostId: (hostId: number) => void;
  onBack?: () => void;
  onNext?: () => void;
}

export default function TargetHostsStep({
  hosts,
  selectedHostIds,
  controlPlaneHostIds,
  workerHostIds,
  bootstrapHostId,
  hostOverrides,
  topology,
  selectedInstaller,
  clusterConfig,
  loading,
  showGuidedInstaller,
  topologyReady,
  onToggleHost,
  onSetClusterConfigName,
  onUpdateHostIdentity,
  onSetMultiNodeHostRole,
  onSetBootstrapHostId,
  onBack,
  onNext,
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
                {topology === "multi_node" ? "Assign Master & Worker Roles" : "Select Hosts"}
              </Title>
              <Text size="sm" c="dimmed" mt={4}>
                {topology === "multi_node"
                  ? "Assign each machine as Master (Control Plane) or Worker, then choose the bootstrap host that initializes the cluster."
                  : "Choose one or more enabled targets from the inventory. Each host runs both master and worker roles independently."}
              </Text>
            </div>
          </Group>
          <Badge color={topology === "multi_node" ? "teal" : "gray"} variant="light">
            {topology === "multi_node" ? "master & worker assignment" : "hosts inventory"}
          </Badge>
        </Group>

        {topology === "multi_node" && (
          <TextInput
            label="Cluster name"
            description="Optional shared name. Changing it on an existing cluster requires Reset Cluster first."
            placeholder={`${selectedInstaller}-production`}
            value={clusterConfig.cluster_name}
            onChange={(event) => onSetClusterConfigName(event.currentTarget.value)}
            disabled={loading}
          />
        )}

        {topology === "multi_node" && (
          <Paper
            p="sm"
            radius="md"
            withBorder
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.02)",
            }}
          >
            <Group justify="space-between" align="center" wrap="wrap" gap="md">
              <Group gap="lg">
                <Group gap={6}>
                  <ThemeIcon size={22} radius="xl" color="blue" variant="filled">
                    <IconCrown size={13} />
                  </ThemeIcon>
                  <div>
                    <Text size="xs" fw={700}>
                      Master (Control Plane)
                    </Text>
                    <Text size="10px" c="dimmed">
                      API server, etcd, scheduler
                    </Text>
                  </div>
                  <Badge size="xs" color="blue" variant="light" ml={4}>
                    {controlPlaneHostIds.length} assigned
                  </Badge>
                </Group>

                <Group gap={6}>
                  <ThemeIcon size={22} radius="xl" color="teal" variant="filled">
                    <IconHammer size={13} />
                  </ThemeIcon>
                  <div>
                    <Text size="xs" fw={700}>
                      Worker Nodes
                    </Text>
                    <Text size="10px" c="dimmed">
                      Runs container pods
                    </Text>
                  </div>
                  <Badge size="xs" color="teal" variant="light" ml={4}>
                    {workerHostIds.length} assigned
                  </Badge>
                </Group>
              </Group>

              <Badge
                color={controlPlaneHostIds.length >= 1 ? "teal" : "red"}
                variant="light"
                size="sm"
                leftSection={controlPlaneHostIds.length >= 1 ? <IconCheck size={12} /> : undefined}
              >
                {controlPlaneHostIds.length >= 1
                  ? "At least 1 Master configured"
                  : "Requires at least 1 Master"}
              </Badge>
            </Group>
          </Paper>
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
              const isWorker = workerHostIds.includes(host.id);
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
                        variant={isSelected ? "light" : "subtle"}
                      >
                        {isControlPlane ? (
                          <IconCrown size={18} />
                        ) : isWorker ? (
                          <IconHammer size={18} />
                        ) : topology === "single_node" && isSelected ? (
                          <IconServer size={18} />
                        ) : (
                          <IconServer2 size={18} />
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
                          ? bootstrapHostId === host.id
                            ? "indigo"
                            : "blue"
                          : isWorker
                            ? "teal"
                            : isSelected
                              ? "red"
                              : "gray"
                      }
                      variant={isSelected ? "filled" : "light"}
                      leftSection={
                        topology === "multi_node" ? (
                          isControlPlane ? (
                            bootstrapHostId === host.id ? <IconBolt size={12} /> : <IconCrown size={12} />
                          ) : isWorker ? (
                            <IconHammer size={12} />
                          ) : (
                            <IconCircleMinus size={12} />
                          )
                        ) : isSelected ? (
                          <IconServer size={12} />
                        ) : (
                          <IconPlugConnected size={12} />
                        )
                      }
                    >
                      {topology === "multi_node"
                        ? isControlPlane
                          ? bootstrapHostId === host.id
                            ? "bootstrap master"
                            : "master"
                          : isWorker
                            ? "worker"
                            : "available"
                        : isSelected
                          ? "all-in-one"
                          : "available"}
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

                  {topology === "single_node" && isSelected && (
                    <Paper
                      p="xs"
                      radius="sm"
                      mt="xs"
                      style={{
                        backgroundColor: "rgba(238, 0, 0, 0.06)",
                        border: "1px solid rgba(238, 0, 0, 0.18)",
                      }}
                    >
                      <Group gap="xs" align="flex-start" wrap="nowrap">
                        <ThemeIcon color="red" variant="light" size="sm" radius="sm">
                          <IconServer size={13} />
                        </ThemeIcon>
                        <div style={{ flex: 1 }}>
                          <Text size="xs" fw={700} c="red.4">
                            All-in-One Target (Master + Worker)
                          </Text>
                          <Text size="11px" c="dimmed" mt={2} style={{ lineHeight: 1.3 }}>
                            Runs both the control-plane and container workloads as an independent cluster on this machine.
                          </Text>
                        </div>
                      </Group>
                    </Paper>
                  )}

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
                                <IconCrown size={13} color="#339af0" />
                                <span>Master</span>
                              </Center>
                            ),
                            value: "control_plane",
                          },
                          {
                            label: (
                              <Center style={{ gap: 6 }}>
                                <IconHammer size={13} color="#20c997" />
                                <span>Worker</span>
                              </Center>
                            ),
                            value: "worker",
                          },
                        ]}
                        aria-label={`Cluster role for ${host.name}`}
                      />

                      {isControlPlane && (
                        <Paper
                          p="xs"
                          radius="sm"
                          mt="xs"
                          style={{
                            backgroundColor: "rgba(51, 154, 240, 0.08)",
                            border: "1px solid rgba(51, 154, 240, 0.22)",
                          }}
                        >
                          <Group gap="xs" align="flex-start" wrap="nowrap">
                            <ThemeIcon color="blue" variant="light" size="sm" radius="sm">
                              <IconCrown size={13} />
                            </ThemeIcon>
                            <div style={{ flex: 1 }}>
                              <Text size="xs" fw={700} c="blue.4">
                                Master / Control Plane Node
                              </Text>
                              <Text size="11px" c="dimmed" mt={2} style={{ lineHeight: 1.3 }}>
                                Manages the cluster: runs API server, controller manager, scheduler, and etcd.
                              </Text>
                            </div>
                          </Group>

                          <Radio
                            mt="xs"
                            checked={bootstrapHostId === host.id}
                            onChange={() => onSetBootstrapHostId(host.id)}
                            disabled={loading}
                            label={
                              <Group gap={6} align="center">
                                <IconBolt size={13} color="#fab005" />
                                <Text size="xs" fw={700}>Bootstrap Master</Text>
                              </Group>
                            }
                            description="Initializes etcd and generates the join token for all subsequent nodes."
                          />
                        </Paper>
                      )}

                      {isWorker && (
                        <Paper
                          p="xs"
                          radius="sm"
                          mt="xs"
                          style={{
                            backgroundColor: "rgba(32, 201, 151, 0.08)",
                            border: "1px solid rgba(32, 201, 151, 0.22)",
                          }}
                        >
                          <Group gap="xs" align="flex-start" wrap="nowrap">
                            <ThemeIcon color="teal" variant="light" size="sm" radius="sm">
                              <IconHammer size={13} />
                            </ThemeIcon>
                            <div style={{ flex: 1 }}>
                              <Text size="xs" fw={700} c="teal.4">
                                Worker Node
                              </Text>
                              <Text size="11px" c="dimmed" mt={2} style={{ lineHeight: 1.3 }}>
                                Executes application workloads: joins the master and runs pods, services & containers.
                              </Text>
                            </div>
                          </Group>
                        </Paper>
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
              onClick={onBack}
              leftSection={<IconArrowLeft size={16} />}
            >
              Back to topology
            </Button>
            <Button
              onClick={onNext}
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
