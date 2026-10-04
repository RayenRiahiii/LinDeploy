import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Paper,
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
import { useAuth } from "../context/AuthContext";
import lindeployWordmark from "../assets/logo.png";
import lindeployWordmarkDark from "../assets/darkmodeLogo.png";

type SectionMeta = {
  badge: string;
  title: string;
  description: string;
  terminalSection: string;
  installerId?: "kubernetes" | "k3s" | "openshift_sno" | null;
};

type NavigationItem = {
  route: string;
  label: string;
  shortLabel: string;
  icon: typeof IconLayoutDashboard;
};

const navigationItems: NavigationItem[] = [
  {
    route: "/dashboard",
    label: "Dashboard",
    shortLabel: "Overview",
    icon: IconLayoutDashboard,
  },
  {
    route: "/hosts",
    label: "Hosts",
    shortLabel: "Inventory",
    icon: IconServer,
  },
  {
    route: "/credentials",
    label: "Credentials",
    shortLabel: "Access",
    icon: IconKey,
  },
  {
    route: "/installers",
    label: "Installers",
    shortLabel: "Catalog",
    icon: IconPlayerPlay,
  },
  {
    route: "/executions",
    label: "Executions",
    shortLabel: "Monitor",
    icon: IconTerminal2,
  },
  {
    route: "/history",
    label: "History",
    shortLabel: "Archive",
    icon: IconHistory,
  },
];

const sectionMetaMap: Array<{ match: (pathname: string) => boolean; meta: SectionMeta }> = [
  {
    match: (pathname) => pathname === "/dashboard",
    meta: {
      badge: "Operations Overview",
      title: "Track installers, hosts, credentials, and execution health",
      description:
        "Use the dashboard as the control room for current capacity, latest activity, and direct access to the next operational step.",
      terminalSection: "dashboard_overview",
    },
  },
  {
    match: (pathname) => pathname.startsWith("/hosts"),
    meta: {
      badge: "Infrastructure Inventory",
      title: "Manage targets with a clean operator workflow",
      description:
        "Review host definitions, credentials linkage, and machine properties from a structured CRUD workspace.",
      terminalSection: "hosts_registry",
    },
  },
  {
    match: (pathname) => pathname.startsWith("/credentials"),
    meta: {
      badge: "Access Management",
      title: "Maintain reusable SSH credentials safely and clearly",
      description:
        "Create and edit password-based or key-based SSH credentials used by your host inventory.",
      terminalSection: "credentials_vault",
    },
  },
  {
    match: (pathname) => pathname === "/installers",
    meta: {
      badge: "Installer Catalog",
      title: "Choose the system you want to install",
      description:
        "Select the target platform, then open its dedicated workflow page to configure inputs and start a controlled deployment.",
      terminalSection: "installer_catalog",
    },
  },
  {
    match: (pathname) => pathname === "/installers/kubernetes",
    meta: {
      badge: "Kubernetes Installer",
      title: "Deploy Kubernetes",
      description:
        "Choose a topology, assign target hosts, verify SSH connectivity, and follow deployment or cleanup from one operational page.",
      terminalSection: "kubernetes_installer",
      installerId: "kubernetes",
    },
  },
  {
    match: (pathname) => pathname === "/installers/k3s",
    meta: {
      badge: "K3s Installer",
      title: "Deploy K3s",
      description:
        "Choose a topology, assign target hosts, verify SSH connectivity, and follow deployment or cleanup from one operational page.",
      terminalSection: "k3s_installer",
      installerId: "k3s",
    },
  },
  {
    match: (pathname) => pathname === "/installers/openshift-sno",
    meta: {
      badge: "OpenShift SNO",
      title: "Deploy Single Node OpenShift",
      description:
        "Define cluster identity, KVM resources, networking and credentials, then review readiness before launch.",
      terminalSection: "openshift_sno_installer",
      installerId: "openshift_sno",
    },
  },
  {
    match: (pathname) => pathname.startsWith("/executions"),
    meta: {
      badge: "Execution Center",
      title: "Monitor active and recent installer runs",
      description:
        "Follow live progress, inspect task events, and review the final Ansible output from a dedicated execution workspace.",
      terminalSection: "execution_center",
    },
  },
  {
    match: (pathname) => pathname.startsWith("/history"),
    meta: {
      badge: "History Archive",
      title: "Inspect and prune completed installation records",
      description:
        "Review saved installer runs separately from the live monitor and remove obsolete execution history when needed.",
      terminalSection: "history_archive",
    },
  },
];

function getSectionMeta(pathname: string): SectionMeta {
  return (
    sectionMetaMap.find((item) => item.match(pathname))?.meta || {
      badge: "Platform Workspace",
      title: "Operate installers, inventory, and execution from one workspace",
      description:
        "Navigate through inventory, installer workflows, and execution monitoring from a structured application shell.",
      terminalSection: "workspace",
    }
  );
}

function isActive(pathname: string, route: string) {
  if (route === "/dashboard") {
    return pathname === "/dashboard";
  }

  return pathname === route || pathname.startsWith(`${route}/`);
}

type AppShellLayoutProps = {
  colorScheme: "dark" | "light";
  onToggleColorScheme: () => void;
};

export default function AppShellLayout({ colorScheme, onToggleColorScheme }: AppShellLayoutProps) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const meta = getSectionMeta(location.pathname);
  const brandLogo = colorScheme === "dark" ? lindeployWordmarkDark : lindeployWordmark;
  const [topbarHidden, setTopbarHidden] = useState(false);
  const lastScrollYRef = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;

      if (currentY < 24) {
        setTopbarHidden(false);
        lastScrollYRef.current = currentY;
        return;
      }

      const scrollingDown = currentY > lastScrollYRef.current;
      const delta = Math.abs(currentY - lastScrollYRef.current);

      if (delta > 10) {
        setTopbarHidden(scrollingDown);
        lastScrollYRef.current = currentY;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <Box className="app-shell">
      <div className="workspace-shell">
        <header className={`workspace-topbar${topbarHidden ? " is-hidden" : ""}`}>
          <div className="topbar-shell">
            <Paper className="topbar-brand-panel" p="xs">
              <Link to="/dashboard" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }} aria-label="LinDeploy Home">
                <img src={brandLogo} alt="LinDeploy" className="brand-wordmark" />
              </Link>
            </Paper>

            <Paper className="topbar-panel" p="md">
              <Group gap="sm" className="topbar-nav" justify="center">
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
                        radius="xl"
                        size={40}
                        variant={active ? "filled" : "light"}
                        color={active ? "red" : "gray"}
                        className="orb-nav-icon"
                      >
                        <Icon size={17} />
                      </ThemeIcon>
                      <span className="orb-nav-copy">
                        <span className="orb-nav-title">{item.label}</span>
                        <span className="orb-nav-subtitle">{item.shortLabel}</span>
                      </span>
                    </UnstyledButton>
                  );
                })}
              </Group>
            </Paper>

            <Box className="hero-terminal topbar-terminal">
              <Group gap="xs" justify="space-between" wrap="nowrap">
                <div className="topbar-terminal-copy">
                  <Text className="hero-terminal-line topbar-terminal-label">$ workspace</Text>
                  <Text className="hero-terminal-line topbar-terminal-value">{meta.terminalSection}</Text>
                </div>
                <Group gap={8} wrap="nowrap">
                  <ActionIcon
                    size={32}
                    radius="xl"
                    variant="light"
                    color={colorScheme === "dark" ? "yellow" : "dark"}
                    onClick={onToggleColorScheme}
                    aria-label={colorScheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    className="theme-toggle-button"
                  >
                    {colorScheme === "dark" ? <IconSun size={18} /> : <IconMoonStars size={18} />}
                  </ActionIcon>
                  {user && (
                    <Menu shadow="md" width={220} position="bottom-end">
                      <Menu.Target>
                        <UnstyledButton
                          className="user-profile-button"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            height: 32,
                            padding: "0 10px 0 4px",
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
                              width: 24,
                              height: 24,
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
                            <IconUser size={13} stroke={2} />
                          </Box>
                          <Text
                            size="xs"
                            fw={600}
                            truncate
                            style={{
                              maxWidth: 85,
                              color: "var(--text-primary)",
                              letterSpacing: "0.2px",
                            }}
                          >
                            {user.first_name || user.username}
                          </Text>
                          <IconChevronDown size={11} stroke={2} style={{ opacity: 0.5, marginLeft: -2 }} />
                        </UnstyledButton>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label>Signed in as</Menu.Label>
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
                          Sign out
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
