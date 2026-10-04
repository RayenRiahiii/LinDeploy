import { Badge, Card, Center, Group, SegmentedControl, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import {
  IconCheck,
  IconCrown,
  IconHammer,
  IconNetwork,
  IconServer,
  IconTopologyFull,
} from "@tabler/icons-react";

export type DeploymentTopology = "single_node" | "multi_node";

type DeploymentTopologySelectorProps = {
  installerLabel: string;
  installerId?: string;
  topology: DeploymentTopology;
  onChange: (topology: DeploymentTopology) => void;
  disabled?: boolean;
};

export default function DeploymentTopologySelector({
  installerLabel,
  installerId,
  topology,
  onChange,
  disabled,
}: DeploymentTopologySelectorProps) {
  const isMultiNode = topology === "multi_node";
  const multiNodeDisabled = installerId === "openshift_sno";

  const topologyOptions = [
    {
      value: "single_node" as const,
      title: "Single-node per target",
      badge: "Independent clusters",
      summary: `Every selected host becomes a complete, independent ${installerLabel} cluster.`,
      bestFor: "Labs, isolated workloads, edge sites, and independent test environments.",
      points: [
        { icon: IconServer, text: "Control plane and workloads share one host" },
        { icon: IconCheck, text: "Failure is isolated to that host's cluster" },
      ],
      isOptionDisabled: false,
    },
    {
      value: "multi_node" as const,
      title: multiNodeDisabled ? "Multi-node cluster (Coming Soon)" : "Multi-node cluster",
      badge: multiNodeDisabled ? "In Development" : "Shared cluster",
      summary: multiNodeDisabled
        ? `Multi-node clustering for ${installerLabel} is currently in development. Single-node mode is fully supported.`
        : `Selected hosts work together as one shared ${installerLabel} cluster with assigned roles.`,
      bestFor: multiNodeDisabled
        ? "Worker/agent join automation for OpenShift SNO is scheduled for an upcoming release."
        : "Shared services, production clusters, high availability, and scalable container workloads.",
      points: multiNodeDisabled
        ? [
            { icon: IconCheck, text: "Single-node mode is fully supported" },
            { icon: IconCheck, text: "Multi-node join playbook coming soon" },
          ]
        : [
            { icon: IconCrown, text: "Master host initializes and coordinates the cluster" },
            { icon: IconHammer, text: "Worker nodes join to execute container workloads" },
          ],
      isOptionDisabled: multiNodeDisabled,
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
          <Badge color={isMultiNode ? "teal" : "gray"} variant="light">
            {isMultiNode ? "shared cluster" : "independent clusters"}
          </Badge>
        </Group>

        <SegmentedControl
          value={topology}
          onChange={(value) => onChange(value as DeploymentTopology)}
          disabled={disabled}
          fullWidth
          data={[
            {
              label: (
                <Center style={{ gap: 8 }}>
                  <IconServer size={15} />
                  <span>Single-node per target</span>
                </Center>
              ),
              value: "single_node",
            },
            {
              label: (
                <Center style={{ gap: 8 }}>
                  <IconNetwork size={15} />
                  <span>{multiNodeDisabled ? "Multi-node (Coming Soon)" : "Multi-node cluster"}</span>
                </Center>
              ),
              value: "multi_node",
              disabled: multiNodeDisabled,
            },
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
                onClick={() => {
                  if (!option.isOptionDisabled) {
                    onChange(option.value);
                  }
                }}
                disabled={disabled || option.isOptionDisabled}
                style={option.isOptionDisabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                aria-pressed={selected}
              >
                <div className="topology-option-heading">
                  <div>
                    <Text fw={700}>{option.title}</Text>
                    <Badge color={option.value === "multi_node" ? "teal" : "gray"} variant="light" mt={6} size="xs">
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

                <Text size="sm" c="dimmed" mt="sm">{option.summary}</Text>
                <Text size="xs" c="dimmed" mt={4}>{option.bestFor}</Text>

                <div className="topology-feature-list" style={{ marginTop: 14 }}>
                  {option.points.map((point) => {
                    const PointIcon = point.icon;
                    return (
                      <span key={point.text}>
                        <PointIcon size={14} style={{ opacity: 0.7 }} />
                        {point.text}
                      </span>
                    );
                  })}
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
