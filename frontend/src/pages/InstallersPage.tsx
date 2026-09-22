import {
  Badge,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { IconArrowRight, IconBinaryTree2 } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import InstallerLabel from "../components/installers/InstallerLabel";
import { installerOptions } from "../features/installers/catalog";

export default function InstallersPage() {
  const availableCount = installerOptions.filter((i) => i.availability === "available").length;

  return (
    <Stack gap="lg">
      <PageHeader
        icon={<IconBinaryTree2 size={22} />}
        badge="Platform Engines"
        badgeColor="red"
        title="Installer Catalog"
        subtitle="Open a dedicated workflow page for each supported platform. Shared execution monitoring stays separate in the Execution Center."
        stats={
          <>
            <Badge color="red" variant="light">
              Total: {installerOptions.length}
            </Badge>
            <Badge color="teal" variant="light">
              Available: {availableCount}
            </Badge>
          </>
        }
      />

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        {installerOptions.map((installer) => {
          const isAvailable = installer.availability === "available";
          const cardContent = (
            <Stack gap="sm" style={{ height: "100%" }}>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={700} size="lg">
                    <InstallerLabel
                      label={installer.label}
                      withLogo
                      installerId={installer.id}
                    />
                  </Text>
                  <Text c="dimmed" size="sm" mt={6}>
                    {installer.description}
                  </Text>
                </div>
                <Badge color={isAvailable ? "teal" : "gray"} variant="light">
                  {isAvailable ? "available" : "coming soon"}
                </Badge>
              </Group>

              {isAvailable && (
                <Group gap="xs" mt="auto" pt="sm">
                  <IconArrowRight size={16} />
                  <Text size="sm" fw={600} c="red.6">Open workflow page</Text>
                </Group>
              )}
            </Stack>
          );

          return isAvailable ? (
            <Card
              key={installer.id}
              className="installer-card card-grid-item"
              padding="lg"
              component={Link}
              to={installer.route}
            >
              {cardContent}
            </Card>
          ) : (
            <Card
              key={installer.id}
              className="installer-card card-grid-item is-disabled"
              padding="lg"
            >
              {cardContent}
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
