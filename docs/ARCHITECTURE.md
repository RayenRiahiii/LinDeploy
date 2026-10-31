# Architecture technique de LinDeploy

## Objectif

LinDeploy separe l'experience operateur, l'orchestration asynchrone et l'automatisation systeme. OpenShift SNO utilise ses propres templates et roles sans melanger sa logique avec Kubernetes ou K3s.

## Composants

### Frontend

- React et TypeScript;
- Vite pour le developpement et le build;
- Mantine UI et Tabler Icons;
- Internationalisation complete bilingue (anglais `EN` et français `FR`) avec bascule instantanee;
- Authentification avec stockage de session/JWT (`AuthContext`), routes protegees, ecrans de connexion et d'inscription;
- pages distinctes pour dashboard, hosts, credentials, installers, executions et historique;
- polling de l'API pendant une execution, suivi du heartbeat et arret direct en un clic sur annulation;
- resultats et diagnostics structures par cible.

### Backend

- Django et Django REST Framework;
- Authentification securisee JWT et sessions utilisateur;
- validation des hosts, credentials (Password, Private Key, Public Key) et chemins de playbooks;
- generation d'un inventaire temporaire pour les cibles selectionnees;
- selection explicite du runner Linux ou WSL;
- modeles `Installation` et `InstallationTarget` pour separer le statut global du statut par host;
- detection proactive des conflits de plateforme (inter-plateformes et intra-plateforme);
- annulation immediate securisee et historique;
- detection des resultats partiels.

Le nom interne `auto_K8S` est historique. Le renommer exige une migration Django controlee et n'est pas necessaire au changement de marque LinDeploy.

### Execution asynchrone

- Redis transporte les messages Celery;
- Celery execute les controles SSH et les playbooks longs hors du processus HTTP;
- le frontend interroge l'etat persiste dans la base;
- les sorties sont analysees pour produire une synthese par cible.

### Conteneurisation (Docker Compose)

La pile applicative fonctionne dans un environnement multi-conteneurs unifie :
- **rontend** : Image alpine Nginx servant les assets Vite et assurant le reverse-proxying de /api/ vers le backend ;
- **ackend** : Image Debian bookworm Python 3.12 executant Django via Gunicorn avec migrations automatiques ;
- **celery-worker** : Image Python avec Ansible Core 2.17.7 natif Linux (ANSIBLE_RUNNER_BACKEND=linux), OpenSSH et collections Ansible (nsible.posix, community.general, community.crypto). Aucun sous-systeme WSL n'est requis sur l'hote ;
- **celery-beat** : Planificateur periodique des verifications et prechauffages du miroir ;
- **
edis** : Broker Redis 7 Alpine pour les messages et resultats de taches ;
- **Miroir LAN** : Passerelle Nginx (gateway), cache applicatif (rtifact-cache) et registres OCI Zot (k8s, quay, docker).

Les playbooks et roles (ackend/backend/Playbooks) ainsi que le miroir (infra/mirror) sont montes en volumes en direct, permettant un hot-reload immediat de l'automatisation sans recompiler d'images.

### Ansible

Le depot embarque est `backend/backend/Playbooks`.

Playbooks principaux :

| Plateforme | Action | Playbook |
|---|---|---|
| Kubernetes | Installation single-node | `playbooks/k8s_single_node.yml` |
| Kubernetes | Installation multi-node | `playbooks/k8s_multi_node.yml` |
| Kubernetes | Reset | `playbooks/k8s_cleanup.yml` |
| Kubernetes | Suppression complete | `playbooks/k8s_full_uninstall.yml` |
| K3s | Installation single-node | `playbooks/k3s_single_node.yml` |
| K3s | Installation multi-node | `playbooks/k3s_multi_node.yml` |
| K3s | Suppression single-node | `playbooks/k3s_cleanup.yml` |
| K3s | Suppression multi-node | `playbooks/k3s_multi_node_cleanup.yml` |
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
- `k3s` : installation, configuration, kubeconfig et health checks (single-node et multi-node);
- `k3s_cleanup` : desinstallation et suppression propre K3s;
- `kubernetes_cleanup` : reset et suppression complete Kubernetes.

## Cycle d'une execution

```text
1. Selection de l'installer et des hosts
2. Validation API
3. Creation de Installation + InstallationTarget
4. Mise en file Celery
5. Generation de l'inventaire temporaire
6. Verification SSH par host
7. Detection de conflit de plateforme (inter ou intra-plateforme)
8. Execution Ansible sur les hosts eligibles
9. Analyse du recap Ansible par host
10. Persistance des statuts, timings et diagnostics
11. Affichage success, partial_success, failed ou cancelled (arret direct et liberation des cibles)
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

- Kubernetes et K3s supportent les modes single-node par host et multi-node partage;
- plusieurs control planes ne constituent une topologie HA que si l'endpoint
  fourni repose sur un load balancer stable;
- le retrait individuel a chaud d'un noeud d'un cluster multi-node reste a ajouter;
- le miroir OpenShift et l'hyperviseur KVM doivent actuellement etre le meme
  hote RHEL 8/9 x86_64;
- le workflow deconnecte synchronise une version OpenShift exacte mais pas de
  catalogues Operators optionnels;
- le deploiement de plusieurs SNO en une seule demande reste a ajouter;
- la granularite fine des permissions RBAC reste a ajouter (l'authentification utilisateur et la gestion des sessions sont operationnelles).

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
