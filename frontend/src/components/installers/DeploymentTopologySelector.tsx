import { Badge, Card, Center, Group, SegmentedControl, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import {
  IconBolt,
  IconCheck,
  IconCrown,
  IconHammer,
  IconLayersLinked,
  IconNetwork,
  IconServer,
  IconShieldCheck,
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
      rolePills: (
        <Group gap={6} mt={6} wrap="wrap">
          <Badge leftSection={<IconCrown size={11} />} color="blue" variant="light" size="xs">
            Master (Control Plane)
          </Badge>
          <Text size="xs" c="dimmed" fw={700}>+</Text>
          <Badge leftSection={<IconHammer size={11} />} color="teal" variant="light" size="xs">
            Worker
          </Badge>
          <Badge color="gray" variant="outline" size="xs">
            Co-located on single host
          </Badge>
        </Group>
      ),
      featurePoints: [
        {
          icon: IconServer,
          color: "#339af0",
          text: "Master & Worker combined: runs control plane and user workloads together on each machine",
        },
        {
          icon: IconShieldCheck,
          color: "#20c997",
          text: "Isolated failure domains: host failure only impacts that specific machine's cluster",
        },
        {
          icon: IconCheck,
          color: "#fa5252",
          text: "Zero cross-node networking: fastest deployment for standalone edge & test nodes",
        },
      ],
      isOptionDisabled: false,
    },
    {
      value: "multi_node" as const,
      title: multiNodeDisabled ? "Multi-node cluster (Coming Soon)" : "Multi-node cluster",
      badge: multiNodeDisabled ? "In Development" : "Shared cluster",
      summary: multiNodeDisabled
        ? `Multi-node clustering for ${installerLabel} is currently in development. Single-node mode is fully supported.`
        : `Selected hosts work together as one shared ${installerLabel} cluster with assigned Master and Worker roles.`,
      bestFor: multiNodeDisabled
        ? "Worker/agent join automation for OpenShift SNO is scheduled for an upcoming release."
        : "Shared services, production clusters, high availability, and scalable container workloads.",
      rolePills: (
        <Group gap={6} mt={6} wrap="wrap">
          <Badge leftSection={<IconCrown size={11} />} color="blue" variant="filled" size="xs">
            Master (Control Plane)
          </Badge>
          <Text size="xs" c="dimmed" fw={700}>&rarr;</Text>
          <Badge leftSection={<IconHammer size={11} />} color="teal" variant="filled" size="xs">
            Worker Nodes
          </Badge>
          <Badge color="teal" variant="light" size="xs">
            Distributed cluster
          </Badge>
        </Group>
      ),
      featurePoints: multiNodeDisabled
        ? [
            {
              icon: IconCheck,
              color: "#20c997",
              text: "Single-node mode is fully ready for production use",
            },
            {
              icon: IconLayersLinked,
              color: "#339af0",
              text: "Multi-node join playbook coming in an upcoming release",
            },
          ]
        : [
            {
              icon: IconCrown,
              color: "#339af0",
              text: "Master (Control Plane): coordinates kube-apiserver, scheduler, controllers, and etcd database",
            },
            {
              icon: IconBolt,
              color: "#fab005",
              text: "Bootstrap Master: initializes the cluster token and first control-plane node",
            },
            {
              icon: IconHammer,
              color: "#20c997",
              text: "Worker Nodes: join the master via secure token to run containerized pods and services",
            },
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
          <Badge color={isMultiNode ? "teal" : "red"} variant="light">
            {isMultiNode ? "shared cluster (master + workers)" : "independent clusters (all-in-one)"}
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
                  <span>Single-node (All-in-One)</span>
                </Center>
              ),
              value: "single_node",
            },
            {
              label: (
                <Center style={{ gap: 8 }}>
                  <IconLayersLinked size={15} />
                  <span>{multiNodeDisabled ? "Multi-node (Coming Soon)" : "Multi-node (Master + Workers)"}</span>
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

                {option.rolePills}

                <Text size="sm" fw={600} mt="md">{option.summary}</Text>
                <Text size="xs" c="dimmed" mt={5}>{option.bestFor}</Text>

                <div className="topology-feature-list" style={{ marginTop: 12 }}>
                  {option.featurePoints.map((point) => {
                    const PointIcon = point.icon;
                    return (
                      <span key={point.text} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "0.8rem", lineHeight: 1.4 }}>
                        <PointIcon size={15} style={{ flexShrink: 0, marginTop: 2, color: point.color }} />
                        <span>{point.text}</span>
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>

        <Text size="xs" c="dimmed">
          You can change this choice before execution. LinDeploy will adapt the next step to host selection or Master/Worker role assignment.
        </Text>
      </Stack>
    </Card>
  );
}
