#!/usr/bin/env python3
"""Wait for an Assisted Installer cluster state while refreshing API tokens."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--sso-token-url", required=True)
    parser.add_argument("--cluster-id", required=True)
    parser.add_argument("--expected", action="append", required=True)
    parser.add_argument("--failure", action="append", default=[])
    parser.add_argument("--timeout-seconds", type=int, required=True)
    parser.add_argument("--poll-seconds", type=int, default=30)
    return parser.parse_args()


def request_json(request: urllib.request.Request) -> dict:
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def refresh_access_token(token_url: str, offline_token: str) -> tuple[str, float]:
    form = urllib.parse.urlencode(
        {
            "grant_type": "refresh_token",
            "client_id": "cloud-services",
            "refresh_token": offline_token,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        token_url,
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    response = request_json(request)
    expires_in = max(int(response.get("expires_in", 900)) - 60, 60)
    return response["access_token"], time.monotonic() + expires_in


def read_cluster(api_url: str, cluster_id: str, access_token: str) -> dict:
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}/v2/clusters/{cluster_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    return request_json(request)


def main() -> int:
    args = parse_args()
    offline_token = os.environ.get("REDHAT_OFFLINE_TOKEN", "")
    if not offline_token:
        print("REDHAT_OFFLINE_TOKEN is not set", file=sys.stderr)
        return 2

    deadline = time.monotonic() + args.timeout_seconds
    access_token = ""
    token_deadline = 0.0
    last_status = "unknown"
    last_cluster = {}

    while time.monotonic() < deadline:
        try:
            if not access_token or time.monotonic() >= token_deadline:
                access_token, token_deadline = refresh_access_token(
                    args.sso_token_url, offline_token
                )
            cluster = read_cluster(args.api_url, args.cluster_id, access_token)
            last_cluster = cluster
            last_status = cluster.get("status", "unknown")

            if last_status in args.expected:
                print(json.dumps(cluster))
                return 0
            if last_status in args.failure:
                status_info = cluster.get("status_info", "no details reported")
                print(json.dumps(cluster))
                print(
                    f"Cluster entered failure state {last_status}: {status_info}",
                    file=sys.stderr,
                )
                return 3
        except urllib.error.HTTPError as error:
            if error.code == 401:
                access_token = ""
                token_deadline = 0.0
            elif error.code not in (429, 500, 502, 503, 504):
                print(f"Assisted Installer returned HTTP {error.code}", file=sys.stderr)
                return 4
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            print(f"Transient Assisted Installer error: {error}", file=sys.stderr)

        time.sleep(args.poll_seconds)

    if last_cluster:
        print(json.dumps(last_cluster))
    print(
        f"Timed out waiting for {args.expected}; last status was {last_status}",
        file=sys.stderr,
    )
    return 5


if __name__ == "__main__":
    raise SystemExit(main())
