#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLAYBOOK_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SNO_VARS_FILE="${1:-${PLAYBOOK_ROOT}/sno-vars.yml}"
RUNTIME_DIR="${PLAYBOOK_ROOT}/.runtime/openshift-sno"
INVENTORY_FILE="${RUNTIME_DIR}/inventory.yml"
LOG_FILE="${RUNTIME_DIR}/cleanup-$(date +%Y%m%d-%H%M%S).log"
INSTALL_USER="$(id -un)"

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this launcher as the standard KVM user, not as root." >&2
  exit 2
fi

if [[ ! -f "${SNO_VARS_FILE}" ]]; then
  echo "Required variables file not found: ${SNO_VARS_FILE}" >&2
  exit 2
fi

umask 077
mkdir -p "${RUNTIME_DIR}"
cat > "${INVENTORY_FILE}" <<EOF
all:
  children:
    selected_hosts:
      hosts:
        localhost:
          ansible_connection: local
          ansible_user: ${INSTALL_USER}
          ansible_python_interpreter: /usr/bin/python3
EOF

export ANSIBLE_ROLES_PATH="${PLAYBOOK_ROOT}/roles"
export ANSIBLE_NOCOLOR=1

echo "Removing the LinDeploy-managed disconnected SNO VM and cluster assets."
echo "The OpenShift mirror and release payload will be preserved."
echo "Log: ${LOG_FILE}"
cd "${PLAYBOOK_ROOT}"
ansible-playbook \
  -i "${INVENTORY_FILE}" \
  playbooks/openshift_sno_cleanup.yml \
  --ask-become-pass \
  --extra-vars "@${SNO_VARS_FILE}" \
  2>&1 | tee -a "${LOG_FILE}"
