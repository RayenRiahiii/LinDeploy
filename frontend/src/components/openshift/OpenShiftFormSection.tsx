import { Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import type { ReactNode } from "react";
import type { Icon } from "@tabler/icons-react";

type Props = {
  icon: Icon;
  title: string;
  description: string;
  children: ReactNode;
  badge?: ReactNode;
};

export default function OpenShiftFormSection({ icon: IconComponent, title, description, children, badge }: Props) {
  return (
    <section className="openshift-form-section">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
          <Group gap="sm" align="flex-start">
            <ThemeIcon color="red" variant="light" size="lg" radius="md">
              <IconComponent size={18} />
            </ThemeIcon>
            <div>
              <Title order={4}>{title}</Title>
              <Text size="sm" c="dimmed" mt={3}>{description}</Text>
            </div>
          </Group>
          {badge}
        </Group>
        {children}
      </Stack>
    </section>
  );
}
