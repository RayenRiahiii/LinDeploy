import json
import tempfile
import threading
import unittest
from pathlib import Path

from cache_store import CacheIndex, CapacityError, atomic_json, parse_single_range


class RangeTests(unittest.TestCase):
    def test_normal_and_suffix_ranges(self):
        self.assertEqual(parse_single_range("bytes=2-5", 10), (2, 5))
        self.assertEqual(parse_single_range("bytes=-4", 10), (6, 9))
        self.assertEqual(parse_single_range("bytes=8-", 10), (8, 9))

    def test_invalid_ranges(self):
        for value, size in (("bytes=10-11", 10), ("bytes=5-2", 10), ("bytes=0-1,3-4", 10), ("bytes=-0", 10), ("bytes=0-0", 0)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_single_range(value, size)


class CacheIndexTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.index = CacheIndex(self.root, max_bytes=20, reserved_free_bytes=0, max_object_bytes=12)

    def tearDown(self):
        self.index.close_current_connection()
        self.temporary.cleanup()

    def register(self, key, size, pinned=False):
        data = self.root / f"{key}.data"
        metadata = self.root / f"{key}.json"
        data.write_bytes(b"x" * size)
        payload = {
            "source_url": f"https://example.invalid/{key}", "content_length": size,
            "sha256": key.ljust(64, "0")[:64], "cached_at": 1, "pinned": pinned,
        }
        atomic_json(metadata, payload)
        self.index.register(key, payload["source_url"], data, metadata, payload)
        return data

    def test_oversized_object_is_rejected_before_download(self):
        with self.assertRaises(CapacityError):
            self.index.admit(13)

    def test_prune_does_not_remove_served_or_pinned_object(self):
        first = self.register("a", 10)
        pinned = self.register("b", 10, pinned=True)
        with self.index.serving("a"):
            with self.assertRaises(CapacityError):
                self.index.admit(5)
            self.assertTrue(first.exists())
            self.assertTrue(pinned.exists())

    def test_concurrent_registration_keeps_consistent_index(self):
        errors = []
        barrier = threading.Barrier(3)
        data = self.root / "same.data"
        metadata = self.root / "same.json"
        data.write_bytes(b"x" * 5)
        payload = {
            "source_url": "https://example.invalid/same", "content_length": 5,
            "sha256": "a" * 64, "cached_at": 1,
        }
        atomic_json(metadata, payload)

        def worker():
            try:
                barrier.wait()
                self.index.register("same", payload["source_url"], data, metadata, payload)
            except Exception as exc:  # pragma: no cover - asserted below
                errors.append(exc)
            finally:
                self.index.close_current_connection()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(self.index.get("same")["size_bytes"], 5)

    def test_repository_generation_switch_is_atomic(self):
        repomd_url = "https://mirror.invalid/repository/repodata/repomd.xml"
        self.index.activate_repository_generation(
            "baseos", "generation-1", {"repomd_url": repomd_url, "sha256": "a" * 64}
        )
        self.index.activate_repository_generation(
            "baseos", "generation-2", {"repomd_url": repomd_url, "sha256": "b" * 64}
        )

        rows = self.index.connection().execute(
            "SELECT generation_id, state FROM repository_generations "
            "WHERE repository = ? ORDER BY generation_id",
            ("baseos",),
        ).fetchall()
        self.assertEqual(
            [(row["generation_id"], row["state"]) for row in rows],
            [("generation-1", "retired"), ("generation-2", "active")],
        )

    def test_failed_atomic_write_preserves_existing_metadata(self):
        metadata = self.root / "metadata.json"
        atomic_json(metadata, {"generation": "active"})

        def interrupted_writer(output):
            output.write(b'{"generation":"partial"')
            raise RuntimeError("simulated interruption")

        from cache_store import atomic_write

        with self.assertRaisesRegex(RuntimeError, "simulated interruption"):
            atomic_write(metadata, interrupted_writer)

        self.assertEqual(json.loads(metadata.read_text()), {"generation": "active"})
        self.assertEqual(list(self.root.glob(".*.part")), [])


if __name__ == "__main__":
    unittest.main()
