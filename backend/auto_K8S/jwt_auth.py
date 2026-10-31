import datetime
import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication, get_authorization_header

User = get_user_model()

JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7


def generate_jwt_token(user):
    payload = {
        "sub": str(user.pk),
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "is_staff": user.is_staff,
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.datetime.now(datetime.timezone.utc),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_jwt_token(token):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise exceptions.AuthenticationFailed("Session token has expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise exceptions.AuthenticationFailed("Invalid authentication token.")


class LinDeployJWTAuthentication(BaseAuthentication):
    def authenticate(self, request):
        auth_header = get_authorization_header(request).split()
        if not auth_header:
            return None

        if len(auth_header) == 1 or auth_header[0].lower() not in (b"bearer", b"jwt"):
            return None

        if len(auth_header) > 2:
            raise exceptions.AuthenticationFailed("Invalid token header. No spaces permitted inside token.")

        try:
            token = auth_header[1].decode("utf-8")
        except UnicodeError:
            raise exceptions.AuthenticationFailed("Invalid token encoding. Token must be valid UTF-8.")

        payload = decode_jwt_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise exceptions.AuthenticationFailed("Invalid token payload: missing subject.")

        try:
            user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            raise exceptions.AuthenticationFailed("User for this session no longer exists.")

        if not user.is_active:
            raise exceptions.AuthenticationFailed("User account is inactive or disabled.")

        return (user, token)

    def authenticate_header(self, request):
        return 'Bearer realm="api"'
