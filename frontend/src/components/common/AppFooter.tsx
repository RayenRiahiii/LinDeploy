import { useState } from "react";
import {
  Box,
  Divider,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Badge,
  Button,
  Card,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowUp,
  IconBolt,
  IconDatabase,
  IconServer,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import lindeployWordmark from "../../assets/logo.png";
import lindeployWordmarkDark from "../../assets/darkmodeLogo.png";

type AppFooterProps = {
  colorScheme: "dark" | "light";
};

export default function AppFooter({ colorScheme }: AppFooterProps) {
  const { t } = useTranslation();
  const [aboutOpened, setAboutOpened] = useState(
    () => typeof window !== "undefined" && window.location.search.includes("about")
  );

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isDark = colorScheme === "dark";

  return (
    <>
      <Box
        component="footer"
        mt={32}
        pt={28}
        pb={16}
        style={{
          borderTop: isDark ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(0, 0, 0, 0.08)",
          width: "100%",
        }}
      >
        <Box
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 28,
            marginBottom: 24,
          }}
        >
          {/* Colonne Gauche : Logo & Slogan */}
          <Box style={{ maxWidth: 280 }}>
            <Link to="/dashboard" style={{ display: "inline-flex", textDecoration: "none" }} aria-label="LinDeploy Home">
              <img
                src={isDark ? lindeployWordmarkDark : lindeployWordmark}
                alt="LinDeploy"
                style={{ height: 22, width: "auto" }}
              />
            </Link>
            <Text size="xs" c="dimmed" mt={8} style={{ lineHeight: 1.5, opacity: 0.85 }}>
              {t("footer.taglineLong")}
            </Text>
          </Box>

          {/* Colonnes Droite : 3 colonnes de liens resserrées et modernes */}
          <Box style={{ display: "flex", gap: "56px", flexWrap: "wrap" }}>
            {/* Colonne 1 : Plateforme */}
            <Stack gap={5} style={{ minWidth: 110 }}>
              <Text fw={600} size="xs" style={{ color: "var(--text-primary)", marginBottom: 2 }}>
                {t("footer.colPlatform")}
              </Text>
              <Text component={Link} to="/dashboard" size="xs" c="dimmed" className="footer-link">
                {t("footer.overview")}
              </Text>
              <Text component={Link} to="/hosts" size="xs" c="dimmed" className="footer-link">
                {t("footer.hostsInventory")}
              </Text>
              <Text component={Link} to="/credentials" size="xs" c="dimmed" className="footer-link">
                {t("footer.credentials")}
              </Text>
              <Text component={Link} to="/installers" size="xs" c="dimmed" className="footer-link">
                {t("footer.installers")}
              </Text>
              <Text component={Link} to="/executions" size="xs" c="dimmed" className="footer-link">
                {t("footer.pipelines")}
              </Text>
              <Text component={Link} to="/history" size="xs" c="dimmed" className="footer-link">
                {t("footer.history")}
              </Text>
            </Stack>

            {/* Colonne 2 : Solutions */}
            <Stack gap={5} style={{ minWidth: 110 }}>
              <Text fw={600} size="xs" style={{ color: "var(--text-primary)", marginBottom: 2 }}>
                {t("footer.colSolutions")}
              </Text>
              <Text component={Link} to="/installers/kubernetes" size="xs" c="dimmed" className="footer-link">
                {t("footer.k8s")}
              </Text>
              <Text component={Link} to="/installers/k3s" size="xs" c="dimmed" className="footer-link">
                {t("footer.k3s")}
              </Text>
              <Text component={Link} to="/installers/openshift-sno" size="xs" c="dimmed" className="footer-link">
                {t("footer.openshift")}
              </Text>
            </Stack>

            {/* Colonne 3 : Ressources */}
            <Stack gap={5} style={{ minWidth: 110 }}>
              <Text fw={600} size="xs" style={{ color: "var(--text-primary)", marginBottom: 2 }}>
                {t("footer.colResources")}
              </Text>
              <UnstyledButton onClick={() => setAboutOpened(true)} className="footer-link">
                <Text size="xs" c="dimmed">
                  {t("footer.about")}
                </Text>
              </UnstyledButton>
              <Text component={Link} to="/history" size="xs" c="dimmed" className="footer-link">
                {t("footer.activityLogs")}
              </Text>
              <Text size="xs" c="dimmed" className="footer-link">
                {t("footer.systemStatus")}
              </Text>
            </Stack>
          </Box>
        </Box>

        <Divider mb={16} opacity={0.08} />

        {/* Ligne Inférieure : Copyright, disclaimer et liens rapides */}
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              © {new Date().getFullYear()} LinDeploy Platform. {t("footer.allRightsReserved")}
            </Text>
            <Text size="11px" c="dimmed" style={{ opacity: 0.6 }}>
              {t("footer.disclaimer")}
            </Text>
          </Stack>

          <Group gap="md" align="center">
            <UnstyledButton onClick={() => setAboutOpened(true)} className="footer-link">
              <Text size="xs" c="dimmed">
                {t("footer.about")}
              </Text>
            </UnstyledButton>
            <UnstyledButton onClick={scrollToTop} className="footer-link">
              <Group gap={4}>
                <Text size="xs" c="dimmed">
                  {t("footer.backToTop")}
                </Text>
                <IconArrowUp size={12} style={{ opacity: 0.6 }} />
              </Group>
            </UnstyledButton>
          </Group>
        </Group>
      </Box>

      {/* Modal À propos de LinDeploy (About Modal - Épuré et Monochrome) */}
      <Modal
        opened={aboutOpened}
        onClose={() => setAboutOpened(false)}
        title={
          <Group gap="xs">
            <img
              src={isDark ? lindeployWordmarkDark : lindeployWordmark}
              alt="LinDeploy"
              style={{ height: 22, width: "auto" }}
            />
            <Badge color="gray" size="xs" variant="outline">
              v2.4.0
            </Badge>
          </Group>
        }
        size="lg"
        radius="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
            {t("about.description")}
          </Text>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Card padding="sm" radius="md" withBorder style={{ background: "rgba(255, 255, 255, 0.02)" }}>
              <Group gap="xs" mb={4}>
                <IconBolt size={15} stroke={1.8} style={{ opacity: 0.7 }} />
                <Text fw={600} size="xs">{t("about.feature1Title")}</Text>
              </Group>
              <Text size="xs" c="dimmed">
                {t("about.feature1Desc")}
              </Text>
            </Card>

            <Card padding="sm" radius="md" withBorder style={{ background: "rgba(255, 255, 255, 0.02)" }}>
              <Group gap="xs" mb={4}>
                <IconShieldCheck size={15} stroke={1.8} style={{ opacity: 0.7 }} />
                <Text fw={600} size="xs">{t("about.feature2Title")}</Text>
              </Group>
              <Text size="xs" c="dimmed">
                {t("about.feature2Desc")}
              </Text>
            </Card>

            <Card padding="sm" radius="md" withBorder style={{ background: "rgba(255, 255, 255, 0.02)" }}>
              <Group gap="xs" mb={4}>
                <IconDatabase size={15} stroke={1.8} style={{ opacity: 0.7 }} />
                <Text fw={600} size="xs">{t("about.feature3Title")}</Text>
              </Group>
              <Text size="xs" c="dimmed">
                {t("about.feature3Desc")}
              </Text>
            </Card>

            <Card padding="sm" radius="md" withBorder style={{ background: "rgba(255, 255, 255, 0.02)" }}>
              <Group gap="xs" mb={4}>
                <IconServer size={15} stroke={1.8} style={{ opacity: 0.7 }} />
                <Text fw={600} size="xs">{t("about.feature4Title")}</Text>
              </Group>
              <Text size="xs" c="dimmed">
                {t("about.feature4Desc")}
              </Text>
            </Card>
          </SimpleGrid>

          <Group justify="flex-end" mt="xs">
            <Button
              variant="default"
              size="xs"
              onClick={() => setAboutOpened(false)}
            >
              {t("about.closeButton")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
