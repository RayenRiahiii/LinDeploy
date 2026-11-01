from django.core.management.base import BaseCommand
from django.db import transaction
from auto_K8S.models import Credential
from auto_K8S.vault import encrypt_secret, decrypt_secret, is_encrypted


class Command(BaseCommand):
    help = "Encrypt or decrypt Credential model secrets (password, become_password, private_key) using the configured vault key."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Simulate the encryption or decryption without saving changes to the database.",
        )
        parser.add_argument(
            "--decrypt",
            action="store_true",
            help="Decrypt encrypted secrets back to plaintext (for rollback procedures).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        decrypt_mode = options["decrypt"]

        action = "decrypt" if decrypt_mode else "encrypt"
        self.stdout.write(f"Starting credential vault {action} (dry_run={dry_run})...")

        credentials = Credential.objects.all()
        modified_count = 0

        with transaction.atomic():
            for cred in credentials:
                fields_to_update = []

                for field in ["password", "become_password", "private_key"]:
                    val = getattr(cred, field)
                    if not val:
                        continue

                    if decrypt_mode:
                        if is_encrypted(val):
                            decrypted = decrypt_secret(val)
                            setattr(cred, field, decrypted)
                            fields_to_update.append(field)
                    else:
                        if not is_encrypted(val):
                            encrypted = encrypt_secret(val)
                            setattr(cred, field, encrypted)
                            fields_to_update.append(field)

                if fields_to_update:
                    modified_count += 1
                    if not dry_run:
                        cred.save(update_fields=fields_to_update)

            if dry_run:
                self.stdout.write(
                    self.style.WARNING(
                        f"[DRY-RUN] Would {action} secrets on {modified_count} of {credentials.count()} credentials."
                    )
                )
            else:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Successfully {action}ed secrets on {modified_count} credentials."
                    )
                )
