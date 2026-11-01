from rest_framework.permissions import BasePermission

OPERATOR_GROUP = "LinDeploy Operators"


def can_operate(user):
    return bool(user and user.is_authenticated and user.is_active and (
        user.is_superuser or user.groups.filter(name=OPERATOR_GROUP).exists()
    ))


class IsOperator(BasePermission):
    message = "An administrator must authorize this account before it can manage infrastructure."

    def has_permission(self, request, view):
        return can_operate(request.user)
