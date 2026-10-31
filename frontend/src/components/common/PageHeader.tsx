import React from "react";
import { Badge, Card, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";

export interface PageHeaderProps {
  icon: React.ReactNode;
  badge: string;
  badgeColor?: string;
  title: React.ReactNode;
  description?: string;
  subtitle?: string;
  badges?: React.ReactNode;
  stats?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function PageHeader({
  icon,
  badge,
  badgeColor = "red",
  title,
  description,
  subtitle,
  badges,
  stats,
  actions,
}: PageHeaderProps) {
  const descText = description || subtitle;
  const badgesNode = badges || stats;

  return (
    <Card className="page-header-card" padding="lg">
      <Group justify="space-between" align="flex-start" gap="md" wrap="wrap">
        <Group gap="md" align="flex-start" wrap="nowrap">
          <ThemeIcon color={badgeColor} variant="light" size={42} radius="md">
            {icon}
          </ThemeIcon>
          <Stack gap={4}>
            <Group gap="xs">
              <Badge color={badgeColor} variant="light" size="sm">
                {badge}
              </Badge>
              {badgesNode}
            </Group>
            <Title order={2} className="page-header-title">
              {title}
            </Title>
            {descText && (
              <Text c="dimmed" size="sm" maw={720}>
                {descText}
              </Text>
            )}
          </Stack>
        </Group>

        {actions && (
          <Group gap="sm" align="center" className="page-header-actions">
            {actions}
          </Group>
        )}
      </Group>
    </Card>
  );
}
