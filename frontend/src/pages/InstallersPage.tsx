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
import { useTranslation } from "react-i18next";
import PageHeader from "../components/common/PageHeader";
import InstallerLabel from "../components/installers/InstallerLabel";
import { installerOptions } from "../features/installers/catalog";

export default function InstallersPage() {
  const { t } = useTranslation();
  const availableCount = installerOptions.filter((i) => i.availability === "available").length;

  return (
    <Stack gap="lg">
      <PageHeader
        icon={<IconBinaryTree2 size={22} />}
        badge={t("installers.engines", "Platform Engines")}
        badgeColor="red"
        title={t("installers.title", "Installer Catalog")}
        subtitle={t("installers.subtitle", "Open a dedicated workflow page for each supported platform. Shared execution monitoring stays separate in the Execution Center.")}
        stats={
          <>
            <Badge color="red" variant="light">
              {t("common.total", "Total")}: {installerOptions.length}
            </Badge>
            <Badge color="teal" variant="light">
              {t("installers.available", "Available")}: {availableCount}
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
                    {t(`installers.${installer.id}Desc`, installer.description)}
                  </Text>
                </div>
                <Badge color={isAvailable ? "teal" : "gray"} variant="light">
                  {isAvailable ? t("installers.available", "available") : t("installers.comingSoon", "coming soon")}
                </Badge>
              </Group>

              {isAvailable && (
                <div className="installer-card-action" style={{ marginTop: "auto" }}>
                  <span>{t("installers.openWorkflow", "Open workflow page")}</span>
                  <IconArrowRight size={14} className="installer-card-action-icon" />
                </div>
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
