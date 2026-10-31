import os
import json
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)


def env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default):
    value = os.getenv(name)
    if not value:
        return default

    return [item.strip() for item in value.split(",") if item.strip()]


def env_json(name, default):
    value = os.getenv(name)
    if not value:
        return default

    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{name} must contain valid JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        raise ValueError(f"{name} must contain a JSON object")
    return parsed


# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/6.0/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "django-insecure-%bl0h92a7mfj1yp+stcvol&o-803m83=iiytdwkl3-yve_n%ax",
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env_bool("DJANGO_DEBUG", True)

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["127.0.0.1", "localhost"])


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'auto_K8S',
    'rest_framework',
    'corsheaders',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'backend.wsgi.application'


# Database
# https://docs.djangoproject.com/en/6.0/ref/settings/#databases

if env_bool("USE_SQLITE", False) or not os.getenv("DB_NAME"):
    sqlite_path = os.getenv("SQLITE_PATH")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": Path(sqlite_path) if sqlite_path else BASE_DIR / "db.sqlite3",
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("DB_NAME"),
            "USER": os.getenv("DB_USER"),
            "PASSWORD": os.getenv("DB_PASSWORD"),
            "HOST": os.getenv("DB_HOST", "localhost"),
            "PORT": os.getenv("DB_PORT", "5432"),
        }
    }


# Password validation
# https://docs.djangoproject.com/en/6.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/6.0/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = os.getenv("DJANGO_TIME_ZONE", "UTC")

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.0/howto/static-files/

STATIC_URL = 'static/'

DEFAULT_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", DEFAULT_DEV_ORIGINS)
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", DEFAULT_DEV_ORIGINS)

if DEBUG:
    CORS_ALLOWED_ORIGIN_REGEXES = [
        r"^http://localhost:\d+$",
        r"^http://127\.0\.0\.1:\d+$",
    ]

ANSIBLE_RUNNER_BACKEND = os.getenv("ANSIBLE_RUNNER_BACKEND", "wsl").lower()
ANSIBLE_REPO_ROOT = os.getenv("ANSIBLE_REPO_ROOT", "")
ANSIBLE_WSL_DISTRO = os.getenv("ANSIBLE_WSL_DISTRO", "Ubuntu")
ANSIBLE_TIMEOUT = int(os.getenv("ANSIBLE_TIMEOUT", "15"))
ANSIBLE_HOST_KEY_CHECKING = env_bool("ANSIBLE_HOST_KEY_CHECKING", False)
ANSIBLE_SSH_ARGS = os.getenv(
    "ANSIBLE_SSH_ARGS",
    "-C -o ControlMaster=auto -o ControlPersist=1800s "
    "-o ConnectTimeout=15 -o ConnectionAttempts=1 "
    "-o ServerAliveInterval=15 -o ServerAliveCountMax=3 "
    "-o Ciphers=chacha20-poly1305@openssh.com,aes128-gcm@openssh.com,aes256-gcm@openssh.com "
    "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null",
)

# OpenShift secrets are encrypted before their short-lived database storage.
# Production deployments should provide a dedicated Fernet key rather than
# relying on the DJANGO_SECRET_KEY-derived fallback.
OPENSHIFT_SECRET_ENCRYPTION_KEY = os.getenv("OPENSHIFT_SECRET_ENCRYPTION_KEY", "")
OPENSHIFT_SECRET_TTL_SECONDS = int(os.getenv("OPENSHIFT_SECRET_TTL_SECONDS", "1800"))
OPENSHIFT_RED_HAT_OFFLINE_TOKEN = os.getenv("OPENSHIFT_RED_HAT_OFFLINE_TOKEN", "")
OPENSHIFT_DEFAULT_VERSION = os.getenv("OPENSHIFT_DEFAULT_VERSION", "4.20")
# The disconnected SNO workflow always uses the server-managed mirror. Keep
# these values outside the request payload so users cannot redirect installs.
OPENSHIFT_MIRROR_REGISTRY = os.getenv("OPENSHIFT_MIRROR_REGISTRY", "registry.lab.test:8443").strip()
OPENSHIFT_MIRROR_VERSION = os.getenv("OPENSHIFT_MIRROR_VERSION", "4.20.3").strip()
OPENSHIFT_MIRROR_USERNAME = os.getenv("OPENSHIFT_MIRROR_USERNAME", "init").strip()
OPENSHIFT_MIRROR_PASSWORD = os.getenv("OPENSHIFT_MIRROR_PASSWORD", "")
OPENSHIFT_MIRROR_STORAGE_PATH = os.getenv(
    "OPENSHIFT_MIRROR_STORAGE_PATH", "/home/lindeploy/openshift-mirror"
).strip()
OPENSHIFT_MIRROR_CA_FILE = os.getenv("OPENSHIFT_MIRROR_CA_FILE", "").strip()

# Release hosts held by an orphaned queued/SSH-check execution. Running
# playbooks always have a runner PID and are never expired by this safeguard.
INSTALLATION_PRE_EXECUTION_STALE_SECONDS = int(
    os.getenv("INSTALLATION_PRE_EXECUTION_STALE_SECONDS", "900")
)

# Optional LAN pull-through mirror. When enabled, these values are injected into
# every installer run; users do not need to configure mirrors per deployment.
LINDEPLOY_MIRROR_ENABLED = env_bool("LINDEPLOY_MIRROR_ENABLED", False)
LINDEPLOY_MIRROR_CACHE_REQUIRED = env_bool("LINDEPLOY_MIRROR_CACHE_REQUIRED", False)
LINDEPLOY_KUBERNETES_PROFILE_ID = os.getenv(
    "LINDEPLOY_KUBERNETES_PROFILE_ID", "kubernetes-v1.36.3-amd64-all-supported"
)
LINDEPLOY_K3S_PROFILE_ID = os.getenv(
    "LINDEPLOY_K3S_PROFILE_ID", "k3s-v1.36.3+k3s1-amd64-all-supported"
)
LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP = env_bool(
    "LINDEPLOY_MIRROR_ALLOW_INSECURE_HTTP", False
)
LINDEPLOY_REGISTRY_MIRRORS = env_json("LINDEPLOY_REGISTRY_MIRRORS_JSON", {})
LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE = os.getenv(
    "LINDEPLOY_MIRROR_CA_CERTIFICATE_FILE", ""
)
LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED = env_bool(
    "LINDEPLOY_SYSTEM_PACKAGE_CACHE_ENABLED", False
)
LINDEPLOY_PACKAGE_MIRROR_BASE_URL = os.getenv(
    "LINDEPLOY_PACKAGE_MIRROR_BASE_URL", ""
).rstrip("/")
LINDEPLOY_K3S_INSTALL_SCRIPT_URL = os.getenv(
    "LINDEPLOY_K3S_INSTALL_SCRIPT_URL", ""
)
LINDEPLOY_K3S_CHANNEL_URL = os.getenv("LINDEPLOY_K3S_CHANNEL_URL", "")
LINDEPLOY_K3S_ARTIFACT_URL = os.getenv("LINDEPLOY_K3S_ARTIFACT_URL", "")
LINDEPLOY_CALICO_MANIFEST_URL = os.getenv(
    "LINDEPLOY_CALICO_MANIFEST_URL", ""
)
LINDEPLOY_CONTAINERD_RPM_BASEURL = os.getenv(
    "LINDEPLOY_CONTAINERD_RPM_BASEURL", ""
)
LINDEPLOY_CONTAINERD_RPM_GPGKEY = os.getenv(
    "LINDEPLOY_CONTAINERD_RPM_GPGKEY", ""
)
LINDEPLOY_CONTAINERD_APT_REPO_URL = os.getenv(
    "LINDEPLOY_CONTAINERD_APT_REPO_URL", ""
)
LINDEPLOY_CONTAINERD_APT_KEY_URL = os.getenv(
    "LINDEPLOY_CONTAINERD_APT_KEY_URL", ""
)
LINDEPLOY_KUBERNETES_RPM_BASEURL = os.getenv(
    "LINDEPLOY_KUBERNETES_RPM_BASEURL", ""
)
LINDEPLOY_KUBERNETES_RPM_GPGKEY = os.getenv(
    "LINDEPLOY_KUBERNETES_RPM_GPGKEY", ""
)
LINDEPLOY_KUBERNETES_APT_REPO_URL = os.getenv(
    "LINDEPLOY_KUBERNETES_APT_REPO_URL", ""
)
LINDEPLOY_KUBERNETES_APT_KEY_URL = os.getenv(
    "LINDEPLOY_KUBERNETES_APT_KEY_URL", ""
)
LINDEPLOY_MIRROR_PREWARM_INTERVAL_HOURS = int(
    os.getenv("LINDEPLOY_MIRROR_PREWARM_INTERVAL_HOURS", "24")
)
LINDEPLOY_MIRROR_PREWARM_TIMEOUT_SECONDS = int(
    os.getenv("LINDEPLOY_MIRROR_PREWARM_TIMEOUT_SECONDS", "10800")
)

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", CELERY_BROKER_URL)
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_DEFAULT_QUEUE = os.getenv("CELERY_TASK_DEFAULT_QUEUE", "lindeploy")
CELERY_BEAT_SCHEDULE = {
    "lindeploy-mirror-stable-prewarm": {
        "task": "auto_K8S.tasks.run_mirror_prewarm_task",
        "schedule": timedelta(hours=LINDEPLOY_MIRROR_PREWARM_INTERVAL_HOURS),
    }
}


# Google OAuth
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
