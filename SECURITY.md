# Security Policy

## Current Scope

LinDeploy executes privileged automation on remote machines. The current repository is intended for controlled labs, workshops, and development networks.

Do not expose the Django API, Redis, Celery worker, database, or development Vite server directly to the public Internet.

## Known Limitations

- Business APIs require authentication and explicit operator authorization; public registration grants no infrastructure access.
- New SSH passwords, sudo passwords and private keys are encrypted with a dedicated key. Legacy rows and backups may still contain plaintext until explicitly migrated.
- Generated Ansible inventory data can contain runtime secrets in memory and temporary controller files.
- Development defaults allow relaxed SSH host-key checking.
- SQLite is offered for local development, not shared production operation.

These limitations mean the current version must not be described as Internet-facing production-ready software.

## Required Deployment Controls

- Run LinDeploy on a dedicated administration network.
- Restrict API, Redis, database, and SSH access with host and network firewalls.
- Use a unique strong `DJANGO_SECRET_KEY` and set `DJANGO_DEBUG=False` outside local development.
- Use PostgreSQL with restricted credentials for a shared instance.
- Prefer dedicated SSH keys and least-privilege sudo policies.
- Protect the controller filesystem and database backups.
- Do not commit `.env`, inventory files, private keys, passwords, database files, or execution logs.
- Review cleanup targets before confirmation because teardown operations are destructive.
- Rotate a credential immediately if it appears in logs, screenshots, issues, or Git history.

## Before Production Use

The following work is required:

1. Review operator membership, public registration, session policy and access audit requirements.
2. Migrate legacy credentials and protect the dedicated encryption key separately from backups.
3. Verify diagnostic redaction against real deployment outputs and avoid publishing controller runtime files.
4. Enforce strict SSH host-key verification with managed known-host records.
5. Add API rate limits, audit logging, HTTPS, secure cookies, and production headers.
6. Isolate Celery queues and Redis with authentication and TLS where applicable.
7. Extend the isolated test CI with dependency, secret, SAST and playbook security scanning.
8. Perform a threat model and destructive-workflow review.

## Reporting a Vulnerability

Do not open a public issue containing credentials, private keys, target addresses, or exploit details. Contact the repository owner privately and include only the minimum information required to reproduce the issue.

## Safe activation

Follow [SECURITY_UPGRADE.md](docs/SECURITY_UPGRADE.md) for backups, key management, operator authorization, activation and rollback. No live data migration or key rotation is implicit in this patch.
