# Installation de LinDeploy

Ce guide installe l'environnement de developpement actuel. Les commandes doivent etre adaptees avant une mise en production.

## 1. Prerequis du controleur

- Git;
- Python 3.12 ou plus recent;
- Node.js 20.19 ou plus recent;
- Redis;
- Ansible disponible sous Linux ou dans WSL;
- acces reseau et SSH vers les machines cibles.

Sous Windows, activer WSL puis installer Ubuntu :

```powershell
wsl --install -d Ubuntu
```

Dans WSL :

```bash
sudo apt update
sudo apt install -y ansible redis-server openssh-client
ansible --version
```

Redis peut fonctionner dans WSL ou sur un service accessible par le backend. Verifier la connexion avec :

```bash
sudo service redis-server start
redis-cli ping
```

La reponse attendue est `PONG`.

## 2. Cloner le depot

```powershell
git clone https://github.com/RayenRiahiii/LinDeploy.git
cd LinDeploy
```

Eviter d'executer Ansible directement depuis `/mnt/c` si WSL signale un repertoire world-writable. Le backend positionne explicitement les chemins Ansible, mais pour les tests manuels une copie dans le systeme de fichiers WSL est plus propre.

## 3. Configurer le backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

Generer une cle Django locale :

```powershell
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Placer la valeur dans `backend/.env` :

```env
DJANGO_SECRET_KEY=replace-with-generated-value
DJANGO_DEBUG=True
USE_SQLITE=True
ANSIBLE_RUNNER_BACKEND=wsl
ANSIBLE_WSL_DISTRO=Ubuntu
ANSIBLE_REPO_ROOT=
```

Lorsque `ANSIBLE_REPO_ROOT` est vide, le backend utilise automatiquement `backend/backend/Playbooks`.

Appliquer les migrations et verifier Django :

```powershell
python manage.py migrate
python manage.py check
python manage.py runserver
```

L'API est disponible sur `http://127.0.0.1:8000/api/`.

## 4. Demarrer Celery

Ouvrir un nouveau terminal :

```powershell
cd LinDeploy\backend
.\.venv\Scripts\Activate.ps1
celery -A backend worker --loglevel=info --pool=solo
```

Start Celery Beat in another terminal so LinDeploy can perform scheduled mirror
version checks and prewarming:

```powershell
celery -A backend beat --loglevel=info
```

Sous Linux, ne pas utiliser `--pool=solo` sauf besoin particulier :

```bash
celery -A backend worker --loglevel=info
```

Le worker doit rester actif pendant toute installation ou operation de cleanup.

## 5. Configurer le frontend

```powershell
cd LinDeploy\frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

Contenu attendu de `frontend/.env` :

```env
VITE_DJANGO_BASE_URL=http://127.0.0.1:8000
```

Ouvrir `http://localhost:5173`.

## 6. Configurer une cible

La machine cible doit disposer de Python 3, SSH et sudo. Exemple Ubuntu :

```bash
sudo apt update
sudo apt install -y openssh-server python3 sudo
sudo systemctl enable --now ssh
```

Exemple CentOS, Rocky ou RHEL :

```bash
sudo dnf install -y openssh-server python3 sudo
sudo systemctl enable --now sshd
```

Verifier depuis le controleur :

```bash
ssh user@192.168.100.50
```

LinDeploy accepte une authentification par mot de passe ou par cle SSH. Le compte doit pouvoir executer `sudo`; si sudo exige un mot de passe, renseigner le mot de passe d'elevation dans la credential.

## 7. Base PostgreSQL optionnelle

SQLite facilite le developpement local. Pour un service partage, configurer PostgreSQL dans `backend/.env` :

```env
USE_SQLITE=False
DB_NAME=lindeploy
DB_USER=lindeploy
DB_PASSWORD=replace-me
DB_HOST=127.0.0.1
DB_PORT=5432
```

Executer ensuite :

```powershell
python manage.py migrate
```

## 8. Arret propre

1. Attendre ou annuler les executions actives depuis l'interface.
2. Arreter le worker Celery.
3. Arreter Django et Vite.
4. Arreter Redis uniquement lorsqu'aucune tache n'est en attente.

## 9. Activer OpenShift SNO

Appliquer toutes les migrations avant d'ouvrir la page OpenShift :

```powershell
cd LinDeploy\backend
.\.venv\Scripts\Activate.ps1
python manage.py migrate
```

Le mode connecte exige `OPENSHIFT_RED_HAT_OFFLINE_TOKEN` dans `backend/.env`.
Le mode deconnecte n'utilise pas ce token, mais exige un pull secret Red Hat, un
hote RHEL 8/9 x86_64 avec KVM/libvirt, un FQDN DNS stable pour Quay, au moins
400 GiB disponibles pour le miroir et l'archive officielle
`mirror-registry.tar.gz`.

Consulter [OpenShift SNO](OPENSHIFT_SNO.md) avant le premier test reel. Utiliser
une VM SNO et un pool de stockage jetables; ne jamais confirmer un disque
physique contenant des donnees.
