import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconHistory,
  IconKey,
  IconLayoutDashboard,
  IconLogout,
  IconMoonStars,
  IconPlayerPlay,
  IconServer,
  IconSun,
  IconTerminal2,
  IconUser,
  IconChevronDown,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import LanguageSelector from "../components/common/LanguageSelector";
import lindeployWordmark from "../assets/logo.png";
import lindeployWordmarkDark from "../assets/darkmodeLogo.png";

type SectionMeta = {
  badge: string;
  title: string;
  description: string;
  terminalSection: string;
  installerId?: "kubernetes" | "k3s" | "openshift_sno" | null;
};

type NavigationItemDef = {
  route: string;
  labelKey: string;
  shortLabelKey: string;
  icon: typeof IconLayoutDashboard;
};

const navigationItemDefs: NavigationItemDef[] = [
  {
    route: "/dashboard",
    labelKey: "nav.dashboard",
    shortLabelKey: "nav.dashboardShort",
    icon: IconLayoutDashboard,
  },
  {
    route: "/hosts",
    labelKey: "nav.hosts",
    shortLabelKey: "nav.hostsShort",
    icon: IconServer,
  },
  {
    route: "/credentials",
    labelKey: "nav.credentials",
    shortLabelKey: "nav.credentialsShort",
    icon: IconKey,
  },
  {
    route: "/installers",
    labelKey: "nav.installers",
    shortLabelKey: "nav.installersShort",
    icon: IconPlayerPlay,
  },
  {
    route: "/executions",
    labelKey: "nav.executions",
    shortLabelKey: "nav.executionsShort",
    icon: IconTerminal2,
  },
  {
    route: "/history",
    labelKey: "nav.history",
    shortLabelKey: "nav.historyShort",
    icon: IconHistory,
  },
];

const sectionMetaDefs = [
  {
    match: (pathname: string) => pathname === "/dashboard",
    badgeKey: "sections.dashboard.badge",
    titleKey: "sections.dashboard.title",
    descKey: "sections.dashboard.description",
    terminalSection: "dashboard_overview",
  },
  {
    match: (pathname: string) => pathname.startsWith("/hosts"),
    badgeKey: "sections.hosts.badge",
    titleKey: "sections.hosts.title",
    descKey: "sections.hosts.description",
    terminalSection: "hosts_registry",
  },
  {
    match: (pathname: string) => pathname.startsWith("/credentials"),
    badgeKey: "sections.credentials.badge",
    titleKey: "sections.credentials.title",
    descKey: "sections.credentials.description",
    terminalSection: "credentials_vault",
  },
  {
    match: (pathname: string) => pathname === "/installers",
    badgeKey: "sections.installers.badge",
    titleKey: "sections.installers.title",
    descKey: "sections.installers.description",
    terminalSection: "installer_catalog",
  },
  {
    match: (pathname: string) => pathname === "/installers/kubernetes",
    badgeKey: "sections.kubernetes.badge",
    titleKey: "sections.kubernetes.title",
    descKey: "sections.kubernetes.description",
    terminalSection: "kubernetes_installer",
    installerId: "kubernetes" as const,
  },
  {
    match: (pathname: string) => pathname === "/installers/k3s",
    badgeKey: "sections.k3s.badge",
    titleKey: "sections.k3s.title",
    descKey: "sections.k3s.description",
    terminalSection: "k3s_installer",
    installerId: "k3s" as const,
  },
  {
    match: (pathname: string) => pathname === "/installers/openshift-sno",
    badgeKey: "sections.openshift.badge",
    titleKey: "sections.openshift.title",
    descKey: "sections.openshift.description",
    terminalSection: "openshift_sno_installer",
    installerId: "openshift_sno" as const,
  },
  {
    match: (pathname: string) => pathname.startsWith("/executions"),
    badgeKey: "sections.executions.badge",
    titleKey: "sections.executions.title",
    descKey: "sections.executions.description",
    terminalSection: "execution_center",
  },
  {
    match: (pathname: string) => pathname.startsWith("/history"),
    badgeKey: "sections.history.badge",
    titleKey: "sections.history.title",
    descKey: "sections.history.description",
    terminalSection: "history_archive",
  },
];

function getSectionMeta(pathname: string, t: (key: string, options?: Record<string, unknown>) => unknown): SectionMeta {
  const match = sectionMetaDefs.find((item) => item.match(pathname));
  if (match) {
    return {
      badge: String(t(match.badgeKey)),
      title: String(t(match.titleKey)),
      description: String(t(match.descKey)),
      terminalSection: match.terminalSection,
      installerId: match.installerId || null,
    };
  }
  return {
    badge: String(t("sections.default.badge", { defaultValue: "Platform Workspace" })),
    title: String(t("sections.default.title", { defaultValue: "Operate installers, inventory, and execution from one workspace" })),
    description: String(t(
      "sections.default.description",
      { defaultValue: "Navigate through inventory, installer workflows, and execution monitoring from a structured application shell." }
    )),
    terminalSection: "workspace",
  };
}

function isActive(pathname: string, route: string) {
  if (route === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname.startsWith(route);
}

type AppShellLayoutProps = {
  colorScheme: "dark" | "light";
  onToggleColorScheme: () => void;
};

export default function AppShellLayout({ colorScheme, onToggleColorScheme }: AppShellLayoutProps) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [topbarHidden, setTopbarHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const brandLogo = colorScheme === "dark" ? lindeployWordmarkDark : lindeployWordmark;

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;
  }, [location.pathname]);

  useEffect(() => {
    function handleScroll() {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollYRef.current;
      const isMobile = window.innerWidth <= 768;
      const threshold = isMobile ? 8 : 12;

      if (currentScrollY <= 24) {
        setTopbarHidden(false);
      } else if (delta > threshold && currentScrollY > 72) {
        setTopbarHidden(true);
      } else if (delta < -threshold) {
        setTopbarHidden(false);
      }

      lastScrollYRef.current = currentScrollY;
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const meta = getSectionMeta(location.pathname, t);

  const navigationItems = navigationItemDefs.map((item) => ({
    ...item,
    label: t(item.labelKey),
    shortLabel: t(item.shortLabelKey),
  }));

  return (
    <Box className="app-canvas">
      <div className="workspace-shell">
        <header className={`workspace-topbar${topbarHidden ? " is-hidden" : ""}`}>
          <div className="topbar-shell">
            <Box className="topbar-brand-panel">
              <Link to="/dashboard" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }} aria-label="LinDeploy Home">
                <img src={brandLogo} alt="LinDeploy" className="brand-wordmark" />
              </Link>
            </Box>

            <Box className="topbar-panel">
              <Group gap={4} className="topbar-nav" wrap="nowrap">
                {navigationItems.map((item) => {
                  const active = isActive(location.pathname, item.route);
                  const Icon = item.icon;

                  return (
                    <UnstyledButton
                      key={item.route}
                      component={Link}
                      to={item.route}
                      className={`orb-nav-link${active ? " is-active" : ""}`}
                    >
                      <ThemeIcon
                        size={32}
                        radius="xl"
                        variant={active ? "filled" : "light"}
                        color={active ? "red" : "gray"}
                        className="orb-nav-icon"
                      >
                        <Icon size={16} />
                      </ThemeIcon>
                      <span className="orb-nav-copy">
                        <span className="orb-nav-title">{item.label}</span>
                        <span className="orb-nav-subtitle">{item.shortLabel}</span>
                      </span>
                    </UnstyledButton>
                  );
                })}
              </Group>
            </Box>

            <Box className="hero-terminal topbar-terminal">
              <Group gap={6} justify="space-between" wrap="nowrap">
                <div className="topbar-terminal-copy">
                  <Text className="hero-terminal-line topbar-terminal-label">$ {t("topbar.workspace", "workspace")}</Text>
                  <Text className="hero-terminal-line topbar-terminal-value">{meta.terminalSection}</Text>
                </div>
                <Group gap={6} wrap="nowrap">
                  <LanguageSelector />
                  <ActionIcon
                    size={30}
                    radius="xl"
                    variant="light"
                    color={colorScheme === "dark" ? "yellow" : "dark"}
                    onClick={onToggleColorScheme}
                    aria-label={colorScheme === "dark" ? t("topbar.switchToLight", "Switch to light mode") : t("topbar.switchToDark", "Switch to dark mode")}
                    className="theme-toggle-button"
                  >
                    {colorScheme === "dark" ? <IconSun size={15} /> : <IconMoonStars size={15} />}
                  </ActionIcon>
                  {user && (
                    <Menu shadow="md" width={220} position="bottom-end">
                      <Menu.Target>
                        <UnstyledButton
                          className="user-profile-button"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            height: 30,
                            padding: "0 8px 0 3px",
                            borderRadius: 999,
                            background: colorScheme === "dark" ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.04)",
                            border: colorScheme === "dark" ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.1)",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                          aria-label="User profile and session options"
                        >
                          <Box
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: "50%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: colorScheme === "dark"
                                ? "linear-gradient(135deg, rgba(255, 59, 59, 0.3) 0%, rgba(200, 30, 30, 0.5) 100%)"
                                : "linear-gradient(135deg, rgba(224, 49, 49, 0.15) 0%, rgba(200, 30, 30, 0.25) 100%)",
                              border: colorScheme === "dark" ? "1px solid rgba(255, 80, 80, 0.45)" : "1px solid rgba(224, 49, 49, 0.3)",
                              color: colorScheme === "dark" ? "#ff6b6b" : "#d63333",
                              boxShadow: colorScheme === "dark" ? "0 0 8px rgba(255, 59, 59, 0.25)" : "none",
                              flexShrink: 0,
                            }}
                          >
                            <IconUser size={12} stroke={2} />
                          </Box>
                          <Text
                            size="xs"
                            fw={600}
                            truncate
                            style={{
                              maxWidth: 75,
                              color: "var(--text-primary)",
                              letterSpacing: "0.2px",
                            }}
                          >
                            {user.first_name || user.username}
                          </Text>
                          <IconChevronDown size={10} stroke={2} style={{ opacity: 0.5, marginLeft: -2 }} />
                        </UnstyledButton>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label>{t("topbar.signedInAs", "Signed in as")}</Menu.Label>
                        <Menu.Item disabled leftSection={<IconUser size={14} />}>
                          <Text size="xs" fw={600} truncate style={{ maxWidth: 170 }}>
                            {user.email || user.username}
                          </Text>
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconLogout size={14} />}
                          onClick={logout}
                        >
                          {t("topbar.signOut", "Sign out")}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
              </Group>
            </Box>
          </div>
        </header>

        <main className="workspace-main">
          <Box className="page-content">
            <Outlet />
          </Box>
        </main>
      </div>
    </Box>
  );
}
