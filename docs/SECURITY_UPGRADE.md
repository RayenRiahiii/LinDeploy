# Activation des corrections de sÃ©curitÃ©

Les corrections sont prÃ©parÃ©es dans la branche `codex/security-fixes`, Ã  partir
de `fb638c5`. Aucun service existant, compte, fichier `.env` ni base rÃ©elle n'a
Ã©tÃ© modifiÃ© pendant leur dÃ©veloppement. L'activation reste une opÃ©ration
distincte, avec une fenÃªtre de maintenance et une sauvegarde prÃ©alable.

## Comportements corrigÃ©s

- Les routes mÃ©tier exigent un superutilisateur actif ou l'appartenance au
  groupe **LinDeploy Operators**. Une inscription publique ne donne aucun
  accÃ¨s Ã  l'infrastructure. L'interface explique l'autorisation en attente.
- Les champs Credential sont chiffrÃ©s lors des Ã©critures ORM et dÃ©chiffrÃ©s
  lors de la lecture Python. Les rÃ©ponses API ne contiennent pas ces secrets.
  La migration de schÃ©ma ne chiffre ni ne remplace les valeurs existantes.
- Les nouveaux secrets utilisent `enc:v2:` et une clÃ© Fernet dÃ©diÃ©e.
  Les valeurs historiques en clair et `enc:v1:` restent lisibles. Pour v1,
  la lecture accepte la clÃ© dÃ©diÃ©e historique ou la dÃ©rivation de l'ancienne
  clÃ© Django. Une clÃ© manquante, incorrecte ou des donnÃ©es corrompues Ã©chouent
  explicitement ; aucun secret chiffrÃ© n'est envoyÃ© comme mot de passe SSH.
- Un verrou d'Ã©criture SQL, acquis avant la lecture des rÃ©servations, protÃ¨ge
  lancement, relance, prise en charge du worker et annulation, sous SQLite
  comme sous PostgreSQL. Le verrou ne couvre aucun appel SSH ou Redis.
- L'identifiant Celery est enregistrÃ© avant l'envoi. Un envoi dont la livraison
  est incertaine garde la rÃ©servation. Annuler l'exÃ©cution permet de neutraliser
  une livraison tardive. Une livraison dupliquÃ©e ne relance pas un travail actif.
- Le worker surveille la demande d'annulation mÃªme sans sortie de la commande.
  Il arrÃªte le groupe de processus qu'il possÃ¨de, attend sa sortie puis finalise.
  L'API n'arrÃªte ni PID Ã©tranger ni processus Celery. Si le worker est absent ou
  l'arrÃªt non confirmÃ©, les hÃ´tes restent rÃ©servÃ©s et le diagnostic l'indique.
- Les secrets d'inventaire sont des scalaires Ansible `!unsafe`. La copie de
  diagnostic est masquÃ©e aprÃ¨s analyse structurÃ©e du YAML. Les sorties du
  runner masquent les secrets connus et les clÃ©s privÃ©es multilignes.
- Les helpers de dÃ©marrage conservent les octets existants de `.env.docker` et
  ajoutent uniquement les entrÃ©es absentes. Les valeurs prÃ©sentes, mÃªme vides,
  ne sont jamais remplacÃ©es. Compose refuse des clÃ©s obligatoires vides.

## PrÃ©parer l'activation

1. Examiner le diff et intÃ©grer les changements validÃ©s dans la copie utilisÃ©e
   pour dÃ©ployer. Ne pas lancer Compose depuis une deuxiÃ¨me copie contre les
   volumes de l'instance active.
2. Terminer les exÃ©cutions en cours et arrÃªter worker et beat pendant la
   migration. Ne pas dÃ©ployer ce changement au milieu d'un playbook.
3. Sauvegarder la base et les fichiers de configuration dans un emplacement
   protÃ©gÃ© hors Git. Pour SQLite en cours d'utilisation, employer
   `sqlite3.Connection.backup()` plutÃ´t qu'une copie non coordonnÃ©e du fichier.
   **Ne pas utiliser `dumpdata Credential` comme sauvegarde chiffrÃ©e** : les
   champs sont dÃ©chiffrÃ©s en mÃ©moire. Les anciennes sauvegardes peuvent contenir
   des secrets en clair et doivent rester protÃ©gÃ©es.
4. Conserver la clÃ© Django existante. Ajouter une clÃ© `LINDEPLOY_CREDENTIAL_KEY`
   indÃ©pendante et persistante ; la sauvegarder avec les donnÃ©es chiffrÃ©es.
   `start.ps1`/`start.sh` gÃ©nÃ¨rent une clÃ© uniquement si l'entrÃ©e est absente.
   Ils conservent aussi une Ã©ventuelle adresse LAN ou des ports personnalisÃ©s :
   si le rÃ©seau change, corriger ces valeurs explicitement.
5. Dans une installation Python locale, gÃ©nÃ©rer la clÃ© avec
   `Fernet.generate_key()` et l'enregistrer dans `backend/.env`. Docker reÃ§oit
   la mÃªme clÃ© depuis `.env.docker` dans le backend, le worker et beat. Ne jamais
   utiliser les clÃ©s synthÃ©tiques de tests/CI pour une installation rÃ©elle.

## Activer aprÃ¨s validation de la fenÃªtre de maintenance

Les commandes suivantes sont des instructions d'exploitation, pas des Ã©tapes
exÃ©cutÃ©es pendant cette correction. Adapter le dossier et le nom du compte.

AprÃ¨s reconstruction et migration du backend, avant reprise des workers :

```powershell
docker compose --env-file .env.docker exec -T backend python manage.py check
docker compose --env-file .env.docker exec -T backend python manage.py encrypt_credentials --dry-run
docker compose --env-file .env.docker exec -T backend python manage.py encrypt_credentials
docker compose --env-file .env.docker exec -T backend python manage.py authorize_operator NOM_DU_COMPTE
```

La commande de migration explicite vÃ©rifie toutes les valeurs, met Ã  jour les
anciens formats et annule l'ensemble des changements en cas d'erreur. ArrÃªter
les Ã©critures concurrentes pendant cette opÃ©ration. Les nouvelles Ã©critures
sont toujours chiffrÃ©es, y compris aprÃ¨s une migration antÃ©rieure.

Les utilisateurs existants non superutilisateurs ne reÃ§oivent pas de droits
automatiquement : autoriser explicitement chaque opÃ©rateur. Pour retirer les
droits, utiliser `authorize_operator NOM_DU_COMPTE --revoke`. La vÃ©rification
est faite cÃ´tÃ© serveur Ã  chaque requÃªte, mÃªme avec un ancien jeton encore valide.

VÃ©rifier ensuite la connexion d'un opÃ©rateur, le refus d'un compte non autorisÃ©,
le healthcheck public et la prÃ©sence des hÃ´tes attendus, puis reprendre les
workers. Tester d'abord sur des machines de laboratoire avant usage rÃ©el.

## Retour arriÃ¨re

ArrÃªter les Ã©critures, worker et beat. Conserver les clÃ©s utilisÃ©es ainsi que la
sauvegarde initiale. Pour une restauration complÃ¨te, restaurer ensemble la base
et sa configuration correspondante.

Si le retour arriÃ¨re porte seulement sur le code, l'ancienne version ne sait pas
lire les valeurs v2. Avec le nouveau code et les bonnes clÃ©s encore disponibles,
valider `encrypt_credentials --decrypt --dry-run`, puis exÃ©cuter
`encrypt_credentials --decrypt` pendant l'arrÃªt des Ã©critures. Cette action
restaure volontairement des secrets en clair. Ne pas rÃ©trÃ©cir automatiquement
les colonnes : de nouvelles valeurs peuvent dÃ©passer les anciennes limites.
La table de verrouillage additionnelle peut rester prÃ©sente avec l'ancien code.

## Limites et contrÃ´les restant nÃ©cessaires

- Une annulation ne restaure pas les modifications dÃ©jÃ  faites sur les hÃ´tes.
  L'arrÃªt du contrÃ´leur ne prouve pas l'arrÃªt de toute commande distante dÃ©jÃ 
  dÃ©tachÃ©e ; vÃ©rifier les machines aprÃ¨s une interruption avant une rÃ©installation.
- Ne pas libÃ©rer manuellement les rÃ©servations d'un worker perdu avant d'avoir
  vÃ©rifiÃ© et arrÃªtÃ© ses processus. Le systÃ¨me privilÃ©gie la conservation de la
  rÃ©servation Ã  une exÃ©cution concurrente potentiellement destructive.
- Les tests de processus sont exÃ©cutÃ©s sous Linux isolÃ©. Le chemin WSL utilise
  un groupe de processus Linux identifiÃ©, mais nÃ©cessite un essai WSL complet
  avant exploitation native Windows hors Docker.
- Les anciennes clÃ©s Django publiques sont conservÃ©es pour Ã©viter une rotation
  implicite. Planifier leur rotation sÃ©parÃ©ment, aprÃ¨s migration v1 vers v2 et
  expiration des secrets OpenShift temporaires. La rotation invalide les jetons.
- HTTPS, politique SSH stricte, sauvegardes, audit d'accÃ¨s et validation sur les
  plateformes cibles restent nÃ©cessaires avant de dÃ©clarer une aptitude production.

## VÃ©rifications reproductibles

Avec des clÃ©s synthÃ©tiques et un stockage de test, jamais la base rÃ©elle :

```text
python manage.py makemigrations --check --dry-run
python manage.py test auto_K8S --noinput
npm run lint
node --test src/components/openshift/form.test.mjs
npm run build
pwsh -File infra/tests/test_initialize_env.ps1
bash infra/tests/test_initialize_env.sh
```

La CI utilise Celery en mÃ©moire et ne contacte aucune machine administrÃ©e.
