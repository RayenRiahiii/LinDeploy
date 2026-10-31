import { Accordion, Alert, Badge, Code, Stack, Text, TextInput } from "@mantine/core";
import { IconChecklist, IconCode, IconEraser } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { buildOpenShiftPayload, buildReadiness, buildYamlPreviews, redactSecrets } from "./form";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftSNOFormValues } from "./types";

type Props = { values: OpenShiftSNOFormValues; errors: OpenShiftFieldErrors; hostAvailable: boolean; templateId?: number; update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void };
const colors = { passed: "green", warning: "yellow", blocking: "red" } as const;

const readinessKeyMap: Record<string, string> = {
  "Configuration": "configuration",
  "Provisioning host": "provisioningHost",
  "Credentials": "credentials",
  "Disk erasure": "diskErasure",
  "DNS ownership": "dnsOwnership",
  "Automation template": "automationTemplate",
  "Connectivity mode": "connectivityMode",
  "Mirror content": "mirrorContent",
};

export default function ReviewReadinessStep({ values, errors, hostAvailable, templateId, update }: Props) {
  const { t } = useTranslation();
  const readiness = buildReadiness(values, errors, hostAvailable, templateId !== undefined);
  const yaml = buildYamlPreviews(values);
  const payload = templateId === undefined ? null : redactSecrets(buildOpenShiftPayload(values, templateId, "<one-use-secret-reference>"));
  const blockingCount = readiness.filter((item) => item.state === "blocking").length;

  return (
    <Stack gap="lg">
      <OpenShiftFormSection
        icon={IconChecklist}
        title={t("openshift.launchReadiness", "Launch readiness")}
        description={t("openshift.launchReadinessDesc", "Every blocking check must pass before LinDeploy can queue the OpenShift installation.")}
        badge={<Badge color={blockingCount ? "red" : "teal"} variant="light">{blockingCount ? t("openshift.blockingCount", { count: blockingCount, defaultValue: `${blockingCount} blocking` }) : t("openshift.ready", "Ready")}</Badge>}
      >
        <div className="openshift-readiness-list">
          {readiness.map((item) => (
            <div className="openshift-readiness-row" key={item.label}>
              <div>
                <Text fw={700}>{t(`openshift.readinessLabels.${readinessKeyMap[item.label] || item.label}`, item.label)}</Text>
                <Text size="sm" c="dimmed">{item.detail}</Text>
              </div>
              <Badge color={colors[item.state]} variant="light">{t(`openshift.states.${item.state}`, item.state)}</Badge>
            </div>
          ))}
        </div>
      </OpenShiftFormSection>

      <OpenShiftFormSection
        icon={IconEraser}
        title={t("openshift.destructiveConfirm", "Destructive confirmation")}
        description={t("openshift.destructiveConfirmDesc", "This final approval is checked by both the API and the Ansible playbook before installation starts.")}
        badge={<Badge color="orange" variant="light">{t("common.required", "Required")}</Badge>}
      >
        <Alert color="orange" title={t("openshift.verifyGuestDisk", "Verify the guest disk")}>
          {t("openshift.verifyGuestDiskDesc", {
            disk: values.installationDisk || "the selected guest disk",
            defaultValue: `OpenShift will erase ${values.installationDisk || "the selected guest disk"} inside the new VM. The workflow must not target a physical disk on the KVM host.`,
          })}
        </Alert>
        <TextInput
          label={t("openshift.diskErasureConfirm", "Disk-erasure confirmation")}
          description={t("openshift.diskErasureConfirmDesc", { disk: values.installationDisk, defaultValue: `Type exactly ERASE ${values.installationDisk}.` })}
          placeholder={`ERASE ${values.installationDisk}`}
          value={values.installConfirmation}
          error={errors.installConfirmation}
          onChange={(event) => update("installConfirmation", event.currentTarget.value)}
          autoComplete="off"
        />
      </OpenShiftFormSection>

      <OpenShiftFormSection
        icon={IconCode}
        title={t("openshift.technicalReview", "Technical review")}
        description={t("openshift.technicalReviewDesc", "Optional sanitized details for operators who need to inspect the generated configuration before launch.")}
      >
        <Accordion variant="contained" className="openshift-review-accordion">
          <Accordion.Item value="payload">
            <Accordion.Control>{t("openshift.sanitizedPayload", "Sanitized API payload")}</Accordion.Control>
            <Accordion.Panel>
              <Code block className="openshift-code-preview">
                {payload ? JSON.stringify(payload, null, 2) : t("openshift.templateUnavailable", "Template unavailable - launch payload cannot be generated.")}
              </Code>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="install-config">
            <Accordion.Control>{t("openshift.installConfigPreview", "install-config.yaml preview")}</Accordion.Control>
            <Accordion.Panel>
              <Code block className="openshift-code-preview">{yaml.installConfig}</Code>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="agent-config">
            <Accordion.Control>{t("openshift.agentConfigPreview", "agent-config.yaml preview")}</Accordion.Control>
            <Accordion.Panel>
              <Code block className="openshift-code-preview">{yaml.agentConfig}</Code>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        <Text size="xs" c="dimmed">
          {t("openshift.secretsHidden", "Pull secrets, trust bundles, passwords, private keys, and Red Hat tokens are never shown in these previews.")}
        </Text>
      </OpenShiftFormSection>
    </Stack>
  );
}
