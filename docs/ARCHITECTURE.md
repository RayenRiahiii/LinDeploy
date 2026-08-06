# Architecture technique de LinDeploy

## Objectif

LinDeploy separe l'experience operateur, l'orchestration asynchrone et l'automatisation systeme. Cette separation permettra d'ajouter OpenShift SNO sans melanger sa logique avec Kubernetes ou K3s.

## Composants

### Frontend

- React et TypeScript;
- Vite pour le developpement et le build;
- Mantine et Tabler Icons;
- pages distinctes pour dashboard, hosts, credentials, installers, executions et historique;
- polling de l'API pendant une execution;
- resultats et diagnostics structures par cible.

### Backend

- Django et Django REST Framework;
- validation des hosts, credentials et chemins de playbooks;
- generation d'un inventaire temporaire pour les cibles selectionnees;
- selection explicite du runner Linux ou WSL;
- modeles `Installation` et `InstallationTarget` pour separer le statut global du statut par host;
- detection des resultats partiels;
- annulation et historique.

Le nom interne `auto_K8S` est historique. Le renommer exige une migration Django controlee et n'est pas necessaire au changement de marque LinDeploy.

### Execution asynchrone

- Redis transporte les messages Celery;
- Celery execute les controles SSH et les playbooks longs hors du processus HTTP;
- le frontend interroge l'etat persiste dans la base;
- les sorties sont analysees pour produire une synthese par cible.

### Ansible

Le depot embarque est `backend/backend/Playbooks`.

Playbooks principaux :

| Plateforme | Action | Playbook |
|---|---|---|
| Kubernetes | Installation | `playbooks/k8s_single_node.yml` |
| Kubernetes | Reset | `playbooks/k8s_cleanup.yml` |
| Kubernetes | Suppression complete | `playbooks/k8s_full_uninstall.yml` |
| K3s | Installation | `playbooks/k3s_single_node.yml` |
| K3s | Suppression | `playbooks/k3s_cleanup.yml` |

Roles principaux :

- `common` : paquets, swap, modules noyau, sysctl, SELinux et firewalld;
- `containerd` : runtime Kubernetes kubeadm;
- `kubernetes` : depot et paquets kubelet/kubeadm/kubectl;
- `kubeadm_init` : images, configuration et initialisation du control plane;
- `cni_prepull` et `cni` : preparation et deploiement Calico;
- `k3s` : installation, configuration, kubeconfig et health checks;
- `kubernetes_cleanup` et `k3s_cleanup` : teardown idempotent.

## Cycle d'une execution

```text
1. Selection de l'installer et des hosts
2. Validation API
3. Creation de Installation + InstallationTarget
4. Mise en file Celery
5. Generation de l'inventaire temporaire
6. Verification SSH par host
7. Detection de conflit de plateforme
8. Execution Ansible sur les hosts eligibles
9. Analyse du recap Ansible par host
10. Persistance des statuts, timings et diagnostics
11. Affichage success, partial_success, failed ou cancelled
```

Une cible inaccessible ne doit pas empecher les cibles eligibles de continuer. Si toutes les cibles sont invalides, le playbook principal n'est pas lance.

## Idempotence et reprise

- les roles utilisent des modules Ansible et des conditions d'etat;
- les services sont redemarres par handlers lorsque possible;
- les installations existantes sont detectees et validees;
- K3s peut reparer une installation partielle selon les variables du role;
- kubeadm ne reinitialise pas un cluster disposant deja de son `admin.conf`;
- les cleanups acceptent l'absence d'artefacts et restent relancables.

## Frontieres actuelles

- un host correspond a un cluster single-node;
- pas de topologie control-plane/worker partagee;
- pas de registre prive gere depuis l'interface;
- pas de mode air-gap complet;
- OpenShift SNO n'est pas encore implemente;
- pas encore d'authentification utilisateur ni de RBAC applicatif.

## Extension OpenShift SNO

L'extension prevue doit ajouter un installer independant avec :

- configuration du bastion RHEL;
- KVM/QEMU/libvirt;
- generation `install-config.yaml` et Agent-Based Installer ISO;
- DNS `api`, `api-int` et `*.apps`;
- creation et boot des VMs RHCOS;
- suivi de `openshift-install agent wait-for install-complete`;
- validation `oc get nodes`, ClusterOperators et console;
- teardown des VMs, volumes, reseaux et DNS geres;
- orchestration de plusieurs clusters SNO pour les workshops.

Cette logique doit utiliser de nouveaux templates et roles sans modifier les contrats Kubernetes/K3s existants.
