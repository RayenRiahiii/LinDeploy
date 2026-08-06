import { type InstallerId, getInstallerLogo } from "../../features/installers/catalog";

type InstallerLabelProps = {
  label: string;
  withLogo?: boolean;
  installerId?: InstallerId | null;
  className?: string;
};

export default function InstallerLabel({
  label,
  withLogo,
  installerId,
  className,
}: InstallerLabelProps) {
  return (
    <span className={className ? `installer-label-inline ${className}` : "installer-label-inline"}>
      {withLogo && (
        <img
          src={getInstallerLogo(installerId)}
          alt=""
          className="template-logo-inline"
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
    </span>
  );
}
