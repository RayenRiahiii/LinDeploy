import re


class OutputRedactor:
    """Per-stream state prevents multiline keys from leaking between callbacks."""
    def __init__(self, secrets=()):
        self.in_private_key = False
        self.fragments = sorted({part for secret in secrets if secret
                                 for part in (secret, *secret.splitlines()) if part}, key=len, reverse=True)

    def __call__(self, line):
        if re.search(r"-----BEGIN .*PRIVATE KEY-----", line):
            self.in_private_key = True
        if self.in_private_key:
            if re.search(r"-----END .*PRIVATE KEY-----", line):
                self.in_private_key = False
            return "<redacted-private-key>\n" if line.endswith("\n") else "<redacted-private-key>"
        for fragment in self.fragments:
            line = line.replace(fragment, "<redacted>")
        return line
