import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cache_store import CacheIndex, CapacityError, atomic_json, atomic_write, parse_single_range


CACHE_DIR = Path(os.getenv("MIRROR_CACHE_DIR", "/var/cache/lindeploy"))
MAX_BYTES = int(os.getenv("MIRROR_CACHE_MAX_BYTES", str(12 * 1024**3)))
RESERVED_FREE_BYTES = int(os.getenv("MIRROR_CACHE_RESERVED_FREE_BYTES", str(2 * 1024**3)))
MAX_OBJECT_BYTES = int(os.getenv("MIRROR_CACHE_MAX_OBJECT_BYTES", str(4 * 1024**3)))
UPSTREAM_TIMEOUT = int(os.getenv("MIRROR_UPSTREAM_TIMEOUT", "180"))
METADATA_TTL = int(os.getenv("MIRROR_METADATA_TTL", "3600"))
PAYLOAD_REVALIDATE_TTL = int(os.getenv("MIRROR_PAYLOAD_REVALIDATE_TTL", "300"))
ROUTES = {
    "get.k3s.io": "https://get.k3s.io/",
    "update.k3s.io": "https://update.k3s.io/",
    "github.com": "https://github.com/",
    "raw.githubusercontent.com": "https://raw.githubusercontent.com/",
    "download.docker.com": "https://download.docker.com/",
    "pkgs.k8s.io": "https://pkgs.k8s.io/",
    "dl.k8s.io": "https://dl.k8s.io/",
    "rpm.rancher.io": "https://rpm.rancher.io/",
    "mirror.stream.centos.org": "https://mirror.stream.centos.org/",
    "dl.rockylinux.org": "https://dl.rockylinux.org/",
    "repo.almalinux.org": "https://repo.almalinux.org/",
    "archive.ubuntu.com": "https://archive.ubuntu.com/",
    "security.ubuntu.com": "https://security.ubuntu.com/",
    "deb.debian.org": "https://deb.debian.org/",
    "security.debian.org": "https://security.debian.org/",
}
LOCK_STRIPES = tuple(threading.RLock() for _ in range(64))
REPOSITORY_GENERATION_DIR = CACHE_DIR / "repository-generations"
CACHE_INDEX = CacheIndex(CACHE_DIR, MAX_BYTES, RESERVED_FREE_BYTES, MAX_OBJECT_BYTES)
MAX_WORKERS = int(os.getenv("MIRROR_MAX_WORKERS", "32"))
WORKER_SLOTS = threading.BoundedSemaphore(MAX_WORKERS)


def cache_paths(url):
    key = hashlib.sha256(url.encode("utf-8")).hexdigest()
    directory = CACHE_DIR / key[:2]
    return directory / f"{key}.data", directory / f"{key}.json"


def cache_key(url):
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def repository_metadata_locations(repomd_path):
    try:
        root = ET.parse(repomd_path).getroot()
    except (ET.ParseError, OSError):
        return []
    return [
        element.attrib["href"]
        for element in root.iter()
        if element.tag.rsplit("}", 1)[-1] == "location" and element.attrib.get("href")
    ]


def repository_reference_url(repomd_url, location):
    repository_base = repomd_url.split("/repodata/", 1)[0].rstrip("/") + "/"
    return urllib.parse.urljoin(repository_base, location)


def repository_snapshot_status(repomd_url):
    repomd_data_path, repomd_metadata_path = cache_paths(repomd_url)
    if not repomd_data_path.is_file() or not repomd_metadata_path.is_file():
        return False, [repomd_url]

    missing = []
    for location in repository_metadata_locations(repomd_data_path):
        reference_url = repository_reference_url(repomd_url, location)
        data_path, metadata_path = cache_paths(reference_url)
        if not data_path.is_file() or not metadata_path.is_file():
            missing.append(reference_url)
    return not missing, missing


def prefetch_repository_metadata(repomd_url, repomd_path):
    for location in repository_metadata_locations(repomd_path):
        reference_url = repository_reference_url(repomd_url, location)
        data_path, metadata_path = cache_paths(reference_url)
        with lock_for(reference_url):
            if data_path.is_file() and metadata_path.is_file():
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            else:
                metadata = download(reference_url, data_path, metadata_path)
            expected = Path(urllib.parse.urlsplit(location).path).name.split("-", 1)[0]
            if re_full_sha256(expected) and metadata.get("sha256") != expected:
                data_path.unlink(missing_ok=True)
                metadata_path.unlink(missing_ok=True)
                raise ValueError(f"repository metadata checksum mismatch for {reference_url}")


def re_full_sha256(value):
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value.lower())


def repository_root(url):
    parsed = urllib.parse.urlsplit(url)
    path = parsed.path
    for marker in ("/repodata/", "/Packages/", "/dists/", "/pool/"):
        if marker in path:
            prefix = path.split(marker, 1)[0].rstrip("/")
            return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, f"{prefix}/", "", ""))
    return ""


def repository_generation_path(url):
    root = repository_root(url)
    if not root:
        return None
    key = hashlib.sha256(root.encode("utf-8")).hexdigest()
    return REPOSITORY_GENERATION_DIR / f"{key}.json"


def record_repository_generation(url, metadata):
    path = urllib.parse.urlsplit(url).path
    if not (path.endswith("/repodata/repomd.xml") or path.endswith("/InRelease")):
        return
    generation_path = repository_generation_path(url)
    if generation_path is None:
        return
    generation_path.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(
        generation_path,
        {
            "repository": repository_root(url),
            "refreshed_at": int(metadata.get("cached_at", time.time())),
            "generation_id": metadata.get("sha256", ""),
        },
    )
    referenced_metadata = []
    if path.endswith("/repodata/repomd.xml"):
        referenced_metadata = repository_metadata_locations(cache_paths(url)[0])
    CACHE_INDEX.activate_repository_generation(
        repository_root(url), metadata.get("sha256", ""),
        {"repomd_url": url, "metadata": referenced_metadata},
    )


def payload_predates_repository_metadata(url, metadata):
    generation_path = repository_generation_path(url)
    if generation_path is None or not generation_path.is_file():
        return False
    try:
        generation = json.loads(generation_path.read_text(encoding="utf-8"))
        return int(metadata.get("cached_at", 0)) < int(generation.get("refreshed_at", 0))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return False


def payload_revalidation_due(url, metadata):
    return (
        not is_repository_metadata(url)
        and int(time.time()) - int(metadata.get("cached_at", 0))
        >= PAYLOAD_REVALIDATE_TTL
    )


def lock_for(url):
    return LOCK_STRIPES[int(cache_key(url)[:8], 16) % len(LOCK_STRIPES)]


def prune_cache():
    CACHE_INDEX.prune()


def download(url, data_path, metadata_path):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LinDeploy-Mirror/1.0",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT) as response:
        expected_size = int(response.headers.get("Content-Length", 0) or 0)
        CACHE_INDEX.admit(expected_size)
        digest = hashlib.sha256()

        def stream_to(output):
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
                if output.tell() > MAX_OBJECT_BYTES:
                    raise CapacityError(f"object exceeded {MAX_OBJECT_BYTES} bytes")

        atomic_write(data_path, stream_to)
        metadata = {
            "source_url": url,
            "resolved_url": response.geturl(),
            "content_type": response.headers.get("Content-Type", "application/octet-stream"),
            "content_length": data_path.stat().st_size,
            "etag": response.headers.get("ETag", ""),
            "last_modified": response.headers.get("Last-Modified", ""),
            "sha256": digest.hexdigest(),
            "trusted_digest": "",
            "verification_status": "computed-only",
            "provenance": {"upstream": response.geturl(), "tls_verified": True},
            "cached_at": int(time.time()),
        }
    if urllib.parse.urlsplit(url).path.endswith("/repodata/repomd.xml"):
        # Never expose a new repository generation before all metadata files
        # referenced by repomd.xml are safely available from the local cache.
        prefetch_repository_metadata(url, data_path)
    atomic_json(metadata_path, metadata)
    CACHE_INDEX.register(
        cache_key(url), url, data_path, metadata_path, metadata,
        content_class="security-metadata" if is_repository_metadata(url) else "payload",
    )
    prune_cache()
    return metadata


def revalidate_payload(url, data_path, metadata_path, metadata):
    request = urllib.request.Request(
        url,
        method="HEAD",
        headers={"User-Agent": "LinDeploy-Mirror/1.0", "Accept": "*/*"},
    )
    with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT) as response:
        upstream = {
            "content_length": int(response.headers.get("Content-Length", 0) or 0),
            "etag": response.headers.get("ETag", ""),
            "last_modified": response.headers.get("Last-Modified", ""),
        }
    unchanged = (
        upstream["content_length"] == int(metadata.get("content_length", -1))
        and upstream["etag"] == metadata.get("etag", "")
        and upstream["last_modified"] == metadata.get("last_modified", "")
    )
    if unchanged:
        metadata["cached_at"] = int(time.time())
        atomic_json(metadata_path, metadata)
        CACHE_INDEX.register(cache_key(url), url, data_path, metadata_path, metadata)
        return metadata, "REVALIDATED"
    return download(url, data_path, metadata_path), "REFRESH"


def is_repository_metadata(url):
    path = urllib.parse.urlsplit(url).path
    filename = path.rstrip("/").rsplit("/", 1)[-1]
    return (
        "/repodata/" in path
        or "/repodata/" in url
        or "/dists/" in path
        or filename in {"InRelease", "Release", "Release.gpg"}
        or filename.startswith(("Packages", "Sources", "Contents"))
    )


def cache_is_fresh(url, metadata):
    if not is_repository_metadata(url):
        return not payload_predates_repository_metadata(url, metadata)
    cached_at = int(metadata.get("cached_at", 0))
    return cached_at > 0 and (int(time.time()) - cached_at) < METADATA_TTL


class MirrorHandler(BaseHTTPRequestHandler):
    server_version = "LinDeployMirror/1.0"

    def do_GET(self):
        self.handle_request(send_body=True)

    def do_HEAD(self):
        self.handle_request(send_body=False)

    def handle_request(self, send_body):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/healthz":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            if send_body:
                self.wfile.write(b"ok\n")
            return

        if parsed.path == "/readyz":
            payload = json.dumps(CACHE_INDEX.readiness()).encode("utf-8")
            status = HTTPStatus.OK if json.loads(payload)["ready"] else HTTPStatus.SERVICE_UNAVAILABLE
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if send_body:
                self.wfile.write(payload)
            return

        if parsed.path == "/metrics":
            metrics = CACHE_INDEX.metrics()
            body = "".join(f"lindeploy_mirror_{key} {value}\n" for key, value in sorted(metrics.items())).encode()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if send_body:
                self.wfile.write(body)
            return

        if parsed.path.startswith("/cache/channel-version/"):
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Cache-Control", "public, max-age=300")
            self.end_headers()
            return

        if parsed.path.startswith("/cache-ready/"):
            self.handle_repository_readiness(parsed)
            return

        parts = parsed.path.lstrip("/").split("/", 2)
        if len(parts) < 2 or parts[0] != "cache" or parts[1] not in ROUTES:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown mirror route")
            return

        route = parts[1]
        suffix = parts[2] if len(parts) == 3 else ""
        if len(parsed.query) > 512 or parsed.query.count("&") > 7:
            self.send_error(HTTPStatus.BAD_REQUEST, "Query exceeds mirror policy")
            return
        # Repository paths such as ``core:/stable:/v1.36/rpm`` contain a
        # colon. urljoin treats that prefix as a URI scheme and drops the
        # configured upstream host, so join path components explicitly.
        upstream_url = f"{ROUTES[route].rstrip('/')}/{suffix.lstrip('/')}"
        if parsed.query:
            upstream_url = f"{upstream_url}?{parsed.query}"

        data_path, metadata_path = cache_paths(upstream_url)
        try:
            with lock_for(upstream_url):
                if data_path.is_file() and metadata_path.is_file():
                    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                    if CACHE_INDEX.get(cache_key(upstream_url)) is None:
                        CACHE_INDEX.register(
                            cache_key(upstream_url), upstream_url, data_path, metadata_path, metadata,
                            content_class="security-metadata" if is_repository_metadata(upstream_url) else "payload",
                        )
                    if payload_revalidation_due(upstream_url, metadata):
                        try:
                            metadata, cache_status = revalidate_payload(
                                upstream_url,
                                data_path,
                                metadata_path,
                                metadata,
                            )
                        except Exception:
                            if is_repository_metadata(upstream_url):
                                raise
                            cache_status = "STALE"
                    elif cache_is_fresh(upstream_url, metadata):
                        record_repository_generation(upstream_url, metadata)
                        cache_status = "HIT"
                    else:
                        try:
                            metadata = download(upstream_url, data_path, metadata_path)
                            record_repository_generation(upstream_url, metadata)
                            cache_status = "REFRESH"
                        except Exception:
                            if is_repository_metadata(upstream_url):
                                raise
                            # Immutable payloads may use their last verified copy.
                            cache_status = "STALE"
                    CACHE_INDEX.touch(cache_key(upstream_url))
                else:
                    metadata = download(upstream_url, data_path, metadata_path)
                    record_repository_generation(upstream_url, metadata)
                    cache_status = "MISS"
            if route == "update.k3s.io" and "/channels/" in suffix:
                self.serve_k3s_channel_redirect(metadata)
                return
            self.serve_file(data_path, metadata, cache_status, send_body)
            CACHE_INDEX.increment(cache_status.lower())
        except urllib.error.HTTPError as exc:
            self.send_error(exc.code, f"Upstream returned {exc.code}")
        except (BrokenPipeError, ConnectionResetError):
            # Package managers can abandon a slow first MISS and retry. The
            # object remains safely cached; there is no HTTP error left to send
            # to a client that already closed its connection.
            return
        except Exception as exc:
            self.send_error(HTTPStatus.BAD_GATEWAY, f"Mirror fetch failed: {exc}")

    def handle_repository_readiness(self, parsed):
        parts = parsed.path.lstrip("/").split("/", 2)
        if len(parts) < 3 or parts[1] not in ROUTES:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown repository readiness route")
            return

        route = parts[1]
        suffix = parts[2]
        upstream_url = f"{ROUTES[route].rstrip('/')}/{suffix.lstrip('/')}"
        ready, missing = repository_snapshot_status(upstream_url)
        payload = json.dumps(
            {
                "ready": ready,
                "repository": repository_root(upstream_url),
                "missing_count": len(missing),
            }
        ).encode("utf-8")
        self.send_response(HTTPStatus.OK if ready else HTTPStatus.SERVICE_UNAVAILABLE)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def serve_k3s_channel_redirect(self, metadata):
        resolved_url = metadata.get("resolved_url", "")
        version = urllib.parse.unquote(urllib.parse.urlsplit(resolved_url).path.rstrip("/").split("/")[-1])
        if not version.startswith("v") or "/releases/tag/" not in resolved_url:
            self.send_error(HTTPStatus.BAD_GATEWAY, "K3s channel did not resolve to a release tag")
            return

        host = self.headers.get("Host", "")
        if not host:
            self.send_error(HTTPStatus.BAD_REQUEST, "Missing Host header")
            return
        local_version_url = f"https://{host}/cache/channel-version/{urllib.parse.quote(version, safe='+')}"
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", local_version_url)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def serve_file(self, path, metadata, cache_status, send_body):
        size = path.stat().st_size
        start, end = 0, max(size - 1, 0)
        status = HTTPStatus.OK
        etag = metadata.get("etag", "")
        if etag and self.headers.get("If-None-Match") == etag:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.send_header("X-LinDeploy-Cache", cache_status)
            self.end_headers()
            return
        range_header = self.headers.get("Range", "")
        try:
            parsed_range = parse_single_range(range_header, size)
        except (ValueError, TypeError):
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        if parsed_range:
            start, end = parsed_range
            status = HTTPStatus.PARTIAL_CONTENT

        length = 0 if size == 0 else end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", metadata.get("content_type", "application/octet-stream"))
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-LinDeploy-Cache", cache_status)
        self.send_header("X-Content-SHA256", metadata.get("sha256", ""))
        self.send_header("X-LinDeploy-Verification", metadata.get("verification_status", "computed-only"))
        self.send_header("X-LinDeploy-Profile", metadata.get("profile_id", ""))
        self.send_header("Age", str(max(0, int(time.time()) - int(metadata.get("cached_at", 0)))))
        if cache_status == "STALE":
            self.send_header("Warning", '110 - "Response is stale"')
        if etag:
            self.send_header("ETag", etag)
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")

        accel_supported = self.headers.get("X-Accel-Supported") == "1" or os.getenv("MIRROR_ENABLE_ACCEL_REDIRECT", "0") == "1"
        if accel_supported and status == HTTPStatus.OK:
            try:
                rel_path = path.resolve().relative_to(CACHE_DIR.resolve())
                self.send_header("X-Accel-Redirect", f"/internal-cache/{rel_path.as_posix()}")
                self.end_headers()
                return
            except ValueError:
                pass

        self.end_headers()

        if not send_body:
            return
        with CACHE_INDEX.serving(cache_key(metadata["source_url"])):
            with path.open("rb") as source:
                source.seek(start)
                remaining = length
                while remaining:
                    chunk = source.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        return
                    remaining -= len(chunk)

    def log_message(self, message, *args):
        print(f"{self.client_address[0]} {message % args}", flush=True)


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def process_request(self, request, client_address):
        if not WORKER_SLOTS.acquire(blocking=False):
            CACHE_INDEX.increment("rejected_concurrency")
            try:
                request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\n"
                    b"Content-Type: text/plain\r\n"
                    b"Content-Length: 26\r\n"
                    b"Retry-After: 2\r\n"
                    b"Connection: close\r\n\r\n"
                    b"mirror capacity exhausted\n"
                )
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            WORKER_SLOTS.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            WORKER_SLOTS.release()


if __name__ == "__main__":
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    prune_cache()
    BoundedThreadingHTTPServer(("0.0.0.0", 8080), MirrorHandler).serve_forever()
