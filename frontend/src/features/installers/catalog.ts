import kubernetesLogo from "../../assets/kubernetes-logo.svg";
import k3sLogo from "../../assets/k3s-logo.png";
import openshiftLogo from "../../assets/openshift-logo.svg";

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
    description: "Agent-based Single Node OpenShift workflow for a KVM/libvirt virtual machine.",
    availability: "available",
    route: "/installers/openshift-sno",
  },
];

export function getInstallerLogo(installerId?: InstallerId | null) {
  if (installerId === "k3s") {
    return k3sLogo;
  }

  if (installerId === "openshift_sno") {
    return openshiftLogo;
  }

  return kubernetesLogo;
}

export function getInstallerOption(installerId?: InstallerId | null) {
  return installerOptions.find((installer) => installer.id === installerId) || installerOptions[0];
}
