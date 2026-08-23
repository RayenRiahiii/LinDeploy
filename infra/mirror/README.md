# LinDeploy Local Mirror Stack

This stack runs directly on the LinDeploy Windows server through Docker
Desktop. It exposes TLS services on the server LAN address:

- `5001`: pull-through cache for `registry.k8s.io`;
- `5002`: pull-through cache for `quay.io`;
- `5003`: pull-through cache for `docker.io`;
- `8443`: fixed-route artifact and package cache.

The package cache accepts only explicitly allow-listed official upstreams. It
currently supports Kubernetes and Docker packages plus the base repositories
for CentOS Stream, Rocky Linux, AlmaLinux, Ubuntu, and Debian. RPM repository
metadata is published as an atomic snapshot: a new `repomd.xml` is not exposed
until every metadata file referenced by it is cached. If an upstream is
temporarily unavailable, the last complete cached snapshot remains available
so an already prewarmed workshop can continue.

The gateway never accepts an arbitrary upstream URL. Supported cache routes
are limited in `artifact-cache/mirror_gateway.py` to the sources needed by
LinDeploy.

## Start

Run PowerShell from this directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -ServerIp 192.168.1.60 -DnsName lindeploy-mirror.local
powershell -ExecutionPolicy Bypass -File .\start.ps1
powershell -ExecutionPolicy Bypass -File .\test.ps1 -ServerIp 192.168.1.60
```

The first complete test also warms the Kubernetes pause image and can take a
few minutes on a slow Internet link. The repeated request must then complete
from the local cache in less than five seconds. Use `-SkipImageProbe` only for
a quick service-health check.

## When the server changes network

Run this command after connecting the LinDeploy server to another Wi-Fi or LAN:

```powershell
powershell -ExecutionPolicy Bypass -File .\sync-network.ps1
```

The script detects the IPv4 address attached to the active default route and
the corresponding subnet. It keeps the existing private CA, renews the mirror
server certificate for the detected address, updates the restricted Windows
Firewall rules, starts Docker Desktop if necessary, updates every mirror URL in
`backend/.env`, restarts Django/Redis/Celery, and runs the mirror health tests.
An administrator confirmation can appear when the firewall rules are updated.

The automatic mode is appropriate when the active default route is the LAN
used by target machines. To select another address explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\sync-network.ps1 `
  -ServerIp 192.168.100.37
```

Reserve a stable DHCP address or use the DNS name for a permanent production
deployment. Automatic IP synchronization is useful for a mobile lab server,
but active target installations must never be interrupted by a network change.

Preload Kubernetes/Calico and K3s independently with an explicit release before
a workshop or a large deployment:

```powershell
powershell -ExecutionPolicy Bypass -File .\prewarm.ps1 `
  -ServerIp 192.168.1.60 `
  -Component Kubernetes `
  -Version v1.36.3 `
  -CalicoVersion v3.32.0

powershell -ExecutionPolicy Bypass -File .\prewarm.ps1 `
  -ServerIp 192.168.1.60 `
  -Component K3s `
  -Version 'v1.36.2+k3s1'
```

`-Component All` remains available for prewarming both installers with the
default versions. An explicit `-Version` is intentionally accepted only with a
single component, preventing one version value from being applied to two
different release formats.

The first prewarm uses Internet bandwidth and can take a long time when an
official RPM mirror is slow. It runs outside target installation workflows and
retains every object already downloaded if a later upstream request fails.
The controller requires Python 3.14 or newer to decode current RPM repository
metadata published with Zstandard compression (`primary.xml.zst`). Both the
project virtual environment and the system Python used by `prewarm.ps1` should
meet this requirement.
Later installations obtain the same content over the LAN. Kubernetes prewarm
also creates complete BaseOS/AppStream snapshots for CentOS Stream 9, Rocky
Linux 9, and AlmaLinux 9, and caches Docker's GPG key, repository metadata, and
the current `containerd.io` RPM. K3s prewarm also caches the signed Rancher
`k3s-selinux` repository. Run it again when upgrading Kubernetes, Calico, K3s,
the target distribution, or the target CPU architecture.

Run PowerShell as Administrator once to permit target access through Windows
Firewall. The script is idempotent and limits access to the LAN subnet:

```powershell
powershell -ExecutionPolicy Bypass -File .\configure-firewall.ps1 -LanSubnet 192.168.100.0/24
```

Reserve `192.168.1.60` in DHCP before relying on the generated certificate.
If the address changes, regenerate the server certificate and update
`backend/.env`.

## Backend endpoints

Use these values in `backend/.env` after `test.ps1` succeeds:

```dotenv
LINDEPLOY_MIRROR_ENABLED=True
LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP=False
LINDEPLOY_REGISTRY_MIRRORS_JSON={"registry.k8s.io":"https://192.168.1.60:5001","quay.io":"https://192.168.1.60:5002","docker.io":"https://192.168.1.60:5003"}
LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE=C:\Users\ASUS\Desktop\LinDeploy\infra\mirror\runtime\certs\ca.crt
LINDEPLOY_K3S_INSTALL_SCRIPT_URL=https://192.168.1.60:8443/cache/get.k3s.io/
LINDEPLOY_K3S_CHANNEL_URL=https://192.168.1.60:8443/cache/update.k3s.io/v1-release/channels
LINDEPLOY_K3S_ARTIFACT_URL=https://192.168.1.60:8443/cache/github.com/k3s-io/k3s/releases/download
LINDEPLOY_CALICO_MANIFEST_URL=https://192.168.1.60:8443/cache/raw.githubusercontent.com/projectcalico/calico/v3.32.0/manifests/calico.yaml
LINDEPLOY_KUBERNETES_RPM_BASEURL=https://192.168.1.60:8443/cache/pkgs.k8s.io/core:/stable:/v1.36/rpm/
LINDEPLOY_KUBERNETES_RPM_GPGKEY=https://192.168.1.60:8443/cache/pkgs.k8s.io/core:/stable:/v1.36/rpm/repodata/repomd.xml.key
```

When `LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED=True`, the `common` role first
checks the cache-only `/cache-ready/` endpoint for both BaseOS and AppStream.
This check returns immediately and the role uses the local RPM repositories
only when both snapshots are complete. It then creates temporary,
signature-checked package sources for that transaction only. The temporary
files are always removed. An incomplete cache is skipped without waiting for
the mirror to download missing metadata, and LinDeploy uses the target's
original signed repositories. If a complete cache cannot finish the package
transaction, LinDeploy retries once with those original repositories.

The first request for an RPM or DEB that is not cached still uses Internet on
the mirror server. Repeated installations of the same distribution and version
then receive that payload over the LAN. Run `prewarm.ps1` before workshops.
Multiple targets never consume a partially built RPM snapshot: they either use
the complete LAN snapshot or fall back independently to their original signed
repositories.

## Automatic stable-version prewarm

`sync-network.ps1` starts Django, the Celery worker, and Celery Beat. It queues
one initial version check and Celery Beat repeats it every 24 hours. The wrapper
resolves the current stable Kubernetes patch and K3s release through the local
artifact gateway, compares them with `runtime/prewarm-state.json`, and only
downloads a component when its stable version changed.

Every successful component prewarm writes an atomic asset manifest under
`runtime/manifests/`. The manifest records the selected version, architecture,
cached object count, sizes, and SHA-256 digests returned by the mirror. The
component is marked `ready` only when this non-empty manifest exists and its own
SHA-256 matches `prewarm-state.json`. Missing mandatory RPM payloads, including
`containerd.io`, fail the prewarm without replacing the previously usable
cache. Kubernetes installations then ask `kubeadm` for the exact control-plane
version recorded by the verified mirror state, avoiding an unexpected Internet
pull after a stable patch release changes upstream.

For an explicit controller-side check:

```powershell
powershell -ExecutionPolicy Bypass -File .\auto-prewarm.ps1
```

Use `-Force` only to rebuild already-ready cache content. A failed prewarm keeps
the previously ready version recorded as active and exposes the error in the
Dashboard.

Cached package payloads are revalidated every five minutes with a lightweight
upstream `HEAD` request. Unchanged files remain local; a file replaced upstream
under the same URL is refreshed before DNF or APT receives it. Package-manager
signature and checksum validation remains enabled on every target.

## System repository cache validation

`test.ps1` validates one signed metadata document for every supported package
family. This confirms transport and cache behavior; it does not replace package
manager signature validation on the targets.

```powershell
powershell -ExecutionPolicy Bypass -File .\test.ps1 `
  -ServerIp 192.168.1.60 `
  -SkipImageProbe
```

Expected checks include CentOS Stream 9, Rocky Linux 9, AlmaLinux 9, Ubuntu
Jammy, Debian Bookworm, and the Docker repositories. Do not enable
`LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED` until all checks are successful.
LinDeploy never permanently redirects a target's DNF or APT configuration.

## Storage

Raw artifacts are capped at 12 GiB and oldest entries are removed first. OCI
content is deduplicated and garbage collection is enabled. Check usage
regularly:

```powershell
docker system df -v
docker compose logs --tail 100
```

Do not run `docker compose down -v` unless all cached data should be destroyed.
