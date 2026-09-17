# LinDeploy

LinDeploy is a web control plane for deploying and removing Linux cluster platforms on remote machines through Ansible.

The current release supports:

- Kubernetes with kubeadm, containerd, and Calico;
- K3s;
- one independent single-node cluster per selected target;
- one shared Kubernetes multi-node cluster with explicit control-plane, worker,
  and bootstrap host selection;
- multi-target execution with per-host results and partial-success reporting;
- SSH connectivity checks before execution;
- Kubernetes reset and full uninstall workflows;
- K3s cleanup and uninstall;
- conflict protection between Kubernetes and K3s;
- live execution progress, history, cancellation, and diagnostics.
- optional LAN pull-through caching for OCI images, K3s artifacts, Calico,
  and package repositories.
- connected OpenShift SNO provisioning on KVM/libvirt through the hosted
  Assisted Installer;
- disconnected OpenShift SNO provisioning through a permanent local Quay
  registry, `oc-mirror` v2, and the Agent-Based Installer;
- ownership-checked OpenShift VM cleanup that preserves mirrored content.

OpenShift support is intentionally limited to one x86_64 SNO virtual machine on
a selected KVM/libvirt provisioning host. A real deployment still requires a
Red Hat subscription, correct DNS, sufficient resources, and controlled
validation on non-production infrastructure.

> **Current maturity:** LinDeploy is suitable for controlled labs, workshops, and development environments. Do not expose it directly to an untrusted network. See [Security](SECURITY.md).

## Architecture

```text
Browser
   |
   v
React + Vite frontend
   |
   v
Django REST API ---- PostgreSQL or SQLite
   |
   v
Celery worker ---- Redis
   |
   v
Ansible controller (Linux or Windows + WSL)
   |
   +---- SSH ---- Target 1 -> independent single-node cluster
   +---- SSH ---- Target 2 -> independent single-node cluster
   +---- SSH ---- Target N -> independent single-node cluster
```

For Kubernetes multi-node deployments, the same controller generates role-based
inventory groups and creates one shared cluster. K3s currently retains the
single-node-per-target behavior.

## Repository Layout

```text
LinDeploy/
|-- backend/
|   |-- auto_K8S/                 # Django domain models, API, services, tasks
|   |-- backend/                  # Django project settings and Celery config
|   |   `-- Playbooks/            # Embedded Ansible repository
|   |       |-- ansible.cfg
|   |       |-- playbooks/
|   |       `-- roles/
|   |-- manage.py
|   `-- requirements.txt
|-- frontend/                     # React, TypeScript, Mantine, Vite
|   `-- src/
|       |-- components/           # Reusable CRUD, deployment, host, and credential UI
|       |-- features/             # Domain catalogs and presentation rules
|       |-- lib/                  # Shared API helpers
|       `-- pages/                # Route-level composition only
|-- docs/
|   |-- ARCHITECTURE.md
|   |-- INSTALLATION.md
|   |-- MANUEL_UTILISATION.md
|   `-- TROUBLESHOOTING.md
|-- SECURITY.md
`-- README.md
```

The internal Django application is still named `auto_K8S` for migration compatibility. The product and repository name are LinDeploy.

## Supported Controller Modes

- Windows with WSL: Django and the frontend run on Windows; Ansible runs in WSL.
- Native Linux: Django, Celery, Redis, and Ansible run directly on Linux.

## Supported Targets

The playbooks contain package and service handling for:

- Red Hat family: CentOS Stream 9, Rocky Linux 9, and compatible RHEL 9 systems;
- Debian family: Ubuntu and compatible Debian-based systems.

The target must provide:

- SSH access;
- Python 3;
- a user allowed to use `sudo`;
- outbound access to the package and container registries used by the selected installer;
- at least 2 vCPU and 2 GB RAM; 4 vCPU and 4 GB RAM are recommended for a more reliable Kubernetes lab.

## Quick Start

Detailed prerequisites and platform-specific commands are in [Installation Guide](docs/INSTALLATION.md).

### 1. Configure the backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python manage.py migrate
python manage.py runserver
```

### 2. Start Redis and Celery

Redis must be reachable at the URL configured by `CELERY_BROKER_URL`.

From a second terminal in `backend/`:

```powershell
.\.venv\Scripts\Activate.ps1
celery -A backend worker --loglevel=info --pool=solo
```

In a second terminal, start the periodic scheduler used by automatic mirror
prewarming:

```powershell
celery -A backend beat --loglevel=info
```

Use the default prefork worker on native Linux:

```bash
celery -A backend worker --loglevel=info
```

### 3. Start the frontend

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173`.

## First Deployment

1. Create an SSH credential.
2. Register one or more target hosts and associate the credential.
3. Open **Installers**, then select Kubernetes or K3s.
4. Select the targets.
5. Choose **Single Node per target** or **Multi Node**. For Kubernetes
   multi-node, assign control-plane and worker roles and select one bootstrap
   control plane.
6. Run **Verify SSH**.
7. Start the playbook.
8. Follow progress from the deployment monitor.
9. Review the result for every target.
10. Use **Reset Cluster**, **Full Uninstall**, or K3s cleanup only when required.

OpenShift uses a dedicated four-step form. For disconnected SNO, prepare the
exact release in the local mirror before starting installation. See
[OpenShift SNO](docs/OPENSHIFT_SNO.md).

See the complete [Manuel d'utilisation](docs/MANUEL_UTILISATION.md).

## Smart LAN Mirror

LinDeploy can route heavy downloads through one permanent Linux mirror on the
target LAN. The mirror fetches a missing object once, verifies it using the
normal registry digest or package signature workflow, and reuses the cached
copy for later hosts. Official upstream registries remain the fallback for OCI
images when the mirror is temporarily unavailable.

After `infra/mirror/sync-network.ps1` configures the current LAN address, it
queues an initial stable-release check. Celery Beat repeats the check every 24
hours. Existing ready content remains active until a newly detected Kubernetes
or K3s version has been fully cached and verified. The Dashboard shows both
versions and also provides safe manual **Check for updates** and **Prewarm now**
actions.

The feature is configured once in `backend/.env`; it is then injected into all
Kubernetes and K3s runs automatically. See [Smart Mirror](docs/SMART_MIRROR.md)
for the required endpoints, TLS model, cache warm-up, and validation procedure.

## Validation Commands

Backend:

```powershell
cd backend
python manage.py check
python manage.py test
```

Frontend:

```powershell
cd frontend
npm run lint
npm run build
```

Ansible from Linux or WSL:

```bash
cd backend/backend/Playbooks
ansible-playbook --syntax-check playbooks/k8s_single_node.yml
ansible-playbook --syntax-check playbooks/k8s_multi_node.yml
ansible-playbook --syntax-check playbooks/k3s_single_node.yml
ansible-playbook --syntax-check playbooks/k8s_cleanup.yml
ansible-playbook --syntax-check playbooks/k8s_full_uninstall.yml
ansible-playbook --syntax-check playbooks/k3s_cleanup.yml
ansible-playbook --syntax-check playbooks/openshift_mirror_prepare.yml
ansible-playbook --syntax-check playbooks/openshift_sno_disconnected.yml
ansible-playbook --syntax-check playbooks/openshift_sno_cleanup.yml
```

## Documentation

- [Installation and local development](docs/INSTALLATION.md)
- [Operator manual](docs/MANUEL_UTILISATION.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Smart LAN mirror](docs/SMART_MIRROR.md)
- [OpenShift SNO connected and disconnected workflows](docs/OPENSHIFT_SNO.md)
- [Security policy and current limitations](SECURITY.md)

## Roadmap

- application authentication and role-based access control;
- encryption of stored credentials;
- secret redaction and external secret-store integration;
- one shared multi-node K3s cluster;
- dedicated multi-node reset and node-removal workflows;
- HA topology and private registry support;
- separate OpenShift mirror and KVM provisioning hosts;
- additional OpenShift architectures and optional Operator catalogs;
- workshop-level provisioning and teardown for multiple SNO clusters.
