from rest_framework.permissions import BasePermission

OPERATOR_GROUP = "LinDeploy Operators"


def can_operate(user):
    return bool(user and user.is_authenticated and user.is_active)


class IsOperator(BasePermission):
    message = "Authentication is required to access infrastructure operations."

    def has_permission(self, request, view):
        return can_operate(request.user)
