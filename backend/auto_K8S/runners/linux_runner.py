import time
import shlex
from pathlib import Path

from django.conf import settings

from .base import BaseRunner


class LinuxRunner(BaseRunner):
    def build_command_env_prefix(self, repo_root):
        repo_root = Path(repo_root)
        ansible_config_path, roles_path = self.validate_repo_layout(repo_root)

        return {
            "ANSIBLE_CONFIG": str(ansible_config_path),
            "ANSIBLE_ROLES_PATH": str(roles_path),
            "ANSIBLE_CALLBACKS_ENABLED": "ansible.posix.profile_tasks,ansible.posix.timer",
            "ANSIBLE_NOCOLOR": "1",
            "ANSIBLE_TIMEOUT": str(settings.ANSIBLE_TIMEOUT),
            "ANSIBLE_HOST_KEY_CHECKING": "True" if settings.ANSIBLE_HOST_KEY_CHECKING else "False",
            "ANSIBLE_SSH_ARGS": settings.ANSIBLE_SSH_ARGS,
        }

    def run_connectivity_check(self, repo_root, inventory_path):
        repo_root = Path(repo_root)
        env_overrides = self.build_command_env_prefix(repo_root)
        command = ["ansible", "selected_hosts", "-i", str(Path(inventory_path).resolve()), "-m", "ping"]

        started_at = time.perf_counter()
        result = self.run_subprocess_with_env(command, cwd=repo_root, env_overrides=env_overrides)
        execution_seconds = round(time.perf_counter() - started_at, 3)

        return result, {
            "command": " ".join(command),
            "execution_seconds": execution_seconds,
            "runner_backend": "linux",
            "runner_target": str(repo_root),
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
        env_overrides = self.build_command_env_prefix(repo_root)

        if not playbook_path.exists():
            raise FileNotFoundError(f"Playbook not found: {playbook_path}")

        command = [
            "ansible-playbook",
            "-i",
            str(Path(inventory_path).resolve()),
            playbook_relative_path,
        ]

        started_at = time.perf_counter()
        result = self.run_subprocess_with_env(
            command,
            cwd=repo_root,
            env_overrides=env_overrides,
            on_stdout_line=on_stdout_line,
            on_stderr_line=on_stderr_line,
            on_process_start=on_process_start,
        )
        execution_seconds = round(time.perf_counter() - started_at, 3)

        return result, {
            "command": " ".join(command),
            "execution_seconds": execution_seconds,
            "runner_backend": "linux",
            "runner_target": str(repo_root),
        }

    def run_ad_hoc_command(self, repo_root, inventory_path, module_name, module_args):
        repo_root = Path(repo_root)
        env_overrides = self.build_command_env_prefix(repo_root)
        command = [
            "ansible",
            "selected_hosts",
            "-i",
            str(Path(inventory_path).resolve()),
            "-m",
            module_name,
            "-a",
            module_args,
            "-o",
        ]

        started_at = time.perf_counter()
        result = self.run_subprocess_with_env(command, cwd=repo_root, env_overrides=env_overrides)
        execution_seconds = round(time.perf_counter() - started_at, 3)

        return result, {
            "command": " ".join(shlex.quote(part) for part in command),
            "execution_seconds": execution_seconds,
            "runner_backend": "linux",
            "runner_target": str(repo_root),
        }

    @staticmethod
    def run_subprocess_with_env(
        command,
        cwd=None,
        env_overrides=None,
        on_stdout_line=None,
        on_stderr_line=None,
        on_process_start=None,
    ):
        import os

        env = os.environ.copy()
        env.update(env_overrides or {})

        return BaseRunner.run_streaming_subprocess(
            command,
            cwd=str(cwd) if isinstance(cwd, Path) else cwd,
            env=env,
            on_stdout_line=on_stdout_line,
            on_stderr_line=on_stderr_line,
            on_process_start=on_process_start,
        )
