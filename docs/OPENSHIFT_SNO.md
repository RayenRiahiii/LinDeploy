# OpenShift SNO in LinDeploy

LinDeploy provides a production-grade managed disconnected Single Node OpenShift
(SNO) workflow. This disconnected workflow uses a permanent private Quay registry,
`oc-mirror` v2, the Agent-Based Installer, and a LinDeploy-managed KVM virtual machine.
Kubernetes and K3s playbooks are not used or modified by the OpenShift workflow.

## Registered workflows

| Workflow | Playbook | Status | Purpose |
| --- | --- | --- | --- |
| Prepare disconnected mirror | `playbooks/openshift_mirror_prepare.yml` | **Active** | Install/reuse Quay and synchronize one exact OCP release |
| Disconnected SNO | `playbooks/openshift_sno_disconnected.yml` | **Active** | Generate an Agent ISO and install from the local mirror |
| SNO cleanup | `playbooks/openshift_sno_cleanup.yml` | **Active** | Remove only the managed VM, disk and cluster assets |
| Connected SNO (legacy) | `playbooks/openshift_sno.yml` | *Disabled* | Legacy hosted Assisted Installer (rejected by API validator) |

## Disconnected architecture

```text
Red Hat registries (preparation only)
              |
              v
RHEL 8/9 mirror + KVM host
  - mirror-registry / Quay
  - oc-mirror v2 workspace
  - exact oc and openshift-install release
  - libvirt network, storage and SNO VM
              |
              v
RHCOS Agent ISO -> mirrored OpenShift release -> one SNO cluster
```

The first mirror preparation requires Internet access. Once all required
content is synchronized, installation uses the LAN mirror. The mirror registry
must remain available for the lifetime of the cluster; disconnected does not
mean that Quay can be stopped after installation.

The first implementation deliberately uses one RHEL 8/9 host for both the
mirror and KVM provisioning. This keeps certificate, installer binary and
release-marker ownership automatic. An external existing registry is supported
for TLS by pasting its CA, but distributing installer binaries from a separate
mirror host is outside this first adapter.

## Mirror preparation prerequisites

- A registered Red Hat OpenShift subscription and valid pull secret.
- RHEL 8 or 9 with active signed repositories.
- Hardware virtualization, KVM/libvirt and passwordless sudo or a LinDeploy
  sudo credential.
- A stable FQDN such as `registry.lab.example.com` that resolves from the mirror
  host and the future RHCOS node. IP addresses are not accepted by
  `mirror-registry`.
- At least 400 GiB free on the selected mirror filesystem. Real requirements
  depend on the release and optional Operators.
- The official `mirror-registry.tar.gz` downloaded from the Red Hat Hybrid Cloud
  Console. Supply either an existing absolute path on the remote host or an
  HTTPS URL plus its `sha256:` checksum.
- TCP 8443 reachable from the machine network. The playbook opens only the
  selected registry port in firewalld.

The Quay password must contain at least eight characters and no whitespace.
Secrets are encrypted in the backend, consumed once by the worker, passed in a
mode `0600` temporary vars file and removed after execution.

## Run from the web application

1. Run backend migrations and restart Django and Celery.
2. Add the RHEL KVM/mirror host and its SSH credential in LinDeploy.
3. Open **Installers -> OpenShift SNO** and select **Disconnected**.
4. Enter an exact release such as `4.20.3`, not `stable`.
5. Enter the stable mirror FQDN and port, storage path, Quay credentials and the
   official mirror-registry archive source.
6. Paste the Red Hat pull secret and an SSH public key.
7. Select **Prepare mirror content**. This installs/reuses Quay, verifies its CA,
   downloads checksum-verified clients, runs `oc-mirror --v2`, verifies the
   release tag and writes a release-specific readiness marker.
8. After preparation succeeds, start the disconnected SNO installation with the
   same host, registry, release and credentials. For the locally managed mirror,
   leave **External mirror CA** empty; LinDeploy discovers it automatically.
9. Confirm the VM installation disk with the exact value shown, for example
   `ERASE /dev/vda`.
10. Follow the execution monitor through ISO generation, VM boot, bootstrap,
    install completion and cluster health validation.

## What is validated

Mirror preparation stops safely when the host is not RHEL 8/9, registry DNS is
invalid, storage is insufficient, archive verification fails, Quay is not
healthy, `oc-mirror` does not produce cluster resources, or the exact release
tag is absent.

Disconnected installation validates the exact release marker, registry and
installer version, mirror CA, pull secret, SSH key, libvirt capacity, DNS,
networking, destructive confirmation, generated ISO, bootstrap completion,
node readiness and critical cluster health.

## Manual verification

On the KVM/mirror host:

```bash
curl --cacert /opt/quay/quay-rootCA/rootCA.pem \
  -u '<mirror-user>:<mirror-password>' \
  https://registry.lab.example.com:8443/v2/

curl --cacert /opt/quay/quay-rootCA/rootCA.pem \
  -u '<mirror-user>:<mirror-password>' \
  https://registry.lab.example.com:8443/v2/openshift/release-images/tags/list

export KUBECONFIG="$HOME/.local/share/lindeploy/openshift-agent/<cluster>/auth/kubeconfig"
/usr/local/libexec/lindeploy-openshift/oc get nodes
/usr/local/libexec/lindeploy-openshift/oc get clusterversion
/usr/local/libexec/lindeploy-openshift/oc get clusteroperators
```

Cleanup removes only the LinDeploy-owned VM, its managed volume and the
cluster-specific Agent assets. It preserves Quay, mirrored release images and
the oc-mirror workspace so later installations do not download the release
again.

## Real-machine test boundary

Code validation cannot prove a real disconnected OpenShift installation. Before
calling this production-ready, perform one controlled RHEL 8/9 test with a
non-production DNS zone, dedicated storage pool and disposable SNO VM. Record
mirror duration, ISO generation, bootstrap time, ClusterOperator health,
restart behavior and cleanup behavior. Never test against a physical disk that
contains data.

## Authoritative references

- [Agent-Based Installer for on-premise OpenShift](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/installing_an_on-premise_cluster_with_the_agent-based_installer/installing_an_on-premise_cluster_with_the_agent-based_installer)
- [Disconnected environments and oc-mirror v2](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/disconnected_environments/disconnected_environments)
- [Mirror registry for Red Hat OpenShift](https://docs.redhat.com/en/documentation/openshift_container_platform/4.16/html/disconnected_installation_mirroring/installing-mirroring-creating-registry)
