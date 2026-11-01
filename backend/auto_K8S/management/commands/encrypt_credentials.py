from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from auto_K8S.vault import encrypt_secret, decrypt_secret, is_encrypted, PREFIX, CredentialEncryptionError


class Command(BaseCommand):
    help = "Explicit, atomic migration of stored secrets; dry-run validates all values."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--decrypt", action="store_true", help="Restore plaintext for rollback; stop writers first.")

    def handle(self, *args, **options):
        changed = 0
        try:
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute("SELECT id, password, become_password, private_key FROM auto_K8S_credential")
                rows = cursor.fetchall()
                for pk, *old in rows:
                    new = []
                    for value in old:
                        plain = decrypt_secret(value) if is_encrypted(value) else value
                        if options["decrypt"]:
                            new.append(plain)
                        else:
                            new.append(value if value.startswith(PREFIX) else encrypt_secret(plain))
                    if new != old:
                        changed += 1
                        if not options["dry_run"]:
                            cursor.execute(
                                "UPDATE auto_K8S_credential SET password=%s, become_password=%s, private_key=%s "
                                "WHERE id=%s AND password=%s AND become_password=%s AND private_key=%s",
                                [*new, pk, *old],
                            )
                            if cursor.rowcount != 1:
                                raise CommandError("Credentials changed concurrently; migration rolled back. Stop writers and retry.")
        except CredentialEncryptionError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(f"{'Dry run: would change' if options['dry_run'] else 'Changed'} {changed} credential(s).")
