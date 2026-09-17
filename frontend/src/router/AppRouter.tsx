import { Navigate, Route, Routes } from "react-router-dom";
import AppShellLayout from "../layouts/AppShellLayout";
import CredentialsPage from "../pages/CredentialsPage";
import DashboardPage from "../pages/DashboardPage";
import ExecutionDetailsPage from "../pages/ExecutionDetailsPage";
import ExecutionsPage from "../pages/ExecutionsPage";
import HistoryPage from "../pages/HistoryPage";
import HostsPage from "../pages/HostsPage";
import InstallersPage from "../pages/InstallersPage";
import K3sInstallerPage from "../pages/K3sInstallerPage";
import KubernetesInstallerPage from "../pages/KubernetesInstallerPage";
import OpenShiftSNOInstallerPage from "../pages/OpenShiftSNOInstallerPage";

type AppRouterProps = {
  colorScheme: "dark" | "light";
  onToggleColorScheme: () => void;
};

export default function AppRouter({ colorScheme, onToggleColorScheme }: AppRouterProps) {
  return (
    <Routes>
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
    </Routes>
  );
}
