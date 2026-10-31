import { Menu, UnstyledButton, Text, Group, useMantineColorScheme } from "@mantine/core";
import { IconCheck, IconChevronDown, IconWorld } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const languages = [
  { code: "en", label: "English", tag: "EN" },
  { code: "fr", label: "Français", tag: "FR" },
];

export default function LanguageSelector() {
  const { i18n } = useTranslation();
  const { colorScheme } = useMantineColorScheme();
  const currentLang = i18n.language?.startsWith("fr") ? "fr" : "en";
  const currentObj = languages.find((l) => l.code === currentLang) || languages[0];

  function handleSelectLanguage(code: string) {
    i18n.changeLanguage(code);
    localStorage.setItem("lindeploy_language", code);
  }

  const isDark = colorScheme === "dark";

  return (
    <Menu shadow="md" width={150} position="bottom-end">
      <Menu.Target>
        <UnstyledButton
          aria-label="Change language"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 34,
            padding: "0 10px",
            borderRadius: 999,
            background: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.04)",
            border: isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.1)",
            cursor: "pointer",
            transition: "all 0.15s ease",
            fontSize: 13.5,
            fontWeight: 700,
            color: "var(--text-primary, inherit)",
          }}
        >
          <IconWorld size={17} style={{ opacity: 0.8 }} />
          <Text size="xs" fw={700} style={{ letterSpacing: "0.5px" }}>
            {currentObj.tag}
          </Text>
          <IconChevronDown size={13} style={{ opacity: 0.6 }} />
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        {languages.map((lang) => (
          <Menu.Item
            key={lang.code}
            onClick={() => handleSelectLanguage(lang.code)}
            rightSection={
              currentLang === lang.code ? (
                <IconCheck size={14} color="#e03131" stroke={2.5} />
              ) : null
            }
          >
            <Group gap={8}>
              <Text size="xs" fw={700} c="dimmed" style={{ width: 22, textAlign: "left" }}>
                {lang.tag}
              </Text>
              <Text size="sm" fw={currentLang === lang.code ? 600 : 400}>
                {lang.label}
              </Text>
            </Group>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
