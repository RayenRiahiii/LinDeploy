import { Center, Loader, Stack, Text } from "@mantine/core";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export default function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
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

  return <Outlet />;
}
