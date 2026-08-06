import RunDeployment from "./RunDeployment";

export default function K3sInstallerPage() {
  return <RunDeployment forcedInstaller="k3s" mode="installer" />;
}
