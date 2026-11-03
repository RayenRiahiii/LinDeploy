import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Center, Loader } from "@mantine/core";
import ProtectedRoute from "../components/auth/ProtectedRoute";
import AppShellLayout from "../layouts/AppShellLayout";

const CredentialsPage = lazy(() => import("../pages/CredentialsPage"));
const DashboardPage = lazy(() => import("../pages/DashboardPage"));
const ExecutionDetailsPage = lazy(() => import("../pages/ExecutionDetailsPage"));
const ExecutionsPage = lazy(() => import("../pages/ExecutionsPage"));
const HistoryPage = lazy(() => import("../pages/HistoryPage"));
const HostsPage = lazy(() => import("../pages/HostsPage"));
const InstallersPage = lazy(() => import("../pages/InstallersPage"));
const K3sInstallerPage = lazy(() => import("../pages/K3sInstallerPage"));
const KubernetesInstallerPage = lazy(() => import("../pages/KubernetesInstallerPage"));
const LoginPage = lazy(() => import("../pages/LoginPage"));
const OpenShiftSNOInstallerPage = lazy(() => import("../pages/OpenShiftSNOInstallerPage"));
const SignUpPage = lazy(() => import("../pages/SignUpPage"));

function PageFallback() {
  return (
    <Center style={{ minHeight: "50vh", width: "100%" }}>
      <Loader size="lg" color="red" />
    </Center>
  );
}

type AppRouterProps = {
  colorScheme: "dark" | "light";
  onToggleColorScheme: () => void;
};

export default function AppRouter({ colorScheme, onToggleColorScheme }: AppRouterProps) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route
          path="/login"
          element={<LoginPage colorScheme={colorScheme} onToggleColorScheme={onToggleColorScheme} />}
        />
        <Route
          path="/signup"
          element={<SignUpPage colorScheme={colorScheme} onToggleColorScheme={onToggleColorScheme} />}
        />

        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<AppShellLayout colorScheme={colorScheme} onToggleColorScheme={onToggleColorScheme} />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="hosts" element={<HostsPage />} />
            <Route path="credentials" element={<CredentialsPage />} />
            <Route path="installers" element={<InstallersPage />} />
            <Route path="installers/kubernetes" element={<KubernetesInstallerPage />} />
            <Route path="installers/k3s" element={<K3sInstallerPage />} />
            <Route path="installers/openshift-sno" element={<OpenShiftSNOInstallerPage />} />
            <Route path="executions" element={<ExecutionsPage />} />
            <Route path="executions/:id" element={<ExecutionDetailsPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
