import { Button, Group, Progress, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconCheck,
  IconCloudComputing,
  IconListCheck,
  IconNetwork,
  IconServer2,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

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

export default function DeploymentWizard({
  activeStep,
  topologyReady,
  sshVerified,
  executionStarted,
  disabled,
  steps,
  title,
  description,
  completedSteps,
  onStepChange,
}: DeploymentWizardProps) {
  const { t } = useTranslation();

  const defaultSteps: DeploymentWizardStepDefinition[] = [
    {
      label: t("wizard.stepTopology", "Topology"),
      description: t("wizard.stepTopologyDesc", "Choose the cluster shape"),
      icon: IconNetwork,
    },
    {
      label: t("wizard.stepTargets", "Targets"),
      description: t("wizard.stepTargetsDesc", "Select and name the nodes"),
      icon: IconServer2,
    },
    {
      label: t("wizard.stepStartInstallation", "Start installation"),
      description: t("wizard.stepStartInstallationDesc", "Verify access and launch"),
      icon: IconListCheck,
    },
    {
      label: t("wizard.stepExecution", "Execution"),
      description: t("wizard.stepExecutionDesc", "Follow the deployment"),
      icon: IconCloudComputing,
    },
  ];

  const stepsToUse = steps ?? defaultSteps;
  const wizardTitle = title ?? t("wizard.guidedDeployment", "Guided deployment");
  const wizardDescription = description ?? t(
    "wizard.guidedDesc",
    "Complete each step in order. LinDeploy keeps the current configuration while you move between steps."
  );

  const completed = completedSteps ?? [
    activeStep > 0,
    topologyReady && activeStep > 1,
    sshVerified && activeStep > 2,
    executionStarted && activeStep === 3,
  ];
  const progress = ((activeStep + 1) / stepsToUse.length) * 100;

  return (
    <section className="deployment-wizard" aria-label={t("execution.liveMonitor", "Deployment progress")}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
          <div>
            <Text fw={800} size="lg">{wizardTitle}</Text>
            <Text c="dimmed" size="sm">
              {wizardDescription}
            </Text>
          </div>
          <Text size="sm" fw={700} c="dimmed">
            {t("wizard.stepCounter", {
              current: activeStep + 1,
              total: stepsToUse.length,
              defaultValue: `Step ${activeStep + 1} of ${stepsToUse.length}`,
            })}
          </Text>
        </Group>

        <div className="deployment-wizard-steps">
          {stepsToUse.map((step, index) => {
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
