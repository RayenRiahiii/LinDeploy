import {
  Badge,
  Button,
  Card,
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
  IconPlugConnected,
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
                {topology === "multi_node" ? "Assign Host Roles" : "Select Hosts"}
              </Title>
              <Text size="sm" c="dimmed" mt={4}>
                {topology === "multi_node"
                  ? "Assign each machine to the control-plane or worker group, then choose the control-plane host that initializes the cluster."
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
            onChange={(event) => onSetClusterConfigName(event.currentTarget.value)}
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
                    <div>
                      <Text fw={700}>{host.name}</Text>
                      <Text size="sm" c="dimmed" mt={4}>
                        {host.ip_address}
                      </Text>
                    </div>
                    <Badge
                      color={
                        isControlPlane ? "blue" : isWorker ? "teal" : isSelected ? "red" : "gray"
                      }
                      variant={isSelected ? "filled" : "light"}
                    >
                      {topology === "multi_node"
                        ? isControlPlane
                          ? "control plane"
                          : isWorker
                            ? "worker"
                            : "available"
                        : isSelected
                          ? "selected"
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
                    <div className="host-role-control">
                      <Text size="xs" fw={700} c="dimmed" mb={8}>
                        Cluster role
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
                          { label: "Unused", value: "unassigned" },
                          { label: "Control", value: "control_plane" },
                          { label: "Worker", value: "worker" },
                        ]}
                        aria-label={`Cluster role for ${host.name}`}
                      />

                      {isControlPlane && (
                        <Radio
                          mt="md"
                          checked={bootstrapHostId === host.id}
                          onChange={() => onSetBootstrapHostId(host.id)}
                          disabled={loading}
                          label="Use this host to initialize the cluster"
                          description="Bootstrap control-plane host"
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
