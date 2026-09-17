import contextlib
import hashlib
import json
import os
import shutil
import sqlite3
import threading
import time
from pathlib import Path


class CapacityError(RuntimeError):
    pass


class CacheIndex:
    """Durable cache index. SQLite WAL coordinates all gateway processes."""

    def __init__(self, root, max_bytes, reserved_free_bytes, max_object_bytes):
        self.root = Path(root)
        self.max_bytes = max_bytes
        self.reserved_free_bytes = reserved_free_bytes
        self.max_object_bytes = max_object_bytes
        self.db_path = self.root / "index.sqlite3"
        self.root.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._initialize()

    def connection(self):
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = sqlite3.connect(self.db_path, timeout=30, isolation_level=None)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA busy_timeout=30000")
            self._local.connection = connection
        return connection

    def close_current_connection(self):
        connection = getattr(self._local, "connection", None)
        if connection is not None:
            connection.close()
            self._local.connection = None

    def _initialize(self):
        connection = self.connection()
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS objects (
              cache_key TEXT PRIMARY KEY,
              source_url TEXT NOT NULL,
              data_path TEXT NOT NULL,
              metadata_path TEXT NOT NULL,
              size_bytes INTEGER NOT NULL DEFAULT 0,
              computed_sha256 TEXT NOT NULL DEFAULT '',
              trusted_digest TEXT NOT NULL DEFAULT '',
              verification_status TEXT NOT NULL DEFAULT 'computed-only',
              provenance TEXT NOT NULL DEFAULT '{}',
              content_class TEXT NOT NULL DEFAULT 'payload',
              profile_id TEXT NOT NULL DEFAULT '',
              generation_id TEXT NOT NULL DEFAULT '',
              pinned INTEGER NOT NULL DEFAULT 0,
              active_serves INTEGER NOT NULL DEFAULT 0,
              state TEXT NOT NULL DEFAULT 'ready',
              cached_at INTEGER NOT NULL,
              accessed_at INTEGER NOT NULL,
              etag TEXT NOT NULL DEFAULT '',
              last_modified TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS objects_eviction
              ON objects(pinned, active_serves, state, accessed_at);
            CREATE TABLE IF NOT EXISTS repository_generations (
              repository TEXT NOT NULL,
              generation_id TEXT NOT NULL,
              state TEXT NOT NULL,
              manifest TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              PRIMARY KEY(repository, generation_id)
            );
            CREATE TABLE IF NOT EXISTS metrics (
              name TEXT PRIMARY KEY,
              value INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        # A crash cannot leave an object permanently protected from eviction.
        connection.execute("UPDATE objects SET active_serves = 0 WHERE active_serves != 0")

    def get(self, cache_key):
        return self.connection().execute(
            "SELECT * FROM objects WHERE cache_key = ? AND state = 'ready'", (cache_key,)
        ).fetchone()

    def register(self, cache_key, url, data_path, metadata_path, metadata, *, content_class="payload"):
        now = int(time.time())
        self.connection().execute("BEGIN IMMEDIATE")
        try:
            self.connection().execute(
                """
                INSERT INTO objects (
                  cache_key, source_url, data_path, metadata_path, size_bytes,
                  computed_sha256, trusted_digest, verification_status, provenance,
                  content_class, profile_id, generation_id, pinned, state,
                  cached_at, accessed_at, etag, last_modified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                  source_url=excluded.source_url, data_path=excluded.data_path,
                  metadata_path=excluded.metadata_path, size_bytes=excluded.size_bytes,
                  computed_sha256=excluded.computed_sha256,
                  trusted_digest=excluded.trusted_digest,
                  verification_status=excluded.verification_status,
                  provenance=excluded.provenance, content_class=excluded.content_class,
                  profile_id=excluded.profile_id, generation_id=excluded.generation_id,
                  pinned=MAX(objects.pinned, excluded.pinned), state='ready',
                  cached_at=excluded.cached_at, accessed_at=excluded.accessed_at,
                  etag=excluded.etag, last_modified=excluded.last_modified
                """,
                (
                    cache_key, url, str(data_path), str(metadata_path), metadata["content_length"],
                    metadata["sha256"], metadata.get("trusted_digest", ""),
                    metadata.get("verification_status", "computed-only"),
                    json.dumps(metadata.get("provenance", {}), sort_keys=True), content_class,
                    metadata.get("profile_id", ""), metadata.get("generation_id", ""),
                    int(bool(metadata.get("pinned", False))), metadata["cached_at"], now,
                    metadata.get("etag", ""), metadata.get("last_modified", ""),
                ),
            )
            self.connection().execute("COMMIT")
        except Exception:
            self.connection().execute("ROLLBACK")
            raise

    def touch(self, cache_key):
        self.connection().execute(
            "UPDATE objects SET accessed_at = ? WHERE cache_key = ?", (int(time.time()), cache_key)
        )

    @contextlib.contextmanager
    def serving(self, cache_key):
        self.connection().execute(
            "UPDATE objects SET active_serves = active_serves + 1, accessed_at = ? WHERE cache_key = ?",
            (int(time.time()), cache_key),
        )
        try:
            yield
        finally:
            self.connection().execute(
                "UPDATE objects SET active_serves = MAX(active_serves - 1, 0) WHERE cache_key = ?",
                (cache_key,),
            )

    def increment(self, name, amount=1):
        self.connection().execute(
            "INSERT INTO metrics(name, value) VALUES (?, ?) "
            "ON CONFLICT(name) DO UPDATE SET value = value + excluded.value",
            (name, amount),
        )

    def metrics(self):
        return {row["name"]: row["value"] for row in self.connection().execute("SELECT * FROM metrics")}

    def used_bytes(self):
        row = self.connection().execute(
            "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM objects WHERE state = 'ready'"
        ).fetchone()
        return int(row["total"])

    def admit(self, expected_size=0):
        if expected_size > self.max_object_bytes:
            raise CapacityError(
                f"object size {expected_size} exceeds limit {self.max_object_bytes}"
            )
        free = shutil.disk_usage(self.root).free
        if free - expected_size < self.reserved_free_bytes:
            raise CapacityError("reserved free-space threshold would be crossed")
        self.prune(required_bytes=expected_size)
        if self.used_bytes() + expected_size > self.max_bytes:
            raise CapacityError("cache quota has insufficient evictable capacity")

    def prune(self, required_bytes=0):
        connection = self.connection()
        connection.execute("BEGIN IMMEDIATE")
        try:
            total = int(connection.execute(
                "SELECT COALESCE(SUM(size_bytes), 0) FROM objects WHERE state = 'ready'"
            ).fetchone()[0])
            target = self.max_bytes - required_bytes
            victims = connection.execute(
                "SELECT * FROM objects WHERE pinned = 0 AND active_serves = 0 "
                "AND state = 'ready' ORDER BY accessed_at ASC"
            ).fetchall()
            for victim in victims:
                if total <= target:
                    break
                connection.execute(
                    "UPDATE objects SET state = 'evicting' WHERE cache_key = ? AND active_serves = 0",
                    (victim["cache_key"],),
                )
                Path(victim["data_path"]).unlink(missing_ok=True)
                Path(victim["metadata_path"]).unlink(missing_ok=True)
                connection.execute("DELETE FROM objects WHERE cache_key = ?", (victim["cache_key"],))
                total -= victim["size_bytes"]
                self.increment("evictions")
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise

    def readiness(self):
        free = shutil.disk_usage(self.root).free
        integrity = self.connection().execute("PRAGMA quick_check").fetchone()[0]
        profiles = self.connection().execute(
            "SELECT repository, generation_id FROM repository_generations WHERE state = 'active'"
        ).fetchall()
        return {
            "ready": integrity == "ok" and os.access(self.root, os.W_OK) and free >= self.reserved_free_bytes,
            "index": integrity,
            "writable": os.access(self.root, os.W_OK),
            "free_bytes": free,
            "used_bytes": self.used_bytes(),
            "active_generations": len(profiles),
        }

    def activate_repository_generation(self, repository, generation_id, manifest):
        now = int(time.time())
        connection = self.connection()
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                "UPDATE repository_generations SET state = 'retired' "
                "WHERE repository = ? AND state = 'active'", (repository,),
            )
            connection.execute(
                "INSERT OR REPLACE INTO repository_generations "
                "(repository, generation_id, state, manifest, created_at) VALUES (?, ?, 'active', ?, ?)",
                (repository, generation_id, json.dumps(manifest, sort_keys=True), now),
            )
            connection.execute(
                "UPDATE objects SET pinned = 1, generation_id = ? WHERE source_url = ?",
                (generation_id, manifest["repomd_url"]),
            )
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise


def atomic_write(path, writer):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.part")
    try:
        with temporary.open("wb") as output:
            result = writer(output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        return result
    finally:
        temporary.unlink(missing_ok=True)


def atomic_json(path, payload):
    encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
    atomic_write(path, lambda output: output.write(encoded))


def parse_single_range(value, size):
    if not value:
        return None
    if size == 0 or not value.startswith("bytes=") or "," in value:
        raise ValueError("invalid byte range")
    spec = value[6:].strip()
    first, separator, last = spec.partition("-")
    if not separator:
        raise ValueError("invalid byte range")
    if first == "":
        suffix = int(last)
        if suffix <= 0:
            raise ValueError("invalid suffix range")
        return max(size - suffix, 0), size - 1
    start = int(first)
    end = int(last) if last else size - 1
    if start < 0 or start >= size or end < start:
        raise ValueError("unsatisfiable byte range")
    return start, min(end, size - 1)
