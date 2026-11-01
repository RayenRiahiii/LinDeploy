import subprocess
import threading
import os
import signal
import time
from pathlib import Path
from .control import cancel_check, secret_values, ProcessStopUnconfirmed
from ..log_safety import OutputRedactor


class BaseRunner:
    def to_runner_path(self, path):
        return str(Path(path).resolve())

    def run_playbook(self, repo_root, playbook_relative_path, inventory_path, extra_vars_path=None):
        raise NotImplementedError

    def list_playbook_tasks(
        self,
        repo_root,
        playbook_relative_path,
        inventory_path,
        extra_vars_path=None,
    ):
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
        return BaseRunner.run_streaming_subprocess(command, cwd=cwd, env=env)

    @staticmethod
    def run_streaming_subprocess(
        command,
        cwd=None,
        env=None,
        on_stdout_line=None,
        on_stderr_line=None,
        on_process_start=None,
        terminate_process=None,
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
        stdout_chunks = []
        stderr_chunks = []
        reader_errors = []
        secrets = secret_values.get()

        def reader(stream, chunks, callback):
            redact = OutputRedactor(secrets)
            try:
                for line in iter(stream.readline, ""):
                    line = redact(line)
                    chunks.append(line)
                    if callback:
                        callback(line.rstrip("\r\n"))
            except Exception as exc:
                reader_errors.append(exc)
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
        check = cancel_check.get()

        def stop_owned_process():
            try:
                if terminate_process:
                    terminate_process(process)
                elif os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                   check=True, capture_output=True, timeout=10)
                else:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    time.sleep(1)
                    # Also remove children if their parent exited on SIGTERM.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                process.wait(timeout=10)
                stdout_thread.join(timeout=5)
                stderr_thread.join(timeout=5)
                if stdout_thread.is_alive() or stderr_thread.is_alive():
                    raise RuntimeError("Process output streams are still open.")
            except Exception as exc:
                raise ProcessStopUnconfirmed("Process stop could not be confirmed; hosts remain reserved.") from exc

        stopping = False
        try:
            if on_process_start:
                on_process_start(process)
            while process.poll() is None or stdout_thread.is_alive() or stderr_thread.is_alive():
                if reader_errors:
                    raise reader_errors[0]
                if check and check():
                    stopping = True
                    stop_owned_process()
                    break
                time.sleep(0.2)
        except BaseException:
            if not stopping:
                stop_owned_process()
            raise
        if reader_errors:
            raise reader_errors[0]

        return subprocess.CompletedProcess(
            args=command,
            returncode=process.returncode,
            stdout="".join(stdout_chunks),
            stderr="".join(stderr_chunks),
        )
