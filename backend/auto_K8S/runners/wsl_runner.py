import time
import shlex
from types import SimpleNamespace
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
        extra_vars_path=None,
        on_stdout_line=None,
        on_stderr_line=None,
        on_process_start=None,
    ):
        repo_root = Path(repo_root)
        playbook_path = repo_root / playbook_relative_path
        inventory_path_wsl = self.windows_to_wsl_path(inventory_path)
        extra_vars_path_wsl = self.windows_to_wsl_path(extra_vars_path) if extra_vars_path else None

        if not playbook_path.exists():
            raise FileNotFoundError(f"Playbook not found: {playbook_path}")

        extra_vars_suffix = f" -e '@{extra_vars_path_wsl}'" if extra_vars_path_wsl else ""
        shell_command = self.build_ansible_shell_command(
            repo_root=repo_root,
            inventory_path=inventory_path,
            command_suffix=f"exec ansible-playbook -i '{inventory_path_wsl}' '{playbook_relative_path}'{extra_vars_suffix}",
        )

        pid_file = Path(inventory_path).with_suffix(".wsl-runner.pid")
        pid_file_wsl = self.windows_to_wsl_path(pid_file)
        wrapped_command = (
            f"printf '%s\\n' \"$$\" > '{pid_file_wsl}'; "
            "exec sh -c "
            + shlex.quote(shell_command)
        )

        def report_process_start(process):
            if not on_process_start:
                return
            for _ in range(50):
                try:
                    wsl_pid = int(pid_file.read_text(encoding="utf-8").strip())
                    on_process_start(SimpleNamespace(pid=-wsl_pid))
                    return
                except (FileNotFoundError, ValueError, OSError):
                    time.sleep(0.05)
            on_process_start(process)

        started_at = time.perf_counter()
        try:
            result = self.run_streaming_subprocess(
                ["wsl", "-d", self.distro_name, "sh", "-lc", wrapped_command],
                on_stdout_line=on_stdout_line,
                on_stderr_line=on_stderr_line,
                on_process_start=report_process_start,
            )
        finally:
            pid_file.unlink(missing_ok=True)
        execution_seconds = round(time.perf_counter() - started_at, 3)

        return result, {
            "command": shell_command,
            "execution_seconds": execution_seconds,
            "runner_backend": "wsl",
            "runner_target": self.distro_name,
        }

    def list_playbook_tasks(
        self,
        repo_root,
        playbook_relative_path,
        inventory_path,
        extra_vars_path=None,
    ):
        repo_root = Path(repo_root)
        playbook_path = repo_root / playbook_relative_path
        inventory_path_wsl = self.windows_to_wsl_path(inventory_path)
        extra_vars_path_wsl = self.windows_to_wsl_path(extra_vars_path) if extra_vars_path else None

        if not playbook_path.exists():
            raise FileNotFoundError(f"Playbook not found: {playbook_path}")

        extra_vars_suffix = f" -e '@{extra_vars_path_wsl}'" if extra_vars_path_wsl else ""
        shell_command = self.build_ansible_shell_command(
            repo_root=repo_root,
            inventory_path=inventory_path,
            command_suffix=(
                f"ansible-playbook -i '{inventory_path_wsl}' "
                f"'{playbook_relative_path}'{extra_vars_suffix} --list-tasks"
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
