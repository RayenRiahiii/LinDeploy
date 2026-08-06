# LinDeploy Ansible Playbooks

This directory is the Ansible execution root used by the Django backend. The
backend generates a temporary inventory for every execution, so controller-local
inventories, `host_vars`, passwords, and SSH keys must not be committed here.

## Layout

```text
Playbooks/
|-- ansible.cfg
|-- playbooks/
|   |-- k8s_single_node.yml
|   |-- k8s_cleanup.yml
|   |-- k8s_full_uninstall.yml
|   |-- k3s_single_node.yml
|   |-- k3s_cleanup.yml
|   |-- prepare_node.yml
|   |-- init_single_node.yml
|   `-- reset_node.yml
`-- roles/
```

## Operational Workflows

- `k8s_single_node.yml`: complete kubeadm, containerd, and Calico installation.
- `k8s_cleanup.yml`: reset cluster state while retaining packages for reinstall.
- `k8s_full_uninstall.yml`: remove Kubernetes cluster state and packages.
- `k3s_single_node.yml`: complete K3s single-node installation.
- `k3s_cleanup.yml`: remove K3s and its managed state.
- `prepare_node.yml` and `init_single_node.yml`: reusable Kubernetes phases for
  targets that were already prepared by an earlier workflow.
- `reset_node.yml`: role-level Kubernetes reset entry point for controller use.

All supported web workflows target the generated `selected_hosts` inventory
group and isolate target failures with Ansible's `free` strategy.

## Validation

From Linux or WSL:

```bash
cd backend/backend/Playbooks
for playbook in playbooks/*.yml; do
  ansible-playbook --syntax-check "$playbook"
done
```
