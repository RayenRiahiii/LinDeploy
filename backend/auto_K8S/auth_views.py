import logging
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import Group
from django.db import IntegrityError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .jwt_auth import LinDeployJWTAuthentication, generate_jwt_token
from .permissions import OPERATOR_GROUP, can_operate

logger = logging.getLogger(__name__)
User = get_user_model()


def format_user_profile(user):
    return {
        "id": user.pk,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": f"{user.first_name} {user.last_name}".strip() or user.username,
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
        "can_operate": can_operate(user),
    }


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def auth_google(request):
    credential = request.data.get("credential") or request.data.get("id_token")
    if not credential:
        return Response(
            {"detail": "Missing Google credential or ID token in request payload."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    client_id = getattr(settings, "GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        return Response({"detail": "Google sign-in is not configured."}, status=503)

    try:
        request_transport = google_requests.Request()
        id_info = id_token.verify_oauth2_token(
            credential,
            request_transport,
            audience=client_id,
        )
    except Exception as exc:
        logger.warning("Google token verification failed: %s", exc)
        return Response(
            {"detail": f"Google authentication failed: {str(exc)}"},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    email = id_info.get("email", "").lower().strip()
    if not email:
        return Response(
            {"detail": "Google account did not return a valid email address."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    given_name = id_info.get("given_name", "")
    family_name = id_info.get("family_name", "")
    email_verified = id_info.get("email_verified", True)

    if not email_verified:
        return Response(
            {"detail": "Google account email is not verified by Google."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = User.objects.filter(email=email).first()
    if not user:
        username = email.split("@")[0]
        base_username = username
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base_username}_{counter}"
            counter += 1

        try:
            user = User.objects.create(
                username=username,
                email=email,
                first_name=given_name,
                last_name=family_name,
            )
            user.set_unusable_password()
            user.save()
            group, _ = Group.objects.get_or_create(name=OPERATOR_GROUP)
            user.groups.add(group)
        except IntegrityError:
            user = User.objects.filter(email=email).first()
            if not user:
                return Response(
                    {"detail": "Failed to provision local account from Google profile."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
    else:
        changed = False
        if not user.first_name and given_name:
            user.first_name = given_name
            changed = True
        if not user.last_name and family_name:
            user.last_name = family_name
            changed = True
        if changed:
            user.save()

    if not user.is_active:
        return Response(
            {"detail": "Your account has been deactivated. Contact your administrator."},
            status=status.HTTP_403_FORBIDDEN,
        )

    token = generate_jwt_token(user)
    return Response(
        {
            "token": token,
            "user": format_user_profile(user),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def auth_login(request):
    username_or_email = str(request.data.get("username") or request.data.get("email") or "").strip()
    password = str(request.data.get("password") or "").strip()

    if not username_or_email or not password:
        return Response(
            {"detail": "Username/email and password are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    username = username_or_email
    if "@" in username_or_email:
        user_by_email = User.objects.filter(email__iexact=username_or_email).first()
        if user_by_email:
            username = user_by_email.username

    user = authenticate(request, username=username, password=password)
    if not user:
        return Response(
            {"detail": "Invalid credentials. Please verify your username/email and password."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if not user.is_active:
        return Response(
            {"detail": "Your account has been deactivated. Contact your administrator."},
            status=status.HTTP_403_FORBIDDEN,
        )

    token = generate_jwt_token(user)
    return Response(
        {
            "token": token,
            "user": format_user_profile(user),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def auth_register(request):
    email = str(request.data.get("email") or "").strip().lower()
    username = str(request.data.get("username") or "").strip()
    password = str(request.data.get("password") or "").strip()
    first_name = str(request.data.get("first_name") or "").strip()
    last_name = str(request.data.get("last_name") or "").strip()

    if not email or "@" not in email:
        return Response({"detail": "A valid email address is required."}, status=status.HTTP_400_BAD_REQUEST)
    if not password or len(password) < 6:
        return Response({"detail": "Password must be at least 6 characters long."}, status=status.HTTP_400_BAD_REQUEST)

    if not username:
        username = email.split("@")[0]

    base_username = username
    counter = 1
    while User.objects.filter(username=username).exists():
        username = f"{base_username}_{counter}"
        counter += 1

    if User.objects.filter(email__iexact=email).exists():
        return Response({"detail": "An account with this email address already exists."}, status=status.HTTP_409_CONFLICT)

    try:
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
        )
        group, _ = Group.objects.get_or_create(name=OPERATOR_GROUP)
        user.groups.add(group)
    except Exception as exc:
        return Response({"detail": f"Failed to create account: {str(exc)}"}, status=status.HTTP_400_BAD_REQUEST)

    token = generate_jwt_token(user)
    return Response(
        {
            "token": token,
            "user": format_user_profile(user),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@authentication_classes([LinDeployJWTAuthentication])
@permission_classes([IsAuthenticated])
def auth_me(request):
    return Response(
        {
            "user": format_user_profile(request.user),
        }
    )
