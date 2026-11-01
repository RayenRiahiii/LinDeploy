import { Button, Center, Loader, Stack, Text } from "@mantine/core";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/AuthContext";

export default function ProtectedRoute() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const { i18n } = useTranslation();
  const location = useLocation();

  if (isLoading) {
    return (
      <Center style={{ minHeight: "100vh", backgroundColor: "var(--mantine-color-body)" }}>
        <Stack align="center" gap="md">
          <Loader size="lg" color="red" />
          <Text size="sm" c="dimmed" fw={500}>
            Validating enterprise session...
          </Text>
        </Stack>
      </Center>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!user?.can_operate) {
    const french = i18n.language.startsWith("fr");
    return <Center mih="100vh"><Stack align="center" maw={520} p="xl">
      <Text fw={600}>{french ? "Autorisation nécessaire" : "Authorization required"}</Text>
      <Text ta="center">{french
        ? "Votre compte est créé. Un administrateur doit autoriser votre accès aux opérations d’infrastructure."
        : "Your account is registered. An administrator must authorize your access to infrastructure operations."}</Text>
      <Button onClick={logout}>{french ? "Se déconnecter" : "Sign out"}</Button>
    </Stack></Center>;
  }
  return <Outlet />;
}
