import RunDeployment from "./RunDeployment";

export default function KubernetesInstallerPage() {
  return <RunDeployment forcedInstaller="kubernetes" mode="installer" />;
}
