# Security Policy

## Current Scope

LinDeploy executes privileged automation on remote machines. The current repository is intended for controlled labs, workshops, and development networks.

Do not expose the Django API, Redis, Celery worker, database, or development Vite server directly to the public Internet.

## Known Limitations

- Application-level authentication and role-based authorization are not implemented yet.
- SSH passwords, sudo passwords, and private keys are currently stored by the Django data model without an external secret manager.
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

1. Add user authentication, sessions, CSRF validation, and RBAC.
2. Encrypt credentials at rest or integrate Vault/another secret manager.
3. Stop persisting secret-bearing inventory content and redact secrets from every diagnostic path.
4. Enforce strict SSH host-key verification with managed known-host records.
5. Add API rate limits, audit logging, HTTPS, secure cookies, and production headers.
6. Isolate Celery queues and Redis with authentication and TLS where applicable.
7. Add dependency, secret, SAST, and playbook linting in CI.
8. Perform a threat model and destructive-workflow review.

## Reporting a Vulnerability

Do not open a public issue containing credentials, private keys, target addresses, or exploit details. Contact the repository owner privately and include only the minimum information required to reproduce the issue.
