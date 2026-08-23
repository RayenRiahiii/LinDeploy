# LinDeploy Ansible Playbooks

The shared `common` role installs only packages required by the automation.
Operator conveniences such as `vim`, `git`, and `wget` are intentionally not
part of the target baseline.

When the LinDeploy smart mirror is enabled, fresh K3s installations download
the release checksum and matching air-gap image archive from the LAN artifact
cache. The archive is verified with the upstream SHA-256 digest before it is
placed in `/var/lib/rancher/k3s/agent/images`. K3s then imports its packaged
images locally instead of waiting for CoreDNS, Traefik, metrics-server, and the
local-path provisioner to pull separately from the Internet.

This directory is the Ansible execution root used by the Django backend. The
backend generates a temporary inventory for every execution, so controller-local
inventories, `host_vars`, passwords, and SSH keys must not be committed here.

## Layout

```text
Playbooks/
|-- ansible.cfg
|-- playbooks/
|   |-- k8s_single_node.yml
|   |-- k8s_multi_node.yml
|   |-- k8s_cleanup.yml
|   |-- k8s_full_uninstall.yml
|   |-- k3s_single_node.yml
|   |-- k3s_cleanup.yml
|   |-- openshift_sno.yml
|   |-- openshift_mirror_prepare.yml
|   |-- openshift_sno_disconnected.yml
|   |-- openshift_sno_cleanup.yml
|   |-- prepare_node.yml
|   |-- init_single_node.yml
|   `-- reset_node.yml
`-- roles/
```

## Operational Workflows

- `k8s_single_node.yml`: complete kubeadm, containerd, and Calico installation.
- `k8s_multi_node.yml`: one shared kubeadm cluster with a bootstrap control
  plane, optional additional control planes, and one or more workers.
- `k8s_cleanup.yml`: reset cluster state while retaining packages for reinstall.
- `k8s_full_uninstall.yml`: remove Kubernetes cluster state and packages.
- `k3s_single_node.yml`: complete K3s single-node installation.
- `k3s_cleanup.yml`: remove K3s and its managed state.
- `openshift_sno.yml`: connected SNO installation through Assisted Installer.
- `openshift_mirror_prepare.yml`: install or reuse Quay and synchronize an exact
  OpenShift release with checksum-verified tools and `oc-mirror` v2.
- `openshift_sno_disconnected.yml`: generate an Agent ISO and install one SNO VM
  from the verified local release mirror.
- `openshift_sno_cleanup.yml`: remove only the LinDeploy-managed SNO VM, volume,
  and cluster assets while preserving mirror content.
- `prepare_node.yml` and `init_single_node.yml`: reusable Kubernetes phases for
  targets that were already prepared by an earlier workflow.
- `reset_node.yml`: role-level Kubernetes reset entry point for controller use.

All supported web workflows use the generated `selected_hosts` inventory
group. Multi-node inventories also expose `bootstrap`, `control_plane`, and
`workers` groups. Preparation and worker joins can run independently, while
bootstrap and additional control-plane operations remain serial.

The multi-node workflow uses short-lived kubeadm tokens, CA hash verification,
temporary certificate upload keys, mode `0600` configuration files, explicit
partial-state checks, and final API, node, Calico, and CoreDNS validation. A
multi-control-plane cluster is highly available only when
`control_plane_endpoint` points to a stable external load balancer.
Worker nodes receive the standard `node-role.kubernetes.io/worker` label from
the bootstrap host, so their selected role is visible in `kubectl get nodes`
without distributing the administrator kubeconfig to workers.

Cluster and node names are optional in LinDeploy. Single-node workflows accept
one cluster name and one node name per target. Multi-node workflows use one
shared cluster name and one unique node name per host. Empty values are replaced
with stable DNS-compatible defaults before the inventory is generated.

Mixed Linux distributions are supported within the same Kubernetes cluster.
Each joining node selects its own kubelet DNS resolver: the systemd-resolved
upstream file when available (Ubuntu/Debian), otherwise `/etc/resolv.conf`
(CentOS/Rocky/RHEL). The role updates kubelet idempotently and restarts it only
when that node-local resolver setting changes.

## Validation

From Linux or WSL:

```bash
cd backend/backend/Playbooks
for playbook in playbooks/*.yml; do
  ansible-playbook --syntax-check "$playbook"
done
```
