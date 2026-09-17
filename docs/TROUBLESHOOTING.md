# Depannage LinDeploy

## Le frontend affiche une erreur CORS ou `Failed to fetch`

Verifier :

```text
backend Django actif sur 127.0.0.1:8000
VITE_DJANGO_BASE_URL=http://127.0.0.1:8000
CORS_ALLOWED_ORIGINS contient l'URL Vite
```

Redemarrer Django apres une modification de `backend/.env`.

## Une installation reste `Queued`

Verifier Redis et Celery :

```bash
redis-cli ping
```

Puis consulter le terminal du worker. Une reponse Redis `PONG` ne suffit pas si le worker Celery n'est pas actif.

## Le role Ansible est introuvable

Executer Ansible depuis `backend/backend/Playbooks` et verifier :

```bash
ansible-config dump --only-changed
```

Le chemin `roles_path` doit pointer vers `roles`.

## SSH est inaccessible

Depuis le controleur :

```bash
ping -c 2 192.168.100.50
nc -vz 192.168.100.50 22
ssh -vvv user@192.168.100.50
```

Sur la cible Ubuntu :

```bash
sudo systemctl status ssh
sudo ss -lntp | grep ':22'
```

Sur CentOS/Rocky/RHEL :

```bash
sudo systemctl status sshd
sudo ss -lntp | grep ':22'
```

Un `Destination Host Unreachable` avant SSH indique un probleme de route, VLAN, Wi-Fi client isolation, bridge de virtualisation ou adresse IP, pas un probleme Ansible.

## `Missing sudo password`

La credential doit contenir le mot de passe sudo du compte distant lorsque sudo n'est pas configure en `NOPASSWD`.

## Kubernetes bloque car K3s est detecte

Executer le cleanup K3s propose par LinDeploy. Ne pas supprimer manuellement uniquement `/usr/local/bin/k3s`; les donnees, services et interfaces doivent etre nettoyes ensemble.

## K3s bloque car Kubernetes est detecte

Choisir le cleanup Kubernetes adapte :

- `Reset Cluster` conserve les paquets et convient a une future reinstallation Kubernetes;
- `Full Uninstall` retire Kubernetes avant le passage a K3s.

Pour passer de Kubernetes a K3s, utiliser le Full Uninstall lorsque les paquets et services Kubernetes ne sont plus necessaires.

## `kubectl` utilise localhost:8080

Le kubeconfig utilisateur manque ou n'est pas charge.

Kubernetes kubeadm :

```bash
ls -l ~/.kube/config
kubectl config current-context
```

K3s :

```bash
ls -l ~/.kube/config
command -v kubectl
kubectl get nodes
```

Relancer le playbook de la plateforme peut restaurer le kubeconfig utilisateur de facon idempotente.

## `kubectl` K3s lit `/etc/rancher/k3s/config.yaml`

Verifier que `/usr/local/bin/kubectl` est le wrapper gere par le role et non un simple lien vers `k3s` :

```bash
ls -l /usr/local/bin/kubectl
head -20 /usr/local/bin/kubectl
```

Relancer le playbook K3s pour corriger l'acces utilisateur.

## Calico reste en attente

Verifier :

```bash
kubectl get pods -n kube-system -o wide
kubectl describe daemonset calico-node -n kube-system
kubectl get events -A --sort-by=.lastTimestamp
sudo journalctl -u kubelet -n 100 --no-pager
```

Les causes frequentes sont l'acces au registre, une MTU incorrecte, firewalld, NetworkManager ou une ancienne interface CNI.

## K3s reste sur le demarrage du service

```bash
sudo systemctl status k3s --no-pager -l
sudo journalctl -u k3s -n 150 --no-pager
sudo ss -lntp | grep 6443
```

Verifier aussi CPU, memoire, DNS et acces aux registres.

## Collecter les informations utiles

Toujours fournir :

- le recap Ansible complet;
- la premiere tache en echec;
- `stderr` de cette tache;
- la distribution et sa version;
- l'etat du service concerne;
- les journaux des 100 a 150 dernieres lignes.
