from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from auto_K8S.permissions import OPERATOR_GROUP


class Command(BaseCommand):
    help = "Explicitly grant or revoke infrastructure access for an existing account."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--revoke", action="store_true")

    def handle(self, *args, **options):
        try:
            user = get_user_model().objects.get(username=options["username"])
        except get_user_model().DoesNotExist as exc:
            raise CommandError("Account does not exist.") from exc
        group, _ = Group.objects.get_or_create(name=OPERATOR_GROUP)
        if options["revoke"]:
            user.groups.remove(group)
        else:
            user.groups.add(group)
        self.stdout.write("Operator authorization updated.")
