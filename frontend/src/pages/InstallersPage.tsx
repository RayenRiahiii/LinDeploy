import {
  Badge,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowRight, IconBinaryTree2 } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import InstallerLabel from "../components/installers/InstallerLabel";
import { installerOptions } from "../features/installers/catalog";

export default function InstallersPage() {
  return (
    <Stack gap="lg">
      <Card className="console-panel" padding="lg">
        <Group gap="sm">
          <IconBinaryTree2 size={18} />
          <div>
            <Title order={3}>Installer Catalog</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Open a dedicated workflow page for each supported platform. Shared execution monitoring stays separate in the Execution Center.
            </Text>
          </div>
        </Group>
      </Card>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        {installerOptions.map((installer) => {
          const isAvailable = installer.availability === "available";
          const cardContent = (
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={700} size="lg">
                    <InstallerLabel
                      label={installer.label}
                      withLogo={installer.id === "kubernetes" || installer.id === "k3s"}
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
                <Group gap="xs" mt="sm">
                  <IconArrowRight size={16} />
                  <Text size="sm">Open workflow page</Text>
                </Group>
              )}
            </Stack>
          );

          return (
            isAvailable ? (
              <Card
                key={installer.id}
                className="installer-card"
                padding="lg"
                component={Link}
                to={installer.route}
              >
                {cardContent}
              </Card>
            ) : (
              <Card
                key={installer.id}
                className="installer-card is-disabled"
                padding="lg"
              >
                {cardContent}
              </Card>
            )
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
