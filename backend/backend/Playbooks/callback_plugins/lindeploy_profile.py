from datetime import datetime
from time import monotonic

from ansible.plugins.callback import CallbackBase


class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = "aggregate"
    CALLBACK_NAME = "lindeploy_profile"
    CALLBACK_NEEDS_ENABLED = True
    CALLBACK_NEEDS_WHITELIST = True

    def __init__(self):
        super().__init__()
        self.playbook_started = monotonic()
        self.current_task_name = None
        self.current_task_started = None
        self.task_durations = []

    @staticmethod
    def _format_duration(seconds):
        seconds = max(0.0, seconds)
        hours, remainder = divmod(int(seconds), 3600)
        minutes, whole_seconds = divmod(remainder, 60)
        return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}"

    def _finish_current_task(self):
        if self.current_task_started is None:
            return

        duration = monotonic() - self.current_task_started
        elapsed = monotonic() - self.playbook_started
        self.task_durations.append((self.current_task_name, duration))
        self._display.display(
            "TASK DURATION "
            f"[{self.current_task_name}] {duration:.2f}s | "
            f"ELAPSED {self._format_duration(elapsed)}"
        )
        self.current_task_name = None
        self.current_task_started = None

    def _start_task(self, task):
        self._finish_current_task()
        self.current_task_name = task.get_name().strip()
        self.current_task_started = monotonic()
        elapsed = monotonic() - self.playbook_started
        self._display.display(
            f"{datetime.now().strftime('%A %d %B %Y  %H:%M:%S')} "
            f"| ELAPSED {self._format_duration(elapsed)}"
        )

    def v2_playbook_on_start(self, playbook):
        self.playbook_started = monotonic()

    def v2_playbook_on_task_start(self, task, is_conditional):
        self._start_task(task)

    def v2_playbook_on_handler_task_start(self, task):
        self._start_task(task)

    def v2_playbook_on_stats(self, stats):
        self._finish_current_task()
        total = monotonic() - self.playbook_started

        self._display.banner("TASKS RECAP")
        for name, duration in sorted(
            self.task_durations, key=lambda item: item[1], reverse=True
        ):
            self._display.display(f"{name} {'-' * 8} {duration:.2f}s")

        self._display.banner("PLAYBOOK RECAP")
        days, remainder = divmod(int(total), 86400)
        hours, remainder = divmod(remainder, 3600)
        minutes, seconds = divmod(remainder, 60)
        self._display.display(
            "Playbook run took "
            f"{days} days, {hours} hours, {minutes} minutes, {seconds} seconds"
        )

