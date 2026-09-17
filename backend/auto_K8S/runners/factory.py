from django.conf import settings

from .linux_runner import LinuxRunner
from .wsl_runner import WslRunner


def get_runner():
    backend = getattr(settings, "ANSIBLE_RUNNER_BACKEND", "wsl").lower()

    if backend == "wsl":
        return WslRunner(distro_name=settings.ANSIBLE_WSL_DISTRO)

    if backend == "linux":
        return LinuxRunner()

    raise ValueError(
        f"Unsupported ANSIBLE_RUNNER_BACKEND '{backend}'. "
        "Expected 'wsl' or 'linux'."
    )
