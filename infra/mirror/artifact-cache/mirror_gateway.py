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


CACHE_DIR = Path(os.getenv("MIRROR_CACHE_DIR", "/var/cache/lindeploy"))
MAX_BYTES = int(os.getenv("MIRROR_CACHE_MAX_BYTES", str(12 * 1024**3)))
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
LOCKS = {}
LOCKS_GUARD = threading.Lock()
REPOSITORY_GENERATION_DIR = CACHE_DIR / "repository-generations"


def cache_paths(url):
    key = hashlib.sha256(url.encode("utf-8")).hexdigest()
    directory = CACHE_DIR / key[:2]
    return directory / f"{key}.data", directory / f"{key}.json"


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
                continue
            download(reference_url, data_path, metadata_path)


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
    generation_path.write_text(
        json.dumps(
            {
                "repository": repository_root(url),
                "refreshed_at": int(metadata.get("cached_at", time.time())),
            }
        ),
        encoding="utf-8",
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
    with LOCKS_GUARD:
        return LOCKS.setdefault(url, threading.Lock())


def prune_cache():
    files = sorted(
        CACHE_DIR.glob("*/*.data"),
        key=lambda item: item.stat().st_mtime,
    )
    total = sum(item.stat().st_size for item in files)
    for item in files:
        if total <= MAX_BYTES:
            break
        size = item.stat().st_size
        item.unlink(missing_ok=True)
        item.with_suffix(".json").unlink(missing_ok=True)
        total -= size


def download(url, data_path, metadata_path):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "LinDeploy-Mirror/1.0",
            "Accept": "*/*",
        },
    )
    data_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = data_path.with_suffix(".part")
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT) as response:
        with temporary_path.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
        metadata = {
            "source_url": url,
            "resolved_url": response.geturl(),
            "content_type": response.headers.get("Content-Type", "application/octet-stream"),
            "content_length": temporary_path.stat().st_size,
            "etag": response.headers.get("ETag", ""),
            "last_modified": response.headers.get("Last-Modified", ""),
            "sha256": digest.hexdigest(),
            "cached_at": int(time.time()),
        }
    if urllib.parse.urlsplit(url).path.endswith("/repodata/repomd.xml"):
        # Never expose a new repository generation before all metadata files
        # referenced by repomd.xml are safely available from the local cache.
        prefetch_repository_metadata(url, temporary_path)
    temporary_path.replace(data_path)
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
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
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
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
                    if payload_revalidation_due(upstream_url, metadata):
                        try:
                            metadata, cache_status = revalidate_payload(
                                upstream_url,
                                data_path,
                                metadata_path,
                                metadata,
                            )
                        except Exception:
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
                            # Keep installations operational during a temporary
                            # upstream outage by serving the last verified copy.
                            cache_status = "STALE"
                    os.utime(data_path, None)
                else:
                    metadata = download(upstream_url, data_path, metadata_path)
                    record_repository_generation(upstream_url, metadata)
                    cache_status = "MISS"
            if route == "update.k3s.io" and "/channels/" in suffix:
                self.serve_k3s_channel_redirect(metadata)
                return
            self.serve_file(data_path, metadata, cache_status, send_body)
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
        start, end = 0, size - 1
        status = HTTPStatus.OK
        range_header = self.headers.get("Range", "")
        if range_header.startswith("bytes="):
            requested = range_header[6:].split(",", 1)[0]
            first, _, last = requested.partition("-")
            start = int(first) if first else 0
            end = int(last) if last else size - 1
            end = min(end, size - 1)
            if start > end:
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                return
            status = HTTPStatus.PARTIAL_CONTENT

        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", metadata.get("content_type", "application/octet-stream"))
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-LinDeploy-Cache", cache_status)
        self.send_header("X-Content-SHA256", metadata.get("sha256", ""))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()

        if not send_body:
            return
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


if __name__ == "__main__":
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    prune_cache()
    ThreadingHTTPServer(("0.0.0.0", 8080), MirrorHandler).serve_forever()
