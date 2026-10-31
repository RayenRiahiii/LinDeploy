FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ANSIBLE_RUNNER_BACKEND=linux \
    USE_SQLITE=True \
    SQLITE_PATH=/app/data/db.sqlite3 \
    ANSIBLE_HOST_KEY_CHECKING=False

# Install system dependencies: SSH client, sshpass (for password-based host auth), curl, git, procps
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client \
    sshpass \
    curl \
    git \
    procps \
    rsync \
    ca-certificates \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements and Ansible
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir ansible-core==2.17.7

# Install Ansible collections required by Kubernetes, K3s, and OpenShift playbooks
RUN ansible-galaxy collection install ansible.posix community.general community.crypto

# Copy backend application source code
COPY . /app

# Ensure entrypoint script is executable and directories exist
RUN chmod +x /app/docker-entrypoint.sh && \
    mkdir -p /app/data /app/runtime /app/logs

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["web"]

