import { ActionIcon, Badge, Group, Menu, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconCheck, IconLanguage } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { setAppLanguage } from "../../i18n";

type LanguageSelectorProps = {
  variant?: "pill" | "icon" | "minimal";
  size?: "xs" | "sm" | "md";
};

export default function LanguageSelector({
  variant = "pill",
  size = "sm",
}: LanguageSelectorProps) {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language?.startsWith("fr") ? "fr" : "en") as "en" | "fr";

  const handleSelect = (lang: "en" | "fr") => {
    setAppLanguage(lang);
  };

  return (
    <Menu shadow="md" width={180} position="bottom-end" withinPortal>
      <Menu.Target>
        {variant === "icon" ? (
          <Tooltip label={t("topbar.selectLanguage", "Select language")}>
            <ActionIcon
              size={size === "md" ? 36 : 32}
              radius="xl"
              variant="light"
              color="gray"
              aria-label={t("topbar.selectLanguage", "Select language")}
            >
              <IconLanguage size={18} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <UnstyledButton
            aria-label={t("topbar.selectLanguage", "Select language")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 10px 0 8px",
              borderRadius: 999,
              border: "1px solid var(--surface-border-soft, rgba(255, 255, 255, 0.12))",
              background: "var(--soft-bg, rgba(255, 255, 255, 0.04))",
              color: "inherit",
              cursor: "pointer",
              transition: "all 140ms ease",
              fontSize: "0.76rem",
              fontWeight: 600,
            }}
          >
            <IconLanguage size={16} opacity={0.8} />
            <span style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {currentLang}
            </span>
          </UnstyledButton>
        )}
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>{t("topbar.language", "Language")}</Menu.Label>
        <Menu.Item
          onClick={() => handleSelect("en")}
          leftSection={<Text size="sm">🇬🇧</Text>}
          rightSection={currentLang === "en" ? <IconCheck size={14} color="var(--mantine-color-teal-6)" /> : null}
        >
          <Group gap="xs" justify="space-between" wrap="nowrap">
            <Text size="sm" fw={currentLang === "en" ? 600 : 400}>
              {t("topbar.english", "English")}
            </Text>
            <Badge size="xs" variant="light" color={currentLang === "en" ? "red" : "gray"}>
              EN
            </Badge>
          </Group>
        </Menu.Item>
        <Menu.Item
          onClick={() => handleSelect("fr")}
          leftSection={<Text size="sm">🇫🇷</Text>}
          rightSection={currentLang === "fr" ? <IconCheck size={14} color="var(--mantine-color-teal-6)" /> : null}
        >
          <Group gap="xs" justify="space-between" wrap="nowrap">
            <Text size="sm" fw={currentLang === "fr" ? 600 : 400}>
              {t("topbar.french", "Français")}
            </Text>
            <Badge size="xs" variant="light" color={currentLang === "fr" ? "red" : "gray"}>
              FR
            </Badge>
          </Group>
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
