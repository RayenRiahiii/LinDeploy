from django.db import models

from .vault import decrypt_secret, encrypt_secret


class EncryptedSecretField(models.TextField):
    """Plaintext in Python, authenticated ciphertext in the database.

    Legacy plaintext remains readable; saving a value encrypts it. Bulk SQL and
    database backups deliberately retain the stored representation.
    """

    def from_db_value(self, value, expression, connection):
        return decrypt_secret(value) if value else value

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        return encrypt_secret(value) if value else value
