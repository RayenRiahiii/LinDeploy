# Kubernetes and K3s safety contract

## Supported boundary

LinDeploy installs Kubernetes or K3s directly on existing SSH targets. It does
not provision VMs for these platforms. KVM/libvirt remains isolated to the
OpenShift workflow.

Production release profiles are immutable BOM files under
`backend/backend/Playbooks/vars/`. They pin the platform, CNI, downloaded
scripts/manifests and their checksums. Updating a release requires a new BOM;
an existing BOM must never be edited after it has been used.

## Ownership and destructive operations

Before the first managed mutation, LinDeploy writes a root-only ownership
manifest to `/var/lib/lindeploy/ownership/<platform>.json`. It records the
stable LinDeploy target UUID, machine ID, system UUID, platform, cluster ID,
release profile and exact managed-resource list.

Reset, cleanup and uninstall require all of the following:

1. `target_modification_approved=true`;
2. the exact UI confirmation generated from the cluster name and selected stable target UUIDs;
3. a valid ownership manifest matching the current machine and cluster;
4. the expected platform and a non-empty managed-resource list.

Missing or inconsistent ownership stops the play before destructive work. A
successful cleanup keeps a `cleaned` tombstone. Repeating the same cleanup is a
no-op. There is deliberately no implicit force mode. When a target host has no
active cluster runtime present, LinDeploy safely adopts the host for the new
deployment without failing on stale machine identities.

## Linux security

- SELinux remains enforcing on Red Hat-family systems.
- Firewalld remains enabled and LinDeploy opens only required platform ports
  and configured cluster CIDRs.
- GPG checks, TLS validation and checksum validation remain enabled.
- Active SSH/default-route interfaces are protected during network cleanup.
- `lab_insecure` is never selected by the production web workflow.

## Recovery model

The ownership state progresses through `prepared`, `active`, and `cleaned`.
An interrupted run can continue when machine, target, cluster and release
identity agree. Ambiguous or conflicting state fails with a recovery message;
LinDeploy never resets an ambiguous cluster automatically.

## Retained command tasks

Command tasks remain where no stable Ansible module exposes the required API:
`kubeadm init/join/reset`, `kubectl` health/label/taint/rollout operations,
`ctr` CRI image inspection/pull, kernel module loading, `ss` port inspection,
network-interface teardown, system trust-store refresh and vendor uninstall
scripts. These tasks declare `changed_when`/`failed_when` according to whether
they inspect or mutate state. Package, file, repository, service, firewall and
sysctl operations continue to use native modules.

## Operator validation

```bash
ansible-playbook --syntax-check playbooks/<playbook>.yml
ansible-lint playbooks roles
ansible-playbook --check --diff -i <inventory> playbooks/<playbook>.yml
```

Disposable-target qualification must cover two installation runs, interrupted
resume, cleanup twice, wrong confirmation, missing/wrong ownership, unreachable
host, package failure and expired kubeadm join token. The second installation
and second cleanup must report `changed=0`, except documented token, certificate
or repository metadata refreshes.
