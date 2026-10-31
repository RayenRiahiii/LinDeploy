# LinDeploy Smart LAN Mirror

> The LAN cache and the permanent OpenShift disconnected mirror have separate
> storage and retention lifecycles. Never point them at the same volume.

## Goal

The mirror reduces repeated Internet downloads without changing Kubernetes or
K3s image names:

```text
target -> LAN mirror -> official upstream when the object is not cached
```

The first installation fills the cache. Later installations read the same
content over the LAN. If Internet is unavailable, already cached objects remain
usable. An object that has never been cached still requires upstream access.

## Why several endpoints are required

OCI registries have independent namespaces. A pull-through Distribution cache
has one upstream, so the mirror server runs one cache endpoint per upstream:

| Upstream | Suggested mirror endpoint |
| --- | --- |
| `registry.k8s.io` | `https://mirror.lan:5001` |
| `quay.io` | `https://mirror.lan:5002` |
| `docker.io` | `https://mirror.lan:5003` |

The same VM may expose all three endpoints. This is one LinDeploy mirror
service operationally, not three modes offered to users.

Raw files and package repositories use a normal HTTP caching reverse proxy on
the same VM. Suggested paths are:

```text
https://mirror.lan/cache/get.k3s.io
https://mirror.lan/cache/update.k3s.io/v1-release/channels
https://mirror.lan/cache/github-k3s/releases/download
https://mirror.lan/cache/raw-github/projectcalico/calico
https://mirror.lan/cache/download.docker.com
https://mirror.lan/cache/pkgs.k8s.io
```

## Security requirements

1. Use a permanent Linux VM with a stable IP and DNS name.
2. Use TLS. The certificate must include the mirror DNS name and IPs used by
   targets.
3. Use a CA already trusted by targets, or configure its PEM path through
   `LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE`.
4. Do not enable `skip_verify` or disable RPM/APT GPG checks.
5. Restrict mirror ports to the workshop/cluster LAN with the host firewall.
6. Back up the mirror configuration; cached data itself can be rebuilt.

LinDeploy keeps OCI upstream fallback enabled. containerd tries the mirror
first with a short connection timeout, then the official registry. K3s keeps
its default registry endpoint enabled as the fallback.

## Backend configuration

Configure `backend/.env` after the mirror endpoints are reachable:

```dotenv
LINDEPLOY_MIRROR_ENABLED=True
LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP=False
LINDEPLOY_REGISTRY_MIRRORS_JSON={"registry.k8s.io":"https://mirror.lan:5001","quay.io":"https://mirror.lan:5002","docker.io":"https://mirror.lan:5003"}
LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE=C:\path\to\mirror-ca.crt

LINDEPLOY_K3S_INSTALL_SCRIPT_URL=https://mirror.lan/cache/get.k3s.io
LINDEPLOY_K3S_CHANNEL_URL=https://mirror.lan/cache/update.k3s.io/v1-release/channels
LINDEPLOY_K3S_ARTIFACT_URL=https://mirror.lan/cache/github-k3s/releases/download
LINDEPLOY_CALICO_MANIFEST_URL=https://mirror.lan/cache/raw-github/projectcalico/calico/v3.32.0/manifests/calico.yaml
LINDEPLOY_KUBERNETES_RPM_BASEURL=https://mirror.lan/cache/pkgs.k8s.io/core:/stable:/v1.36/rpm/
LINDEPLOY_KUBERNETES_RPM_GPGKEY=https://mirror.lan/cache/pkgs.k8s.io/core:/stable:/v1.36/rpm/repodata/repomd.xml.key

# Optional package-cache endpoints. Keep them empty until the corresponding
# reverse-proxy routes have been tested with DNF/APT and GPG verification.
LINDEPLOY_CONTAINERD_RPM_BASEURL=
LINDEPLOY_CONTAINERD_RPM_GPGKEY=
LINDEPLOY_CONTAINERD_APT_REPO_URL=
LINDEPLOY_CONTAINERD_APT_KEY_URL=
LINDEPLOY_KUBERNETES_APT_REPO_URL=
LINDEPLOY_KUBERNETES_APT_KEY_URL=
```

Restart Django and the Celery worker after changing `.env`. Mirror settings are
global and are not exposed as per-installation user fields.

## What LinDeploy configures on targets

For kubeadm Kubernetes, the containerd role writes registry-specific
`hosts.toml` files below `/etc/containerd/certs.d` and preserves the official
registry as fallback. The CA is used only when supplied.

For K3s, the role merges mirror endpoints into
`/etc/rancher/k3s/registries.yaml`. Existing private-registry configuration is
preserved. K3s artifact and channel URLs are passed to the official installer,
which still verifies the downloaded binary against its SHA-256 manifest.

RPM and APT signature checking remains enabled. A local package cache changes
the transport endpoint, not the trust policy.

For supported CentOS Stream 9, Rocky Linux 9, AlmaLinux 9, Ubuntu, and Debian
targets, the `common` role probes the cache before package installation. It
uses temporary package-manager configuration and removes it in an `always`
block. If the cached transaction fails, the role removes the temporary APT
configuration where applicable and retries against the original repositories.
Unsupported distributions keep their existing repository behavior.

For RPM distributions, the probe is a cache-only completeness check. A cached
`repomd.xml` alone is not sufficient because DNF also needs every metadata file
referenced by that document. The artifact gateway downloads and verifies those
references before publishing a new snapshot. `/cache-ready/` returns `200`
only for a complete snapshot and `503` immediately for an incomplete one. This
prevents a group of targets from waiting on the same cold-cache miss during an
installation.

## Validation and cache warm-up

Before enabling the backend setting, test from every target network:

```bash
curl --fail --show-error https://mirror.lan:5001/v2/
curl --fail --show-error https://mirror.lan:5002/v2/
curl --fail --show-error https://mirror.lan:5003/v2/
curl --fail --show-error https://mirror.lan/cache/get.k3s.io >/dev/null
```

Prewarm each installer explicitly while the mirror has Internet access:

```powershell
.\prewarm.ps1 -ServerIp 192.168.1.60 -Component Kubernetes -Version v1.36.3
.\prewarm.ps1 -ServerIp 192.168.1.60 -Component K3s -Version 'v1.36.2+k3s1'
```

Normal operation is automatic. `sync-network.ps1` queues an initial stable
release check, then Celery Beat runs the same idempotent check every 24 hours.
`auto-prewarm.ps1` records active and available versions in
`infra/mirror/runtime/prewarm-state.json`; an available version becomes ready
only after its complete component prewarm succeeds. Operators can inspect and
trigger this process from the LinDeploy Dashboard.

Then run the installations and compare the task profile: image pulls and K3s
artifact downloads should become LAN-speed operations.

Finally, temporarily block the mirror VM's Internet egress and repeat only with
the same pinned versions. Success proves that the required objects are cached.
Changing Kubernetes, K3s, Calico, or package versions introduces new objects
that must be warmed before a disconnected workshop.

## Immutable profiles and readiness

The legacy `prewarm-state.json` remains a display/PowerShell compatibility
file. Authoritative readiness is now stored in Django as immutable
`MirrorProfile` records and durable `MirrorPrewarmJob` transitions. A profile
contains the exact platform version, architecture, OS scope, packages, OCI
objects, artifacts, hashes, provenance, total size and content-generation ID.

Set the exact requested profiles in `backend/.env`:

```dotenv
LINDEPLOY_KUBERNETES_PROFILE_ID=kubernetes-v1.36.3-amd64-all-supported
LINDEPLOY_K3S_PROFILE_ID=k3s-v1.36.3+k3s1-amd64-all-supported
LINDEPLOY_MIRROR_CACHE_REQUIRED=True
```

With cache-required mode enabled, an installation is refused before Ansible is
started unless the exact profile is `ready`. Online fallback remains available
when this setting is false. A manifest filename alone never proves readiness:
prewarm verifies downloaded objects and records their hashes and sizes; the
backend then validates the manifest hash, identity, asset count, and each
recorded digest/size before committing profile and job state transactionally.

## Cache storage and concurrency

Raw artifacts are indexed in `/var/cache/lindeploy/index.sqlite3` using SQLite
WAL and full synchronous commits. Data and metadata are written to unique
temporary files, flushed with `fsync`, and atomically renamed. Sixty-four
striped locks bound memory use. SQLite coordinates eviction across processes;
objects that are pinned, downloading, or actively served are not evicted.

Capacity is admitted before a download when `Content-Length` is available and
enforced while streaming. Configure:

```dotenv
MIRROR_CACHE_MAX_BYTES=12884901888
MIRROR_CACHE_RESERVED_FREE_BYTES=2147483648
MIRROR_CACHE_MAX_OBJECT_BYTES=4294967296
MIRROR_MAX_WORKERS=32
```

Use this planning formula:

```text
required filesystem = pinned profiles + working generation + retention headroom
                    + reserved free space + 20% operational margin
```

OpenShift requires a separately sized permanent registry, normally hundreds of
GiB; it is not included in this disposable-cache formula.

## HTTP and network policy

The gateway supports normal, open-ended and suffix byte ranges; invalid or
multi-ranges return `416`. Responses expose cache age/status, local verification
status and profile ID. Security metadata is never served stale after a failed
refresh. Immutable payloads may be served stale during a temporary upstream
failure and carry HTTP `Warning: 110`.

Nginx restricts access to RFC1918 and Tailscale target ranges, limits requests
and connections, and bounds headers/timeouts. Adapt both `nginx.conf` and
`configure-firewall.ps1` when using a different management CIDR. Containers
use dropped capabilities, no-new-privileges, bounded PID/CPU/memory and rotated
logs; writable paths are explicit volumes or tmpfs.

## Migration from the legacy cache

1. Back up `infra/mirror/runtime` and record active profile versions.
2. Run Django migrations; this creates profile/job tables without deleting the
   legacy JSON state.
3. Rebuild the artifact-cache image so `cache_store.py` is included.
4. Start the stack and call `/readyz`; existing cache files are indexed lazily
   on first access.
5. Run prewarm once per required exact profile. Only then enable
   `LINDEPLOY_MIRROR_CACHE_REQUIRED=True`.

## Operational runbook

- **Prewarm:** trigger once, retain the returned job ID, and wait for `ready`.
  Duplicate requests reuse the active job.
- **Verify:** check `/healthz`, `/readyz`, `/metrics`, profile status, free space,
  then install on a disposable target with Internet egress blocked.
- **Eviction:** unpin an obsolete profile first; active generations and served
  objects are protected.
- **Backup:** back up profile manifests, certificates, configuration and Django
  DB. Raw cache payloads are reconstructable.
- **Recovery:** preserve the failed job/correlation ID and `prewarm.log`; remove
  only quarantined temporary files, restart, then rerun the same profile.
- **Certificate rotation:** issue the new certificate, distribute/trust its CA,
  replace gateway files atomically, restart nginx, and test every target LAN.
- **Cache reset:** stop the stack, replace only the disposable artifact volume,
  restart, verify `/readyz`, invalidate affected profiles and prewarm again.

## Important limitation

This is a pull-through cache, not a guaranteed fully air-gapped bundle. A fully
disconnected release needs a version manifest, preloaded images/packages, and a
cache completeness check. The same mirror VM and TLS/DNS design can later host
the OpenShift release images and RHCOS/Agent ISO artifacts.
# System Package Cache

LinDeploy also exposes allow-listed cache routes for the official base package
repositories used by supported target operating systems:

- CentOS Stream 9, Rocky Linux 9, and AlmaLinux 9 RPM repositories;
- Ubuntu and Debian APT repositories;
- Docker RPM/APT repositories used to install containerd;
- the versioned Kubernetes repository at `pkgs.k8s.io`.

Package indexes use a configurable one-hour TTL. Immutable package payloads are
retained until the cache size policy evicts the oldest content. Repository and
signature metadata is never served stale after a failed refresh. RPM GPG and
APT Release signature verification remain the responsibility of DNF/APT and
must never be disabled.

The cache is progressive for package payloads, but RPM metadata snapshots are
atomic. A successful `/cache-ready/` response proves that the repository index
is coherent; it does not prove that every transitive RPM dependency is already
stored. Kubernetes prewarm caches the supported Red Hat-family BaseOS and
AppStream metadata, the base packages selected by LinDeploy, Docker's GPG key,
Docker repository metadata, and `containerd.io`. The first installation of a
new distribution/release combination can still fetch an uncached transitive
dependency through the mirror; later equivalent installations use it at LAN
speed.
