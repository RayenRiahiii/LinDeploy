import time
import shlex
from pathlib import Path

from django.conf import settings

from .base import BaseRunner


class WslRunner(BaseRunner):
    def __init__(self, distro_name):
        self.distro_name = distro_name

    @staticmethod
    def windows_to_wsl_path(path):
        path = Path(path).resolve()
        drive = path.drive[0].lower()
        tail = str(path).replace("\\", "/")[2:]
        return f"/mnt/{drive}{tail}"

    def to_runner_path(self, path):
        return self.windows_to_wsl_path(path)

    def build_ansible_shell_command(self, repo_root, inventory_path, command_suffix):
        repo_root = Path(repo_root)
        ansible_config_path, roles_path = self.validate_repo_layout(repo_root)

        repo_root_wsl = self.windows_to_wsl_path(repo_root)
        ansible_config_path_wsl = self.windows_to_wsl_path(ansible_config_path)
        roles_path_wsl = self.windows_to_wsl_path(roles_path)

        return (
            f"cd '{repo_root_wsl}' && "
            f"ANSIBLE_CONFIG='{ansible_config_path_wsl}' "
            f"ANSIBLE_ROLES_PATH='{roles_path_wsl}' "
            f"ANSIBLE_CALLBACKS_ENABLED='ansible.posix.profile_tasks,ansible.posix.timer' "
            f"ANSIBLE_NOCOLOR='1' "
            f"ANSIBLE_TIMEOUT='{settings.ANSIBLE_TIMEOUT}' "
            f"ANSIBLE_HOST_KEY_CHECKING={'True' if settings.ANSIBLE_HOST_KEY_CHECKING else 'False'} "
            f"ANSIBLE_SSH_ARGS={shlex.quote(settings.ANSIBLE_SSH_ARGS)} "
            f"{command_suffix}"
        )

    def run_connectivity_check(self, repo_root, inventory_path):
        inventory_path_wsl = self.windows_to_wsl_path(inventory_path)
        shell_command = self.build_ansible_shell_command(
            repo_root=repo_root,
            inventory_path=inventory_path,
            command_suffix=f"ansible selected_hosts -i '{inventory_path_wsl}' -m ping",
        )

        started_at = time.perf_counter()
        result = self.run_subprocess(
            ["wsl", "-d", self.distro_name, "sh", "-lc", shell_command],
        )
        execution_seconds = round(time.perf_counter() - started_at, 3)

        return result, {
            "command": shell_command,
            "execution_seconds": execution_seconds,
            "runner_backend": "wsl",
            "runner_target": self.distro_name,
        }

    def run_playbook(
        self,
        repo_root,
        playbook_relative_path,
        inventory_path,
        on_stdout_line=None,
        on_stderr_line=None,
        on_process_start=None,
    ):
        repo_root = Path(repo_root)
        playbook_path = repo_root / playbook_relative_path
        inventory_path_wsl = self.windows_to_wsl_path(inventory_path)

        if not playbook_path.exists():
            raise FileNotFoundError(f"Playbook not found: {playbook_path}")

        shell_command = self.build_ansible_shell_command(
            repo_root=repo_root,
            inventory_path=inventory_path,
            command_suffix=f"ansible-playbook -i '{inventory_path_wsl}' '{playbook_relative_path}'",
        )

        started_at = time.perf_counter()
        result = self.run_streaming_subprocess(
            ["wsl", "-d", self.distro_name, "sh", "-lc", shell_command],
            on_stdout_line=on_stdout_line,
            on_stderr_line=on_stderr_line,
            on_process_start=on_process_start,
        )
        execution_seconds = round(time.perf_counter() - started_at, 3)

        return result, {
            "command": shell_command,
            "execution_seconds": execution_seconds,
            "runner_backend": "wsl",
            "runner_target": self.distro_name,
        }

    def run_ad_hoc_command(self, repo_root, inventory_path, module_name, module_args):
        inventory_path_wsl = self.windows_to_wsl_path(inventory_path)
        shell_command = self.build_ansible_shell_command(
            repo_root=repo_root,
            inventory_path=inventory_path,
            command_suffix=(
                f"ansible selected_hosts -i '{inventory_path_wsl}' "
                f"-m {shlex.quote(module_name)} "
                f"-a {shlex.quote(module_args)} "
                "-o"
            ),
        )

        started_at = time.perf_counter()
        result = self.run_subprocess(
            ["wsl", "-d", self.distro_name, "sh", "-lc", shell_command],
        )
        execution_seconds = round(time.perf_counter() - started_at, 3)

        return result, {
            "command": shell_command,
            "execution_seconds": execution_seconds,
            "runner_backend": "wsl",
            "runner_target": self.distro_name,
        }
