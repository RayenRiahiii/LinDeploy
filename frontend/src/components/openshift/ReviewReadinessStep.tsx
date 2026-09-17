import { Accordion, Alert, Badge, Code, Stack, Text, TextInput } from "@mantine/core";
import { IconChecklist, IconCode, IconEraser } from "@tabler/icons-react";
import { buildOpenShiftPayload, buildReadiness, buildYamlPreviews, redactSecrets } from "./form";
import OpenShiftFormSection from "./OpenShiftFormSection";
import type { OpenShiftFieldErrors, OpenShiftSNOFormValues } from "./types";

type Props = { values: OpenShiftSNOFormValues; errors: OpenShiftFieldErrors; hostAvailable: boolean; templateId?: number; update: <K extends keyof OpenShiftSNOFormValues>(field: K, value: OpenShiftSNOFormValues[K]) => void };
const colors = { passed: "green", warning: "yellow", blocking: "red" } as const;

export default function ReviewReadinessStep({ values, errors, hostAvailable, templateId, update }: Props) {
  const readiness = buildReadiness(values, errors, hostAvailable, templateId !== undefined);
  const yaml = buildYamlPreviews(values);
  const payload = templateId === undefined ? null : redactSecrets(buildOpenShiftPayload(values, templateId, "<one-use-secret-reference>"));
  const blockingCount = readiness.filter((item) => item.state === "blocking").length;

  return (
    <Stack gap="lg">
      <OpenShiftFormSection icon={IconChecklist} title="Launch readiness" description="Every blocking check must pass before LinDeploy can queue the OpenShift installation." badge={<Badge color={blockingCount ? "red" : "teal"} variant="light">{blockingCount ? `${blockingCount} blocking` : "Ready"}</Badge>}>
        <div className="openshift-readiness-list">
          {readiness.map((item) => <div className="openshift-readiness-row" key={item.label}><div><Text fw={700}>{item.label}</Text><Text size="sm" c="dimmed">{item.detail}</Text></div><Badge color={colors[item.state]} variant="light">{item.state}</Badge></div>)}
        </div>
      </OpenShiftFormSection>

      <OpenShiftFormSection icon={IconEraser} title="Destructive confirmation" description="This final approval is checked by both the API and the Ansible playbook before installation starts." badge={<Badge color="orange" variant="light">Required</Badge>}>
        <Alert color="orange" title="Verify the guest disk">
          OpenShift will erase {values.installationDisk || "the selected guest disk"} inside the new VM. The workflow must not target a physical disk on the KVM host.
        </Alert>
        <TextInput label="Disk-erasure confirmation" description={`Type exactly ERASE ${values.installationDisk}.`} placeholder={`ERASE ${values.installationDisk}`} value={values.installConfirmation} error={errors.installConfirmation} onChange={(event) => update("installConfirmation", event.currentTarget.value)} autoComplete="off" />
      </OpenShiftFormSection>

      <OpenShiftFormSection icon={IconCode} title="Technical review" description="Optional sanitized details for operators who need to inspect the generated configuration before launch.">
        <Accordion variant="contained" className="openshift-review-accordion">
          <Accordion.Item value="payload"><Accordion.Control>Sanitized API payload</Accordion.Control><Accordion.Panel><Code block className="openshift-code-preview">{payload ? JSON.stringify(payload, null, 2) : "Template unavailable - launch payload cannot be generated."}</Code></Accordion.Panel></Accordion.Item>
          <Accordion.Item value="install-config"><Accordion.Control>install-config.yaml preview</Accordion.Control><Accordion.Panel><Code block className="openshift-code-preview">{yaml.installConfig}</Code></Accordion.Panel></Accordion.Item>
          <Accordion.Item value="agent-config"><Accordion.Control>agent-config.yaml preview</Accordion.Control><Accordion.Panel><Code block className="openshift-code-preview">{yaml.agentConfig}</Code></Accordion.Panel></Accordion.Item>
        </Accordion>
        <Text size="xs" c="dimmed">Pull secrets, trust bundles, passwords, private keys, and Red Hat tokens are never shown in these previews.</Text>
      </OpenShiftFormSection>
    </Stack>
  );
}
