import kubernetesLogo from "../../assets/kubernetes-logo.svg";
import k3sLogo from "../../assets/k3s-logo.png";

export type InstallerId = "kubernetes" | "k3s" | "openshift_sno";

export type InstallerOption = {
  id: InstallerId;
  label: string;
  description: string;
  availability: "available" | "coming_soon";
  route: string;
};

export const installerOptions: InstallerOption[] = [
  {
    id: "kubernetes",
    label: "Kubernetes",
    description: "Single-node kubeadm workflow with host precheck, installer monitoring, and post-install validation.",
    availability: "available",
    route: "/installers/kubernetes",
  },
  {
    id: "k3s",
    label: "K3s",
    description: "Lightweight Kubernetes distribution for smaller footprints and faster bootstrap.",
    availability: "available",
    route: "/installers/k3s",
  },
  {
    id: "openshift_sno",
    label: "OpenShift SNO",
    description: "Single Node OpenShift workflow for edge and compact control-plane use cases.",
    availability: "coming_soon",
    route: "/installers/openshift-sno",
  },
];

export function getInstallerLogo(installerId?: InstallerId | null) {
  if (installerId === "k3s") {
    return k3sLogo;
  }

  return kubernetesLogo;
}

export function getInstallerOption(installerId?: InstallerId | null) {
  return installerOptions.find((installer) => installer.id === installerId) || installerOptions[0];
}
