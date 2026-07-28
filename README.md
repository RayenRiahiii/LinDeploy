# Auto-K8S

`Auto-K8S` is a Django + React control plane for launching Ansible-based Kubernetes installation workflows on remote machines.

## What It Includes

- Django REST API for hosts, credentials, templates, and installation history
- React + Mantine operator UI for CRUD, SSH verification, and playbook execution
- Celery + Redis background execution for long-running Ansible tasks
- Ansible playbook repository integration through either WSL or native Linux

## Project Layout

```text
auto-K8S/
  backend/
    auto_K8S/
    backend/
    manage.py
    requirements.txt
  frontend/
    front/
```

## Backend Setup

1. Create and activate a virtual environment:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
```

2. Install dependencies:

```powershell
pip install -r requirements.txt
```

3. Copy the environment example and adjust values:

```powershell
copy .env.example .env
```

4. Run database migrations:

```powershell
python manage.py migrate
```

5. Start Django:

```powershell
python manage.py runserver
```

## Frontend Setup

1. Install dependencies:

```powershell
cd frontend\front
npm install
```

2. Copy the frontend environment example:

```powershell
copy .env.example .env
```

3. Start Vite:

```powershell
npm run dev
```

## Redis And Celery

Start Redis, then start the Celery worker from `backend/`:

```powershell
celery -A backend worker --loglevel=info --pool=solo
```

`--pool=solo` is recommended on Windows.

## Ansible Controller Configuration

The backend expects an Ansible repo root containing:

- `ansible.cfg`
- `roles/`
- `playbooks/`

Configure it with `.env`:

```env
ANSIBLE_RUNNER_BACKEND=wsl
ANSIBLE_WSL_DISTRO=Ubuntu
ANSIBLE_REPO_ROOT=C:\Users\ASUS\Desktop\auto-K8S\backend\backend\Playbooks\k8s-single-noded\k8s-single-noded
```

If you run on Linux instead of Windows + WSL:

```env
ANSIBLE_RUNNER_BACKEND=linux
ANSIBLE_REPO_ROOT=/opt/k8s-single-noded
```

## Recommended First Run

1. Create credentials
2. Create hosts and link credentials
3. Create at least one installation template
4. Verify SSH from the UI
5. Launch the playbook
6. Review installation history, timings, and bottleneck hints

## Current Improvements Added

- richer installation tracking in database
- automatic SSH validation inside the background task
- dashboard summary endpoint
- installation history polling in frontend
- recent timings and bottleneck reporting
- support for both password and SSH key inventory generation
- template deployment types (`prepare_node`, `single_node`)
- host role field for future multi-node support

## Next Recommended Production Work

- encrypt credentials at rest
- add pagination and filtering to installation history
- add worker join and control-plane join playbooks
- use a local package mirror and container registry
- split node preparation from cluster initialization across all templates
