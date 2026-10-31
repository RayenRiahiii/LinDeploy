# Manuel d'utilisation LinDeploy

Ce manuel decrit le parcours operateur pour gerer, installer et desinstaller Kubernetes,
K3s ou OpenShift SNO sur des machines Linux controlees par LinDeploy.

## 0. Demarrage 1-Click Conteneurise (Recommande)

LinDeploy fonctionne de maniere totalement conteneurisee avec Docker Compose sur n'importe quel systeme d'exploitation (Windows, Linux, macOS) et s'adapte automatiquement au reseau actif :

### Sous Windows :
```powershell
.\start.ps1
```

### Sous Linux ou macOS :
```bash
./start.sh
```

Le script detecte automatiquement votre adresse IP LAN active, genere les certificats TLS necessaires pour le miroir local, initialise la base SQLite persistante dans `./data/` et demarre l'ensemble des conteneurs :
- **Dashboard Web** : `http://localhost:5173` ou `http://<IP-LAN>:5173`
- **API Backend** : `http://localhost:8000/api/`
- **Passerelle Miroir** : `https://<IP-LAN>:8443/cache/`
- **Moteur Ansible** : Conteneur Linux natif (aucun WSL requis sous Windows).

Pour arreter les conteneurs :
- Windows : `.\stop.ps1`
- Linux / macOS : `./stop.sh`

---

## Prise en main : Authentification et Langue


### Authentification securisee
LinDeploy integre un systeme d'authentification utilisateur base sur JWT et sessions Django :
- **Inscription (`Sign Up`)** : Creez un compte operateur avec nom d'utilisateur et mot de passe.
- **Connexion (`Log In`)** : Connectez-vous pour acceder au tableau de bord et aux actions de deploiement.
- **Profil et Deconnexion** : Le menu utilisateur en haut a droite permet de verifier l'utilisateur actif et de se deconnecter.

### Selecteur de langue (EN / FR)
La barre de navigation superieure comporte un commutateur de langue instantane :
- **`EN` English** : Interface entierement en anglais.
- **`FR` Français** : Interface entierement en français.
La selection s'applique immediatement a l'ensemble des ecrans, modales, diagnostics et moniteurs de deploiement.

---

## 1. Comprendre les topologies de deploiement

LinDeploy prend en charge deux topologies principales pour Kubernetes et K3s :

### Mode Single Node (un cluster independant par cible)
Chaque machine cible selectionnee heberge son propre cluster autonome :

```text
Cible A -> cluster single-node A (Control Plane autonome)
Cible B -> cluster single-node B (Control Plane autonome)
Cible C -> cluster single-node C (Control Plane autonome)
```

### Mode Multi-Node (cluster partage)
Toutes les machines selectionnees rejoignent un unique cluster distribue :
- **Kubernetes Multi-Node** : LinDeploy cree un cluster kubeadm partage avec un bootstrap control plane, des control planes additionnels eventuels et des worker nodes.
- **K3s Multi-Node** : LinDeploy deploie un cluster K3s distribue avec un noeud Serveur (Control Plane) et un ensemble d'Agents (Workers), en orchestrant automatiquement l'echange securise du token de cluster.

Pour OpenShift, le deploiement cree une seule VM SNO (Single Node OpenShift) sur un hyperviseur KVM/libvirt selectionne.

### Statuts d'execution
Lorsqu'une cible echoue, l'execution continue sur les autres cibles eligibles :
- `success` : toutes les cibles ont reussi;
- `partial_success` : au moins une cible a reussi et au moins une a echoue;
- `failed` : aucune cible n'a termine correctement;
- `cancelled` : l'operateur a demande l'annulation immediate de l'execution.

---

## 2. Ajouter une credential

1. Ouvrir **Credentials**.
2. Cliquer sur **Add Credential**.
3. Renseigner un nom descriptif.
4. Choisir la methode d'authentification :
   - `Password` : Mot de passe SSH;
   - `SSH Key` : Cle privee SSH;
   - `SSH Public Key` : Cle publique SSH prealablement autorisee sur les cibles.
5. Renseigner le nom d'utilisateur distant (`Username`).
6. Renseigner le secret SSH et, si necessaire, le mot de passe sudo pour l'elevation de privileges.
7. Enregistrer.

> [!WARNING]
> Ne jamais utiliser un compte sans mot de passe, une cle privee partagee publiquement ou un compte root lorsque sudo suffit.

---

## 3. Ajouter une machine cible

1. Ouvrir **Hosts**.
2. Cliquer sur **Add Host**.
3. Renseigner un nom unique et une adresse IPv4 unique.
4. Conserver le port `22` sauf configuration SSH differente.
5. Choisir le systeme d'exploitation ou utiliser la valeur personnalisee validee.
6. Associer la credential correcte.
7. Activer la cible et enregistrer.

Le champ OS sert a l'inventaire utilisateur. Les playbooks verifient les facts Ansible reels de la machine avant d'appliquer les taches dependantes de la distribution.

---

## 4. Verifier SSH

1. Ouvrir **Installers**.
2. Choisir Kubernetes ou K3s.
3. Selectionner une ou plusieurs machines.
4. Cliquer sur **Verify SSH**.

La fenetre de resultat affiche chaque cible separement :

- `success` : SSH, Python et sudo sont accessibles;
- `unreachable` : adresse, route, pare-feu, port ou service SSH a verifier;
- `failed` : authentification, sudo ou prerequis distant a corriger.

Ne pas lancer l'installation sur une cible en echec avant d'avoir corrige son acces.

## 5. Installer Kubernetes

Le workflow Kubernetes installe et configure notamment :

- les prerequis systeme (swap desactive, modules noyau `overlay` et `br_netfilter`, sysctl `net.bridge.bridge-nf-call-iptables`, etc.);
- containerd avec le cgroup driver `systemd`;
- kubelet, kubeadm, kubectl et cri-tools;
- l'initialisation du control plane kubeadm;
- le reseau de pod Calico (avec pre-pull d'images);
- le kubeconfig utilisateur distant (`~/.kube/config`);
- en mode single-node, la suppression du taint control-plane pour executer les pods applicatifs;
- en mode multi-node, l'association coordonnee des workers et control planes additionnels au bootstrap.

Procedure :

1. Choisir **Kubernetes**.
2. Selectionner les cibles.
3. Choisir la topologie : **Single Node per target** ou **Multi Node** (assigner le bootstrap control plane, les control planes et les workers).
4. Executer **Verify SSH**.
5. Cliquer sur **Run Playbook**.
6. Suivre la phase, le heartbeat et les taches en direct dans le moniteur de deploiement.
7. Consulter le resultat detaille par cible.

Verification sur chaque cible reussie :

```bash
kubectl get nodes -o wide
kubectl get pods -A
sudo systemctl is-active kubelet
sudo systemctl is-active containerd
```

Le noeud doit etre `Ready` et les pods systeme doivent etre `Running` ou `Completed`.

---

## 6. Installer K3s

Le workflow K3s configure notamment :

- les prerequis systeme (firewalld, modules, sysctl);
- le service K3s (serveur ou agent);
- le kubeconfig utilisateur et l'acces direct a `kubectl`;
- les validations du noeud, de CoreDNS, de local-path-provisioner et metrics-server;
- en mode multi-node, la transmission securisee du jeton de cluster (`node-token`) et de l'URL du serveur d'API aux agents.

Procedure :

1. Choisir **K3s**.
2. Selectionner les cibles.
3. Choisir la topologie :
   - **Single Node per target** : chaque machine devient un cluster K3s autonome.
   - **Multi Node** : designer un noeud **Server** (control plane) et un ou plusieurs noeuds **Agent** (workers).
4. Executer **Verify SSH**.
5. Cliquer sur **Run Playbook**.
6. Suivre l'execution jusqu'au resultat final.

Verification :

```bash
kubectl get nodes -o wide
kubectl get pods -A
kubectl get --raw=/readyz
sudo systemctl is-active k3s
```

---

## 7. Detection et gestion des conflits

LinDeploy integre deux niveaux de verification prealable des conflits afin de proteger l'integrite de vos machines :

### A. Conflit inter-plateformes (Kubernetes vs K3s)
Kubernetes kubeadm et K3s ne doivent pas coexister sur la meme machine : ils partagent des ports reseau (ex: `6443`), des interfaces CNI, des repertoires et des runtimes de conteneurs. Si K3s est detecte lors d'un deploiement Kubernetes (ou inversement), LinDeploy bloque l'installation avant toute mutation systeme.

### B. Conflit intra-plateforme (meme plateforme deja installee)
Si Kubernetes est deja installe sur la cible lors d'un nouveau deploiement Kubernetes, ou si K3s est deja installe lors d'un deploiement K3s, une boite de dialogue de conflit s'affiche avec deux options claires :
1. **Conserver le cluster existant** : L'operation est arretee immediatement, preservant l'integralite du cluster en place sans aucune modification.
2. **Nettoyer et installer le nouveau cluster** : LinDeploy lance d'abord le playbook de nettoyage adapte pour supprimer proprement l'ancien cluster, puis execute l'installation fraiche du nouveau cluster.

---

## 8. Nettoyer Kubernetes

Deux actions de nettoyage sont disponibles :

### Reset Cluster
Utiliser ce mode pour reconstruire Kubernetes rapidement. Il reinitialise kubeadm, arrete les conteneurs et supprime les artefacts reseau, mais conserve les paquets Kubernetes et le runtime containerd deja installes.

### Full Uninstall
Utiliser ce mode pour retirer completement Kubernetes de la machine. Il desinstalle les paquets Kubernetes, supprime les configurations, le kubeconfig, les certificats et les artefacts geres par LinDeploy.

> [!CAUTION]
> Ces actions sont destructives. Toujours verifier les cibles selectionnees dans la fenetre de confirmation.

---

## 9. Nettoyer K3s

Le cleanup K3s retire le service systemd, les binaires (`k3s`, `k3s-killall.sh`), l'etat du cluster, le kubeconfig et les interfaces reseau gerees. LinDeploy prend en charge le nettoyage K3s single-node (`k3s_cleanup.yml`) et multi-node (`k3s_multi_node_cleanup.yml`).

Verification apres cleanup :

```bash
sudo systemctl status k3s --no-pager
test ! -e /usr/local/bin/k3s && echo "k3s binary removed"
test ! -e /etc/rancher/k3s && echo "k3s config removed"
```

Le message `Unit k3s.service could not be found` confirme la desinstallation reussie.

---

## 10. Historique et cleanup depuis l'historique

La page **History** conserve l'historique complet des executions : plateforme, cibles, statut, date, duree et diagnostics d'erreurs par host.

- **Cleanup direct** : Chaque entree historique permet de relancer en un clic un nettoyage cible de la plateforme deployee.
- **Suppression d'enregistrement** : Supprimer une ligne de l'historique efface uniquement le journal LinDeploy; cela ne modifie pas les clusters distants.

---

## 11. Annulation directe de l'exécution

Lors d'une exécution en cours dans le moniteur de déploiement (installation, nettoyage ou réinitialisation), l'opérateur peut cliquer directement sur le bouton d'annulation (**Cancel Installation** / **Cancel Cleanup** / **Cancel Reset**).

- **Interruption directe et immédiate** : LinDeploy arrête instantanément le processus Ansible en cours d'exécution sur le serveur (`SIGTERM` / arrêt immédiat du runner).
- **Libération des hôtes** : Les verrous et réservations sur les machines cibles sont immédiatement relâchés.
- **Rapport d'annulation** : L'état passe directement à `cancelled`, la notification confirme l'arrêt de l'opération et l'opérateur accède immédiatement au journal partiel de l'exécution.
- **Nettoyage optionnel ultérieur** : Si des composants partiels ont été écrits sur les cibles avant l'annulation, l'opérateur peut relancer à tout moment un workflow dédié de **Cleanup** ou **Reset** depuis l'interface ou l'historique des exécutions.

## 12. Règles opérateur

- Toujours verifier SSH avant un playbook.
- Ne jamais fermer Redis ou Celery pendant une execution.
- Ne pas lancer deux operations concurrentes sur la meme cible.
- Lire la confirmation avant un cleanup.
- Utiliser `Reset Cluster` pour une reinstallation Kubernetes rapide.
- Utiliser `Full Uninstall` pour restituer une machine sans Kubernetes.
- Consulter les diagnostics de la cible en premier; les sorties brutes sont reservees au depannage.

## 13. Installer OpenShift SNO deconnecte

1. Enregistrer un hote RHEL 8/9 x86_64 disposant de KVM/libvirt et des
   ressources requises.
2. Creer les enregistrements DNS stables du registre et du cluster.
3. Ouvrir **Installers -> OpenShift SNO**, choisir **Disconnected Agent-Based**
   et saisir une version exacte `4.x.y`.
4. Configurer la VM, ses reseaux, le pull secret Red Hat, la cle SSH publique,
   le FQDN Quay et l'archive officielle `mirror-registry.tar.gz`.
5. Lancer **Prepare mirror content** et attendre le statut `success`. Cette
   premiere synchronisation peut etre longue et volumineuse.
6. Ressaisir les secrets a usage unique si necessaire, confirmer le disque de
   la VM avec `ERASE /dev/...`, puis lancer **Start SNO installation**.
7. Verifier le node, la ClusterVersion et tous les ClusterOperators avec les
   commandes de [OPENSHIFT_SNO.md](OPENSHIFT_SNO.md).

Le bouton **Cleanup SNO** supprime uniquement la VM, son volume et les assets du
cluster dont le marqueur de propriete LinDeploy correspond. Le registre Quay,
son stockage et le workspace `oc-mirror` sont conserves pour les installations
suivantes.
