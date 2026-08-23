import { Badge, Card, Group, SegmentedControl, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import {
  IconCheck,
  IconNetwork,
  IconTopologyFull,
} from "@tabler/icons-react";

export type DeploymentTopology = "single_node" | "multi_node";

type DeploymentTopologySelectorProps = {
  installerLabel: string;
  topology: DeploymentTopology;
  onChange: (topology: DeploymentTopology) => void;
  disabled?: boolean;
};

export default function DeploymentTopologySelector({
  installerLabel,
  topology,
  onChange,
  disabled,
}: DeploymentTopologySelectorProps) {
  const isMultiNode = topology === "multi_node";

  const topologyOptions = [
    {
      value: "single_node" as const,
      title: "Single-node per target",
      badge: "Independent clusters",
      summary: `Every selected host becomes a complete, independent ${installerLabel} cluster.`,
      bestFor: "Labs, isolated workloads, edge sites, and independent test environments.",
      points: ["Control plane and workloads share one host", "A failure affects only that host's cluster"],
    },
    {
      value: "multi_node" as const,
      title: "Multi-node cluster",
      badge: "Shared cluster",
      summary: `Selected hosts work together as one ${installerLabel} cluster with assigned roles.`,
      bestFor: "Shared services, production-like environments, and scalable workloads.",
      points: ["One bootstrap control-plane initializes the cluster", "Workers join the shared control plane"],
    },
  ];

  return (
    <Card className="console-panel topology-selector" padding="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
          <Group gap="sm">
            <ThemeIcon color="red" variant="light" size="lg" radius="md">
              <IconTopologyFull size={18} />
            </ThemeIcon>
            <div>
              <Title order={3}>Deployment Topology</Title>
              <Text size="sm" c="dimmed" mt={4}>
                Select the architecture that matches how these machines should operate after deployment.
              </Text>
            </div>
          </Group>
          <Badge color={isMultiNode ? "teal" : "red"} variant="light">
            {isMultiNode ? "shared cluster" : "independent clusters"}
          </Badge>
        </Group>

        <SegmentedControl
          value={topology}
          onChange={(value) => onChange(value as DeploymentTopology)}
          disabled={disabled}
          fullWidth
          data={[
            { label: "Single-node per target", value: "single_node" },
            { label: "Multi-node cluster", value: "multi_node" },
          ]}
          aria-label="Deployment topology"
        />

        <div className="topology-comparison-grid">
          {topologyOptions.map((option) => {
            const selected = option.value === topology;

            return (
              <button
                type="button"
                key={option.value}
                className={`topology-option${selected ? " is-selected" : ""}`}
                onClick={() => onChange(option.value)}
                disabled={disabled}
                aria-pressed={selected}
              >
                <div className="topology-option-heading">
                  <div>
                    <Text fw={800}>{option.title}</Text>
                    <Badge color={option.value === "multi_node" ? "teal" : "blue"} variant="light" mt={6}>
                      {option.badge}
                    </Badge>
                  </div>
                  <ThemeIcon
                    color={selected ? "red" : "gray"}
                    variant={selected ? "filled" : "light"}
                    radius="xl"
                  >
                    {selected ? <IconCheck size={16} /> : <IconNetwork size={16} />}
                  </ThemeIcon>
                </div>

                <Text size="sm" fw={600} mt="md">{option.summary}</Text>
                <Text size="xs" c="dimmed" mt={5}>{option.bestFor}</Text>

                <div className="topology-feature-list">
                  {option.points.map((point) => (
                    <span key={point}>
                      <IconCheck size={14} />
                      {point}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <Text size="xs" c="dimmed">
          You can change this choice before execution. LinDeploy will adapt the next step to host selection or role assignment.
        </Text>
      </Stack>
    </Card>
  );
}
