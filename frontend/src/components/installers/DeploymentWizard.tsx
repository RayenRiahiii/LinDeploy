import { Button, Group, Progress, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconCheck,
  IconCloudComputing,
  IconListCheck,
  IconNetwork,
  IconServer2,
} from "@tabler/icons-react";

type WizardIcon = typeof IconNetwork;

export type DeploymentWizardStepDefinition = {
  label: string;
  description: string;
  icon: WizardIcon;
};

export type DeploymentWizardStep = 0 | 1 | 2 | 3;

type DeploymentWizardProps = {
  activeStep: DeploymentWizardStep;
  topologyReady: boolean;
  sshVerified: boolean;
  executionStarted: boolean;
  disabled?: boolean;
  steps?: readonly DeploymentWizardStepDefinition[];
  title?: string;
  description?: string;
  completedSteps?: readonly boolean[];
  onStepChange: (step: DeploymentWizardStep) => void;
};

const defaultSteps = [
  {
    label: "Topology",
    description: "Choose the cluster shape",
    icon: IconNetwork,
  },
  {
    label: "Targets",
    description: "Select and name the nodes",
    icon: IconServer2,
  },
  {
    label: "Start installation",
    description: "Verify access and launch",
    icon: IconListCheck,
  },
  {
    label: "Execution",
    description: "Follow the deployment",
    icon: IconCloudComputing,
  },
] as const;

export default function DeploymentWizard({
  activeStep,
  topologyReady,
  sshVerified,
  executionStarted,
  disabled,
  steps = defaultSteps,
  title = "Guided deployment",
  description = "Complete each step in order. LinDeploy keeps the current configuration while you move between steps.",
  completedSteps,
  onStepChange,
}: DeploymentWizardProps) {
  const completed = completedSteps ?? [
    activeStep > 0,
    topologyReady && activeStep > 1,
    sshVerified && activeStep > 2,
    executionStarted && activeStep === 3,
  ];
  const progress = ((activeStep + 1) / steps.length) * 100;

  return (
    <section className="deployment-wizard" aria-label="Deployment progress">
      <Stack gap="md">
        <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
          <div>
            <Text fw={800} size="lg">{title}</Text>
            <Text c="dimmed" size="sm">
              {description}
            </Text>
          </div>
          <Text size="sm" fw={700} c="dimmed">
            Step {activeStep + 1} of {steps.length}
          </Text>
        </Group>

        <div className="deployment-wizard-steps">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === activeStep;
            const isComplete = completed[index] || index < activeStep;
            const canOpen = !disabled && (index <= activeStep || (index === 1 && activeStep === 0));

            return (
              <Button
                key={step.label}
                variant="subtle"
                className={`deployment-wizard-step${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}`}
                onClick={() => canOpen && onStepChange(index as DeploymentWizardStep)}
                disabled={!canOpen}
                aria-current={isActive ? "step" : undefined}
              >
                <ThemeIcon
                  size={38}
                  radius="xl"
                  color={isComplete ? "teal" : isActive ? "red" : "gray"}
                  variant={isComplete || isActive ? "filled" : "light"}
                >
                  {isComplete ? <IconCheck size={18} /> : <Icon size={18} />}
                </ThemeIcon>
                <span className="deployment-wizard-step-copy">
                  <span>{step.label}</span>
                  <small>{step.description}</small>
                </span>
              </Button>
            );
          })}
        </div>

        <Progress value={progress} color="red" size="sm" radius="xl" />
      </Stack>
    </section>
  );
}
