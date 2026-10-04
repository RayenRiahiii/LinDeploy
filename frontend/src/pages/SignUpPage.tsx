import {
  ActionIcon,
  Alert,
  Anchor,
  Box,
  Button,
  Center,
  Divider,
  Grid,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconArrowRight,
  IconCheck,
  IconLock,
  IconMail,
  IconMoonStars,
  IconServer,
  IconShieldLock,
  IconSun,
  IconUser,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import lindeployLogoDark from "../assets/darkmodeLogo.png";
import { useAuth } from "../context/AuthContext";

type SignUpPageProps = {
  colorScheme: "dark" | "light";
  onToggleColorScheme: () => void;
};

export default function SignUpPage({ colorScheme, onToggleColorScheme }: SignUpPageProps) {
  const { loginWithGoogle, registerWithPassword, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const form = useForm({
    initialValues: {
      email: "",
      username: "",
      firstName: "",
      lastName: "",
      password: "",
      confirmPassword: "",
    },
    validate: {
      email: (val) => (!val.includes("@") ? "Valid email required" : null),
      password: (val) => (val.length < 6 ? "Password must have at least 6 characters" : null),
      confirmPassword: (val, values) => (val !== values.password ? "Passwords do not match" : null),
    },
  });

  const handleRegister = async (values: typeof form.values) => {
    setSubmitting(true);
    setErrorMessage(null);

    const result = await registerWithPassword({
      email: values.email,
      username: values.username || undefined,
      password: values.password,
      first_name: values.firstName || undefined,
      last_name: values.lastName || undefined,
    });
    setSubmitting(false);

    if (result.success) {
      notifications.show({
        title: "Account Created",
        message: "Your LinDeploy account has been provisioned.",
        color: "teal",
        icon: <IconCheck size={18} />,
      });
      navigate("/dashboard", { replace: true });
    } else {
      setErrorMessage(result.error || "Registration failed.");
    }
  };

  useEffect(() => {
    const clientId =
      import.meta.env.VITE_GOOGLE_CLIENT_ID ||
      "529009135237-nknqmqhqui1k6ce14tcecruaoubtot4b.apps.googleusercontent.com";

    const loadScript = () => {
      if (window.google?.accounts?.id) return;
      if (!document.getElementById("gsi-client-script")) {
        const script = document.createElement("script");
        script.id = "gsi-client-script";
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    };
    loadScript();

    const initGoogle = () => {
      if (window.google?.accounts?.id && googleBtnRef.current) {
        googleBtnRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response) => {
            if (response.credential) {
              setSubmitting(true);
              setErrorMessage(null);
              const res = await loginWithGoogle(response.credential);
              setSubmitting(false);

              if (res.success) {
                notifications.show({
                  title: "Single Sign-On Successful",
                  message: "Logged in with your Google account.",
                  color: "teal",
                  icon: <IconCheck size={18} />,
                });
                navigate("/dashboard", { replace: true });
              } else {
                setErrorMessage(res.error || "Google authentication failed.");
              }
            }
          },
        });

        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: colorScheme === "dark" ? "filled_black" : "outline",
          size: "large",
          text: "signup_with",
          shape: "rectangular",
          width: "100%",
          logo_alignment: "left",
        });
      }
    };

    if (window.google?.accounts?.id) {
      initGoogle();
    } else {
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          initGoogle();
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [colorScheme, loginWithGoogle, navigate]);

  const isDark = colorScheme === "dark";

  return (
    <Box
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: isDark ? "#0c0d12" : "#f4f6f8",
        color: isDark ? "#e6edf3" : "#1f2328",
      }}
    >
      <Group justify="space-between" px="xl" py="sm" style={{ borderBottom: `1px solid ${isDark ? "#1f242d" : "#e1e4e8"}` }}>
        <Group gap="xs">
          <ThemeIcon size={24} radius="sm" color="red" variant="filled">
            <IconServer size={14} />
          </ThemeIcon>
          <Text fw={700} size="sm" style={{ letterSpacing: 0.8 }}>
            LINDEPLOY
          </Text>
        </Group>

        <Group gap="sm">
          <Tooltip label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}>
            <ActionIcon
              variant="default"
              size="md"
              radius="sm"
              onClick={onToggleColorScheme}
              aria-label="Toggle Color Scheme"
              style={{
                backgroundColor: isDark ? "#161b22" : "#ffffff",
                borderColor: isDark ? "#30363d" : "#d0d7de",
              }}
            >
              {isDark ? <IconSun size={16} /> : <IconMoonStars size={16} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Center style={{ flex: 1, padding: "2rem 1rem" }}>
        <Paper
          shadow="xl"
          radius="md"
          withBorder
          style={{
            maxWidth: 1020,
            width: "100%",
            overflow: "hidden",
            borderColor: isDark ? "#282d38" : "#d8dee4",
            backgroundColor: isDark ? "#141720" : "#ffffff",
          }}
        >
          <Grid>
            <Grid.Col
              span={{ base: 12, md: 5 }}
              style={{
                backgroundColor: isDark ? "#090a0f" : "#151515",
                color: "#ffffff",
                padding: "3rem 2.5rem",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                position: "relative",
                backgroundImage:
                  "radial-gradient(circle at 10% 20%, rgba(238, 0, 0, 0.12) 0%, transparent 40%), linear-gradient(135deg, rgba(255,255,255,0.02) 0%, transparent 100%)",
              }}
            >
              <Stack gap="xl">
                <Box>
                  <img
                    src={lindeployLogoDark}
                    alt="LinDeploy"
                    style={{ height: 38, objectFit: "contain", filter: "brightness(1.05)" }}
                  />
                </Box>

                <Box style={{ borderLeft: "3px solid #EE0000", paddingLeft: "1rem" }}>
                  <Title order={2} style={{ fontSize: "1.55rem", fontWeight: 700, color: "#ffffff", lineHeight: 1.3 }}>
                    Deploy Kubernetes, K3s & OpenShift
                  </Title>
                  <Text size="sm" c="dimmed" mt="xs" style={{ color: "#9ca3af" }}>
                    Automated cluster deployment engine for Kubernetes, lightweight K3s, and OpenShift SNO on bare-metal and virtual machines.
                  </Text>
                </Box>
              </Stack>

              <Stack gap="xs" mt="3rem">
                <Group gap="xs">
                  <ThemeIcon size={20} radius="xl" color="red" variant="light">
                    <IconShieldLock size={12} />
                  </ThemeIcon>
                  <Text size="xs" fw={600} style={{ color: "#d1d5db" }}>
                    Automated Playbooks & Live Monitoring
                  </Text>
                </Group>
                <Text size="xs" style={{ color: "#6b7280" }}>
                  Run preflight checks, execute multi-node Ansible playbooks, and track cluster deployment progress in real time.
                </Text>
              </Stack>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 7 }} style={{ padding: "2.5rem" }}>
              <Stack gap="md">
                <Box>
                  <Title order={2} style={{ fontWeight: 700, letterSpacing: -0.3 }}>
                    Create your account
                  </Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    Sign up to deploy and manage your Kubernetes, K3s, and OpenShift clusters.
                  </Text>
                </Box>

                {errorMessage && (
                  <Alert icon={<IconAlertCircle size={16} />} title="Registration Error" color="red" radius="sm">
                    {errorMessage}
                  </Alert>
                )}

                <Box ref={googleBtnRef} style={{ minHeight: 44, display: "flex", justifyContent: "center" }} />

                <Divider
                  label={
                    <Text size="xs" c="dimmed" fw={600}>
                      OR ACCOUNT CREDENTIALS
                    </Text>
                  }
                  labelPosition="center"
                  my="xs"
                />

                <form onSubmit={form.onSubmit(handleRegister)}>
                  <Stack gap="xs">
                    <Group grow>
                      <TextInput
                        label="First Name"
                        placeholder="Alex"
                        size="xs"
                        leftSection={<IconUser size={14} />}
                        {...form.getInputProps("firstName")}
                        styles={{
                          input: {
                            backgroundColor: isDark ? "#0f121a" : "#fdfdfd",
                            borderColor: isDark ? "#2d3342" : "#ced4da",
                          },
                        }}
                      />
                      <TextInput
                        label="Last Name"
                        placeholder="Morgan"
                        size="xs"
                        leftSection={<IconUser size={14} />}
                        {...form.getInputProps("lastName")}
                        styles={{
                          input: {
                            backgroundColor: isDark ? "#0f121a" : "#fdfdfd",
                            borderColor: isDark ? "#2d3342" : "#ced4da",
                          },
                        }}
                      />
                    </Group>

                    <TextInput
                      label="Email"
                      placeholder="alex.morgan@company.com"
                      required
                      size="xs"
                      leftSection={<IconMail size={14} />}
                      {...form.getInputProps("email")}
                      styles={{
                        input: {
                          backgroundColor: isDark ? "#0f121a" : "#fdfdfd",
                          borderColor: isDark ? "#2d3342" : "#ced4da",
                        },
                      }}
                    />

                    <Group grow>
                      <PasswordInput
                        label="Password"
                        placeholder="At least 8 characters"
                        required
                        size="xs"
                        leftSection={<IconLock size={14} />}
                        {...form.getInputProps("password")}
                        styles={{
                          input: {
                            backgroundColor: isDark ? "#0f121a" : "#fdfdfd",
                            borderColor: isDark ? "#2d3342" : "#ced4da",
                          },
                        }}
                      />

                      <PasswordInput
                        label="Confirm Password"
                        placeholder="Re-enter password"
                        required
                        size="xs"
                        leftSection={<IconLock size={14} />}
                        {...form.getInputProps("confirmPassword")}
                        styles={{
                          input: {
                            backgroundColor: isDark ? "#0f121a" : "#fdfdfd",
                            borderColor: isDark ? "#2d3342" : "#ced4da",
                          },
                        }}
                      />
                    </Group>

                    <Button
                      type="submit"
                      color="red"
                      size="md"
                      fullWidth
                      loading={submitting}
                      rightSection={<IconArrowRight size={16} />}
                      style={{
                        backgroundColor: "#EE0000",
                        marginTop: "0.5rem",
                      }}
                    >
                      Create Account
                    </Button>
                  </Stack>
                </form>

                <Paper
                  p="sm"
                  radius="sm"
                  style={{
                    backgroundColor: isDark ? "#0d1017" : "#f6f8fa",
                    border: `1px solid ${isDark ? "#21262d" : "#e1e4e8"}`,
                    textAlign: "center",
                  }}
                >
                  <Text size="xs" c="dimmed">
                    Already have an account?{" "}
                    <Anchor component={Link} to="/login" fw={600} style={{ color: "#EE0000" }}>
                      Log in here
                    </Anchor>
                  </Text>
                </Paper>
              </Stack>
            </Grid.Col>
          </Grid>
        </Paper>
      </Center>
    </Box>
  );
}
