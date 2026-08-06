# Manuel d'utilisation LinDeploy

Ce manuel decrit le parcours operateur pour installer et supprimer Kubernetes ou K3s sur une ou plusieurs machines.

## 1. Comprendre le mode multi-cibles

Chaque cible selectionnee devient un cluster single-node independant :

```text
Cible A -> cluster single-node A
Cible B -> cluster single-node B
Cible C -> cluster single-node C
```

LinDeploy ne cree pas encore un cluster unique compose de plusieurs control planes et workers.

Lorsqu'une cible echoue, l'execution continue sur les autres cibles eligibles. Le resultat final peut etre :

- `success` : toutes les cibles ont reussi;
- `partial_success` : au moins une cible a reussi et au moins une a echoue;
- `failed` : aucune cible n'a termine correctement;
- `cancelled` : l'operateur a demande l'annulation.

## 2. Ajouter une credential

1. Ouvrir **Credentials**.
2. Cliquer sur **Add Credential**.
3. Donner un nom descriptif.
4. Choisir `Password` ou `SSH Key`.
5. Renseigner le nom d'utilisateur distant.
6. Renseigner le secret SSH et, si necessaire, le mot de passe sudo.
7. Enregistrer.

Ne jamais utiliser un compte sans mot de passe, une cle privee partagee publiquement ou un compte root lorsque sudo suffit.

## 3. Ajouter une machine cible

1. Ouvrir **Hosts**.
2. Cliquer sur **Add Host**.
3. Renseigner un nom unique et une adresse IPv4 unique.
4. Conserver le port `22` sauf configuration SSH differente.
5. Choisir le systeme d'exploitation ou utiliser la valeur personnalisee validee.
6. Associer la credential correcte.
7. Activer la cible et enregistrer.

Le champ OS sert a l'inventaire utilisateur. Les playbooks verifient les facts Ansible reels de la machine avant d'appliquer les taches dependantes de la distribution.

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

- les prerequis systeme;
- les modules noyau et sysctl;
- containerd avec le cgroup driver systemd;
- kubelet, kubeadm, kubectl et cri-tools;
- un control plane kubeadm;
- Calico;
- le kubeconfig de l'utilisateur distant;
- la suppression du taint control-plane pour permettre les workloads locaux.

Procedure :

1. Choisir **Kubernetes**.
2. Selectionner les cibles.
3. Executer **Verify SSH**.
4. Cliquer sur **Run Playbook**.
5. Suivre la phase et la tache courante dans le moniteur.
6. Consulter le resultat par cible.

Verification sur chaque cible reussie :

```bash
kubectl get nodes -o wide
kubectl get pods -A
sudo systemctl is-active kubelet
sudo systemctl is-active containerd
```

Le noeud doit etre `Ready` et les pods systeme doivent etre `Running` ou `Completed`.

## 6. Installer K3s

Le workflow K3s configure notamment :

- les prerequis systeme;
- le service K3s single-node;
- le kubeconfig utilisateur;
- l'acces direct a `kubectl`;
- les regles firewalld lorsque le service est utilise;
- les validations du noeud, CoreDNS, local-path-provisioner et metrics-server.

Procedure :

1. Choisir **K3s**.
2. Selectionner les cibles.
3. Executer **Verify SSH**.
4. Cliquer sur **Run Playbook**.
5. Suivre l'execution jusqu'au resultat final.

Verification :

```bash
kubectl get nodes -o wide
kubectl get pods -A
kubectl get --raw=/readyz
sudo systemctl is-active k3s
```

## 7. Conflit Kubernetes/K3s

Kubernetes kubeadm et K3s ne doivent pas etre geres simultanement sur la meme cible par LinDeploy. Ils partagent des ports, interfaces, repertoires CNI, kubeconfig et composants de runtime.

Si LinDeploy detecte l'autre plateforme :

1. il bloque l'installation avant les modifications systeme;
2. il affiche la plateforme detectee;
3. il propose le cleanup adapte;
4. l'operateur confirme explicitement la suppression;
5. l'installation peut etre relancee apres un cleanup reussi.

## 8. Nettoyer Kubernetes

Deux actions sont disponibles :

### Reset Cluster

Utiliser ce mode pour reconstruire Kubernetes rapidement. Il supprime l'etat du cluster et les artefacts reseau, mais conserve les paquets Kubernetes et containerd.

### Full Uninstall

Utiliser ce mode pour retirer Kubernetes de la machine. Il supprime l'etat du cluster, le kubeconfig, les paquets Kubernetes et leurs artefacts geres.

Ces actions sont destructives. Verifier les cibles selectionnees dans la fenetre de confirmation.

## 9. Nettoyer K3s

Le cleanup K3s retire le service, les binaires, l'etat du cluster, le kubeconfig et les interfaces reseau gerees par K3s.

Verification apres cleanup :

```bash
sudo systemctl status k3s --no-pager
test ! -e /usr/local/bin/k3s && echo "k3s binary removed"
test ! -e /etc/rancher/k3s && echo "k3s config removed"
```

Le service peut repondre `Unit k3s.service could not be found`, ce qui est attendu apres une suppression complete.

## 10. Historique et cleanup depuis l'historique

La page **History** conserve le type de plateforme, les cibles, le statut, la duree et les resultats par host.

Une action de cleanup lance le playbook correspondant a la plateforme de l'installation historique et aux cibles associees. Toujours verifier la liste affichee avant confirmation.

Supprimer une ligne d'historique efface uniquement l'enregistrement de LinDeploy. Cela ne supprime pas le cluster distant.

## 11. Annulation

Le bouton d'annulation demande au backend d'arreter l'execution active. Selon la tache Ansible en cours, l'arret peut ne pas etre instantane.

Apres une annulation :

1. consulter le resultat par cible;
2. verifier l'etat distant;
3. utiliser le cleanup de la plateforme si l'installation est partielle;
4. relancer seulement apres un cleanup ou une validation explicite.

## 12. Regles operateur

- Toujours verifier SSH avant un playbook.
- Ne jamais fermer Redis ou Celery pendant une execution.
- Ne pas lancer deux operations concurrentes sur la meme cible.
- Lire la confirmation avant un cleanup.
- Utiliser `Reset Cluster` pour une reinstallation Kubernetes rapide.
- Utiliser `Full Uninstall` pour restituer une machine sans Kubernetes.
- Consulter les diagnostics de la cible en premier; les sorties brutes sont reservees au depannage.
