"""Decompress RPM repository metadata using Python's standard library."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from compression import zstd


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()

    with zstd.open(args.source, "rb") as source, args.destination.open("wb") as destination:
        shutil.copyfileobj(source, destination, length=1024 * 1024)


if __name__ == "__main__":
    main()
