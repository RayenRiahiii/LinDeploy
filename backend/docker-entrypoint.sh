#!/usr/bin/env bash
set -e

wait_for_redis() {
    echo "[LinDeploy] Checking Redis connectivity..."
    python - <<'EOF'
import os
import sys
import time
import socket
import urllib.parse

broker_url = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
if broker_url.startswith("redis://"):
    parsed = urllib.parse.urlparse(broker_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 6379
    print(f"[LinDeploy] Waiting for Redis at {host}:{port}...")
    for attempt in range(45):
        try:
            with socket.create_connection((host, port), timeout=2):
                print(f"[LinDeploy] Redis is available at {host}:{port}.")
                sys.exit(0)
        except OSError:
            time.sleep(1)
    print(f"[LinDeploy] Timeout waiting for Redis at {host}:{port}.", file=sys.stderr)
    sys.exit(1)
EOF
}

ROLE="${1:-web}"

# Ensure data and runtime directories exist
mkdir -p /app/data /app/runtime /app/logs

# Seed initial SQLite database if volume is empty but a database template exists
if [ ! -f /app/data/db.sqlite3 ] && [ -f /app/db.sqlite3 ]; then
    echo "[LinDeploy] Seeding initial database into persistent volume..."
    cp /app/db.sqlite3 /app/data/db.sqlite3
fi

case "$ROLE" in
    web)
        wait_for_redis
        echo "[LinDeploy] Running database migrations..."
        python manage.py migrate --noinput

        echo "[LinDeploy] Starting Gunicorn HTTP server on 0.0.0.0:8000..."
        exec gunicorn backend.wsgi:application \
            --bind 0.0.0.0:8000 \
            --workers "${GUNICORN_WORKERS:-3}" \
            --threads "${GUNICORN_THREADS:-4}" \
            --timeout "${GUNICORN_TIMEOUT:-300}" \
            --access-logfile - \
            --error-logfile -
        ;;

    worker)
        wait_for_redis
        echo "[LinDeploy] Starting Celery worker for queue: ${CELERY_TASK_DEFAULT_QUEUE:-lindeploy}..."
        exec celery -A backend worker \
            --loglevel="${CELERY_LOG_LEVEL:-info}" \
            -Q "${CELERY_TASK_DEFAULT_QUEUE:-lindeploy},celery" \
            -c "${CELERY_CONCURRENCY:-4}"
        ;;

    beat)
        wait_for_redis
        echo "[LinDeploy] Starting Celery Beat scheduler..."
        exec celery -A backend beat \
            --loglevel="${CELERY_LOG_LEVEL:-info}" \
            --pidfile=/tmp/celerybeat.pid \
            --schedule=/tmp/celerybeat-schedule
        ;;

    *)
        exec "$@"
        ;;
esac
