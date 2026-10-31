# Deterministic Platform and Cache Hardening

This document records the validation boundary for the
`hardening/deterministic-platform-cache` branch.

## Implemented controls

- Every managed host has a stable LinDeploy UUID independent of its inventory name.
- Installation writes a prepared ownership manifest and activates it only after a
  successful platform deployment.
- Cleanup requires explicit approval, the exact target and cluster confirmation,
  and a valid ownership manifest matching machine, platform, cluster, and resource
  identifiers.
- Emergency force cleanup remains disabled. Generic paths and interfaces are not
  removed unless they are recorded as LinDeploy-owned resources.
- Kubernetes and K3s release files use explicit versions and trusted checksums.
- Production defaults keep SELinux enforcing and manage firewalld instead of
  disabling either control.
- Mirror profiles are immutable database records keyed by platform, exact version,
  architecture, operating-system family, and manifest digest.
- Prewarm jobs are durable and deduplicated. A cache-required deployment refuses to
  start when its exact verified profile is unavailable.
- The artifact cache uses SQLite WAL, full synchronization, atomic replacement,
  bounded object size and capacity, reserved free space, protected pinned objects,
  atomic repository generations, and correct single-range responses.
- The proxy limits trusted LAN sources, request rate, concurrent connections,
  headers, and timeouts. Containers run with restricted capabilities, PIDs, logs,
  and writable paths.

## Automated validation

Run from the repository root unless noted otherwise:

```powershell
cd backend
.\.venv\Scripts\python.exe manage.py test auto_K8S
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe manage.py migrate --noinput

cd ..\frontend
npm.cmd run lint
npm.cmd run build

cd ..\infra\mirror\artifact-cache
python -m unittest discover -s tests -v

cd ..
docker compose config --quiet
```

Validate every playbook from WSL with the repository role path set explicitly:

```bash
cd /mnt/c/Users/ASUS/Desktop/LinDeploy/backend/backend/Playbooks
export ANSIBLE_ROLES_PATH="$PWD/roles"
for playbook in playbooks/*.yml; do
  ansible-playbook --syntax-check "$playbook" || exit 1
done
```

## Load and failure validation

Run load tests only on an isolated mirror instance containing disposable cache
data. A representative LAN test is:

```bash
hey -z 60s -c 32 https://mirror.example.test:8443/cache/get.k3s.io/
```

Acceptance criteria:

- no unexpected HTTP 5xx responses;
- `/readyz` remains ready and SQLite `quick_check` remains `ok`;
- memory and disk usage remain within configured limits;
- concurrent requests for one absent object create one complete cached object;
- pinned profile objects remain present during concurrent eviction;
- interruption during download leaves no object visible as ready;
- restart preserves the index, active generations, and verified profiles.

## Required real-target qualification

The following checks require disposable Ubuntu, CentOS Stream, and Rocky Linux
targets and are intentionally not simulated on the controller:

1. Run each installation twice and confirm the second run has no unsafe changes.
2. Run reset and full uninstall twice; the second cleanup must report `changed=0`.
3. Interrupt SSH, containerd, kubelet, and K3s during controlled test runs and
   confirm deterministic recovery or a clear resumable failure.
4. Verify SELinux remains enforcing and only documented firewalld rules exist.
5. Attempt cleanup with a wrong target, cluster, machine ID, and ownership manifest;
   every attempt must fail before destructive work.

`ansible-lint` must also be run in CI or a development environment where it is
installed. It is not bundled into the controller environment.

## Known release-profile boundary

The release files pin the versions and checksums currently qualified by LinDeploy.
Adding another operating-system build, containerd package revision, Kubernetes
image set, K3s version, or architecture requires a new reviewed profile. Production
mode must not silently substitute `latest`, `stable`, a mutable tag, or a package
revision from another distribution.
