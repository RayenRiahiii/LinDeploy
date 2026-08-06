import subprocess
import threading
from pathlib import Path


class BaseRunner:
    def to_runner_path(self, path):
        return str(Path(path).resolve())

    def run_playbook(self, repo_root, playbook_relative_path, inventory_path, extra_vars_path=None):
        raise NotImplementedError

    def run_connectivity_check(self, repo_root, inventory_path):
        raise NotImplementedError

    def run_ad_hoc_command(self, repo_root, inventory_path, module_name, module_args):
        raise NotImplementedError

    @staticmethod
    def validate_repo_layout(repo_root):
        repo_root = Path(repo_root)
        ansible_config_path = repo_root / "ansible.cfg"
        roles_path = repo_root / "roles"

        if not ansible_config_path.exists():
            raise FileNotFoundError(f"Ansible config not found: {ansible_config_path}")
        if not roles_path.exists():
            raise FileNotFoundError(f"Roles path not found: {roles_path}")

        return ansible_config_path, roles_path

    @staticmethod
    def run_subprocess(command, cwd=None, env=None):
        return subprocess.run(
            command,
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            shell=False,
        )

    @staticmethod
    def run_streaming_subprocess(
        command,
        cwd=None,
        env=None,
        on_stdout_line=None,
        on_stderr_line=None,
        on_process_start=None,
    ):
        popen_kwargs = {
            "cwd": cwd,
            "env": env,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "text": True,
            "shell": False,
            "bufsize": 1,
        }
        if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_kwargs["start_new_session"] = True

        process = subprocess.Popen(
            command,
            **popen_kwargs,
        )
        if on_process_start:
            on_process_start(process)

        stdout_chunks = []
        stderr_chunks = []

        def reader(stream, chunks, callback):
            try:
                for line in iter(stream.readline, ""):
                    chunks.append(line)
                    if callback:
                        callback(line.rstrip("\r\n"))
            finally:
                stream.close()

        stdout_thread = threading.Thread(
            target=reader,
            args=(process.stdout, stdout_chunks, on_stdout_line),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=reader,
            args=(process.stderr, stderr_chunks, on_stderr_line),
            daemon=True,
        )

        stdout_thread.start()
        stderr_thread.start()
        process.wait()
        stdout_thread.join()
        stderr_thread.join()

        return subprocess.CompletedProcess(
            args=command,
            returncode=process.returncode,
            stdout="".join(stdout_chunks),
            stderr="".join(stderr_chunks),
        )
