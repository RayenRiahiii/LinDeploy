# Architecture technique de LinDeploy

## Objectif

LinDeploy separe l'experience operateur, l'orchestration asynchrone et l'automatisation systeme. OpenShift SNO utilise ses propres templates et roles sans melanger sa logique avec Kubernetes ou K3s.

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
| Kubernetes | Installation multi-node | `playbooks/k8s_multi_node.yml` |
| Kubernetes | Reset | `playbooks/k8s_cleanup.yml` |
| Kubernetes | Suppression complete | `playbooks/k8s_full_uninstall.yml` |
| K3s | Installation | `playbooks/k3s_single_node.yml` |
| K3s | Suppression | `playbooks/k3s_cleanup.yml` |
| OpenShift SNO | Installation connectee | `playbooks/openshift_sno.yml` |
| OpenShift SNO | Preparation du miroir | `playbooks/openshift_mirror_prepare.yml` |
| OpenShift SNO | Installation deconnectee | `playbooks/openshift_sno_disconnected.yml` |
| OpenShift SNO | Cleanup VM | `playbooks/openshift_sno_cleanup.yml` |

Roles principaux :

- `common` : paquets, swap, modules noyau, sysctl, SELinux et firewalld;
- `containerd` : runtime Kubernetes kubeadm;
- `kubernetes` : depot et paquets kubelet/kubeadm/kubectl;
- `kubeadm_init` : images, configuration et initialisation du control plane;
- `kubeadm_multi_bootstrap` : initialisation du premier control plane et
  generation des credentials de join temporaires;
- `kubeadm_multi_join` : ajout idempotent et verifie des control planes et workers;
- `kubeadm_multi_validate` : validation globale des nodes, de l'API, de Calico et CoreDNS;
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

- Kubernetes supporte le mode single-node par host et un cluster multi-node partage;
- K3s reste en mode single-node par host;
- plusieurs control planes ne constituent une topologie HA que si l'endpoint
  fourni repose sur un load balancer stable;
- le cleanup multi-node dedie et le retrait individuel d'un node restent a ajouter;
- le miroir OpenShift et l'hyperviseur KVM doivent actuellement etre le meme
  hote RHEL 8/9 x86_64;
- le workflow deconnecte synchronise une version OpenShift exacte mais pas de
  catalogues Operators optionnels;
- le deploiement de plusieurs SNO en une seule demande reste a ajouter;
- pas encore d'authentification utilisateur ni de RBAC applicatif.

## Architecture OpenShift SNO

L'installer OpenShift independant fournit :

- configuration du bastion RHEL;
- KVM/QEMU/libvirt;
- generation `install-config.yaml` et Agent-Based Installer ISO;
- DNS `api`, `api-int` et `*.apps`;
- creation et boot des VMs RHCOS;
- suivi de `openshift-install agent wait-for install-complete`;
- validation `oc get nodes`, ClusterOperators et console;
- un miroir Quay permanent et une synchronisation `oc-mirror` v2 pour le mode
  deconnecte;
- validation du marqueur de version, du certificat, des mappings et du tag de
  release avant creation de l'ISO;
- application apres installation des ressources IDMS/ITMS et signatures
  produites par `oc-mirror`;
- teardown de la VM, du volume et des assets proteges par un marqueur de
  propriete LinDeploy, sans suppression du miroir.

La separation entre le workflow connecte et le workflow deconnecte conserve les
contrats Kubernetes/K3s existants et evite toute dependance envers leurs roles.
