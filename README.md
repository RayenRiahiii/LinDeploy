# LinDeploy

LinDeploy is a full-stack, containerized web control plane for deploying, monitoring, and managing Linux cluster platforms on remote machines through native Ansible automation.

The current release supports:

- **Kubernetes**: kubeadm, containerd, and Calico (single-node and multi-node);
- **K3s**: lightweight single-node and multi-node clusters with server and agent roles;
- **Flexible Topologies**: one independent single-node cluster per selected target, or shared multi-node clusters;
- **Multi-Target Execution**: concurrent preflight verification, per-host live results, and partial-success reporting;
- **SSH Connectivity Engine**: automated pre-execution checks (Password, SSH Private Key, and SSH Public Key);
- **Lifecycle & Cleanup**: Kubernetes reset and full uninstall workflows, K3s cleanup, and node purging;
- **Direct Execution Cancellation**: immediate process termination and host release with a single click;
- **Dual Conflict Protection**: cross-platform (K8s vs K3s) and same-platform conflict detection ("Keep existing" vs "Cleanup and reinstall");
- **User Authentication**: secure JWT and session-based authentication, registration, login, and protected routes;
- **Bilingual Internationalization (i18n)**: instant on-the-fly language switching between English (`EN`) and French (`FR`);
- **Smart LAN Pull-Through Mirror**: integrated caching for OCI images (Docker, Quay, K8s registries), K3s binaries, Calico manifests, and RPM/DEB repositories;
- **OpenShift SNO Provisioning**: connected and disconnected Single-Node OpenShift on KVM/libvirt through the Assisted and Agent-Based Installers.

> **Current maturity:** LinDeploy is suitable for labs, workshops, edge deployments, and production staging. Do not expose it directly to untrusted public networks without a secure gateway or VPN. See [Security](SECURITY.md).

---

## Host Prerequisites

Before starting LinDeploy, ensure your host machine (Windows, Linux, or macOS) has:

- **Docker**:
  - **Windows / macOS**: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (v24.0+ recommended) with the Linux containers engine.
  - **Linux**: Docker Engine (v24.0+) with the `docker-compose-plugin` (v2.20+).
- **Git**: Installed and available in your `PATH` (used for repository cloning and native TLS helper scripts).
- **Network Ports**: Ensure the following host ports are available:
  - `5173` (Frontend Web UI)
  - `8000` (Backend REST API)
  - `8443` (Local Smart Pull-Through Mirror Gateway)
  - `6379` (Internal Redis broker - accessible locally)

> [!NOTE]
> On Windows, `.\start.ps1` automatically detects whether Docker Desktop is currently running and will attempt to launch it for you if it is stopped.

---

## 1-Click Quick Start (Recommended)

LinDeploy runs in a fully containerized, zero-configuration environment on **any operating system** (Windows, Linux, macOS).

> **Zero Configuration Required**:
> - You do **NOT** need to create or edit any `.env` file manually.
> - You do **NOT** need Python, Node.js, npm, or WSL installed on your host machine.
> - Host LAN IP detection, mirror TLS certificates, SQLite data volume, and container networking are all automated.

### 1. Clone the repository:
```bash
git clone https://github.com/RayenRiahiii/LinDeploy.git
cd LinDeploy
```

### 2. Start the stack:

#### On Windows (PowerShell):
```powershell
.\start.ps1
```

#### On Linux or macOS (Bash):
```bash
chmod +x start.sh stop.sh
./start.sh
```

#### Or using Docker Compose directly:
```bash
docker compose up -d --build
```

### What happens automatically:
1. **Host IP Detection**: Detects your machine's active IPv4 address on the current local network.
2. **Mirror TLS Certificates**: Generates or updates self-signed certificates for the detected IP address.
3. **Data Volume Seeding**: Sets up `./data/` for persistent database storage (`db.sqlite3`).
4. **Service Bootstrapping**: Builds and starts all 10 containers with automatic database migrations and healthchecks.

### Service Endpoints:
- **Web Dashboard**: [http://localhost:5173](http://localhost:5173) (or `http://<YOUR-LAN-IP>:5173` from any device on your LAN)
- **REST API Backend**: [http://localhost:8000/api/](http://localhost:8000/api/)
- **Mirror Gateway**: `https://<YOUR-LAN-IP>:8443/cache/`

### Advanced Startup Parameters:
The startup scripts accept parameters if you need custom binding or alternate ports:
```powershell
# Custom LAN IP and alternate web ports on Windows:
.\start.ps1 -HostIp 192.168.1.100 -FrontendPort 3000 -BackendPort 8080

# Fast restart without rebuilding container images:
.\start.ps1 -NoBuild
```

### Stopping the Services:
- Windows: `.\stop.ps1`
- Linux / macOS: `./stop.sh`
- Or: `docker compose down`

---

## Architecture

```text
Browser (EN / FR) [http://localhost:5173]
   |
   v
Frontend (Nginx Alpine) --- Proxy /api/ ---> Backend (Django + Gunicorn) [http://localhost:8000]
                                                  |
                                                  v
                                            Celery Worker (Native Linux Ansible) <---> Redis 7
                                                  |                                        ^
                                                  |                                        |
                                                  +---------------------------------- Celery Beat
                                                  |
                                                  v
                                     Smart LAN Mirror (Zot + Artifact Cache + Gateway HTTPS:8443)
                                                  |
                                                  +---- SSH ---- Target 1 (Control Plane / Server)
                                                  +---- SSH ---- Target 2 (Worker / Agent)
                                                  +---- SSH ---- Target N
```

### Container Services Overview:
| Service | Image / Base | Role |
| :--- | :--- | :--- |
| **`frontend`** | `node:20-alpine` & `nginx:1.27-alpine` | React SPA UI, Mantine components, i18n, reverse-proxying `/api/` |
| **`backend`** | `python:3.12-slim-bookworm` | Django REST Framework, JWT auth, system checks, database migrations |
| **`celery-worker`**| `python:3.12-slim-bookworm` | Native Linux Ansible Core 2.17.7, SSH client, deployment orchestration |
| **`celery-beat`** | `python:3.12-slim-bookworm` | Periodic scheduling for automated mirror cache prewarming |
| **`redis`** | `redis:7-alpine` | In-memory broker and results backend for asynchronous tasks |
| **`gateway`** | `nginx:1.28-alpine` | HTTPS reverse-proxy for the LAN pull-through mirror (port 8443) |
| **`artifact-cache`**| Python 3 HTTP daemon | Cache store for RPM/DEB repositories, Calico, and K3s binaries |
| **`registry-*`** | `ghcr.io/project-zot/zot` | OCI distribution registries for k8s.io (5001), quay.io (5002), docker.io (5003) |

---

## Live Playbook Hot-Reloading

For playbook development and custom roles:
- The repository's `backend/backend/Playbooks/` directory is mounted directly into the `celery-worker` container.
- Any change to playbooks, roles, tasks, or templates takes effect **immediately** on the next deployment run without rebuilding images or restarting containers.

---

## Repository Layout

```text
LinDeploy/
|-- docker-compose.yml            # Unified multi-container stack definition
|-- start.ps1 / start.sh          # Zero-config 1-click startup scripts (Windows / Linux / macOS)
|-- stop.ps1 / stop.sh            # Graceful shutdown scripts
|-- backend/
|   |-- Dockerfile                # Debian-based Python + Ansible runner image
|   |-- docker-entrypoint.sh      # Container entrypoint (web, worker, beat)
|   |-- auto_K8S/                 # Django domain models, API, JWT auth, tasks
|   |-- backend/                  # Project settings, URLs, Celery configuration
|   |   `-- Playbooks/            # Embedded Ansible automation repository
|   |       |-- ansible.cfg
|   |       |-- playbooks/
|   |       `-- roles/
|   |-- manage.py
|   `-- requirements.txt
|-- frontend/
|   |-- Dockerfile                # Multi-stage Vite build + Nginx runtime
|   |-- nginx.conf                # Nginx SPA routing and backend proxy configuration
|   `-- src/                      # React, TypeScript, Mantine UI, i18n (EN/FR)
|-- infra/
|   `-- mirror/                   # Local pull-through caching gateway and registries
|-- docs/
|   |-- ARCHITECTURE.md           # Deep dive into architecture and components
|   |-- INSTALLATION.md           # Installation reference and dev setup
|   |-- MANUEL_UTILISATION.md     # Operator manual in French
|   |-- SMART_MIRROR.md           # Mirror setup, endpoints, and validation
|   `-- TROUBLESHOOTING.md        # Common issues and solutions
|-- data/                         # Persistent host SQLite volume (gitignored)
`-- README.md
```

---

## Supported Remote Targets

LinDeploy deploys onto remote Linux machines with package and service management for:

- **Red Hat family**: RHEL 8 / 9, CentOS Stream 9, Rocky Linux 9, AlmaLinux 9, and compatible enterprise Linux systems;
- **Debian family**: Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, Linux Mint 21 / 22, and Debian 12.

### Target Hardware & System Requirements:

| Platform | Target OS | Minimum vCPU / RAM | Storage | Special Requirements |
| :--- | :--- | :--- | :--- | :--- |
| **K3s** | Debian / RHEL families | 1 vCPU / 1 GB RAM | $\ge$ 10 GB | Sudo access, Python 3, SSH |
| **Kubernetes** | Debian / RHEL families | 2 vCPU / 2 GB RAM (4 vCPU / 4 GB recommended) | $\ge$ 20 GB | Sudo access, Python 3, SSH (swap is automatically disabled) |
| **OpenShift SNO** | RHEL 8 / 9 (x86_64) | **Host**: $\ge$ 20 vCPU / 48 GB RAM<br>**VM**: 16 vCPU / 32 GB RAM | $\ge$ 400 GB for Quay mirror<br>$\ge$ 120 GB for SNO VM | Hardware virtualization (KVM/libvirt enabled), stable DNS FQDN, valid Red Hat pull secret |

---

## Operator Journey: Step-by-Step Guide

### 1. Initial Setup & Authentication
1. Open **[http://localhost:5173](http://localhost:5173)** in your browser.
2. Create an account via **Sign Up** or log in.
3. Switch language between **English** (`EN`) and **Français** (`FR`) anytime from the top navigation bar.

### 2. Register Credentials & Target Hosts
1. Go to **Credentials** -> **Add Credential**: choose **Password**, **SSH Private Key**, or **SSH Public Key**.
2. Go to **Hosts** -> **Add Host**: enter the target machine's IP, hostname, and select its associated SSH credential.
3. If the host list is empty, handy action shortcuts allow instant credential and host creation.

### 3. Deploying Kubernetes or K3s
1. Navigate to **Installers** -> choose **Kubernetes** or **K3s**.
2. Select target hosts and pick a topology:
   - **Single Node**: one independent, autonomous cluster per selected machine.
   - **Multi Node**: a unified multi-node cluster with role assignment (Control Plane / Workers or Server / Agents).
3. Click **Verify SSH** to run automated preflight connectivity and privilege checks.
4. Click **Run Playbook** to start deployment.
5. Follow real-time streaming logs, task progress bars, and node health status in the **Execution Center**.
6. **Cancel anytime**: If needed, click **Cancel** to immediately terminate Ansible execution (`SIGTERM`) and release target host locks.

### 4. Deploying OpenShift SNO (Single-Node OpenShift)
LinDeploy provides a managed disconnected Single Node OpenShift workflow on KVM/libvirt:
- **Managed Disconnected Mode (Air-Gapped)**:
  1. Open **Installers** -> **OpenShift SNO** -> select **Disconnected**.
  2. Enter the target RHEL KVM host, registry FQDN (e.g., `registry.lab.test:8443`), Quay storage path, and Red Hat pull secret.
  3. Click **Prepare mirror content**: runs [`openshift_mirror_prepare.yml`](backend/backend/Playbooks/playbooks/openshift_mirror_prepare.yml) to deploy a local Quay registry, configure TLS, trust the CA, and synchronize release images via `oc-mirror v2`.
  4. Once mirror preparation reports `ready`, confirm the installation disk (`ERASE /dev/...`) and click **Start SNO installation** to generate the Agent-Based ISO and boot the SNO VM.

### 5. Conflict Resolution & Lifecycle Cleanup
- **Conflict Protection**:
  - *Cross-platform*: Prevents installing Kubernetes over an existing K3s cluster (and vice-versa) until explicitly cleaned.
  - *Same-platform*: Offers **Keep existing** or **Cleanup and reinstall** when an existing cluster is detected.
- **Reset Cluster**: Fast reinitialization of Kubernetes/K3s control plane while keeping container runtimes and dependencies intact.
- **Full Uninstall**: Complete removal of packages, CNI interfaces, certificates, kubeconfig, and LinDeploy ownership manifests.
- **SNO Cleanup**: Deletes only the managed SNO virtual machine, libvirt disk volume, and cluster assets while preserving the Quay mirror and cached images for future clusters.

---

## Alternative: Local Development Setup (Without Docker)

If you prefer running components directly on your host machine without Docker:

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

From a second terminal in `backend/`:
```powershell
.\.venv\Scripts\Activate.ps1
celery -A backend worker --loglevel=info --pool=solo
```

In a third terminal, start Celery Beat:
```powershell
.\.venv\Scripts\Activate.ps1
celery -A backend beat --loglevel=info
```

### 3. Start the frontend

```powershell
cd frontend
npm ci
npm run dev
```

---

## Validation & Testing Commands

```powershell
# Backend checks and unit tests
cd backend
python manage.py check
python manage.py test

# Frontend linting and production build
cd frontend
npm run lint
npm run build

# Ansible playbook syntax validation
cd backend/backend/Playbooks
ansible-playbook --syntax-check playbooks/k8s_single_node.yml
ansible-playbook --syntax-check playbooks/k8s_multi_node.yml
ansible-playbook --syntax-check playbooks/k3s_single_node.yml
ansible-playbook --syntax-check playbooks/k3s_multi_node.yml
ansible-playbook --syntax-check playbooks/openshift_mirror_prepare.yml
ansible-playbook --syntax-check playbooks/openshift_sno.yml
ansible-playbook --syntax-check playbooks/openshift_sno_disconnected.yml
```

---

## Documentation

- [Installation and local development](docs/INSTALLATION.md)
- [Manuel d'utilisation (Français)](docs/MANUEL_UTILISATION.md)
- [Technical architecture](docs/ARCHITECTURE.md)
- [Troubleshooting guide](docs/TROUBLESHOOTING.md)
- [Smart LAN mirror](docs/SMART_MIRROR.md)
- [OpenShift SNO workflows](docs/OPENSHIFT_SNO.md)
- [Security policy](SECURITY.md)
