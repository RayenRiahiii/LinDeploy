#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLAYBOOK_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
MIRROR_VARS_FILE="${1:-${PLAYBOOK_ROOT}/mirror-vars.yml}"
SNO_VARS_FILE="${2:-${PLAYBOOK_ROOT}/sno-vars.yml}"
RUNTIME_DIR="${PLAYBOOK_ROOT}/.runtime/openshift-sno"
INVENTORY_FILE="${RUNTIME_DIR}/inventory.yml"
LOG_FILE="${RUNTIME_DIR}/install-$(date +%Y%m%d-%H%M%S).log"
INSTALL_USER="$(id -un)"

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this launcher as the standard KVM user, not as root." >&2
  exit 2
fi

for vars_file in "${MIRROR_VARS_FILE}" "${SNO_VARS_FILE}"; do
  if [[ ! -f "${vars_file}" ]]; then
    echo "Required variables file not found: ${vars_file}" >&2
    exit 2
  fi
done

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

echo "Installing disconnected OpenShift SNO locally on the KVM host."
echo "Log: ${LOG_FILE}"
cd "${PLAYBOOK_ROOT}"
ansible-playbook \
  -i "${INVENTORY_FILE}" \
  playbooks/openshift_sno_disconnected.yml \
  --ask-vault-pass \
  --ask-become-pass \
  --extra-vars "@${MIRROR_VARS_FILE}" \
  --extra-vars "@${SNO_VARS_FILE}" \
  2>&1 | tee -a "${LOG_FILE}"
