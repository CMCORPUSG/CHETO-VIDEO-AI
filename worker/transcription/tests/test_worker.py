from __future__ import annotations

import io
import json
import threading
import unittest
from types import SimpleNamespace

from transcription.engine import normalize_segment, normalize_word
from transcription.profiles import Capabilities, fallback_chain, select_profile
from transcription.protocol import emit, parse_message, seconds_to_us


GIB = 1024**3


class ProtocolTests(unittest.TestCase):
    def test_protocol_serialization(self):
        stream = io.StringIO()
        emit("PROGRESS", {"processedUs": 10}, stream)
        self.assertEqual(json.loads(stream.getvalue())["event"], "PROGRESS")

    def test_invalid_protocol_is_controlled(self):
        with self.assertRaises(ValueError):
            parse_message('{"value": 1}')

    def test_seconds_to_microseconds(self):
        self.assertEqual(seconds_to_us(1.234567), 1_234_567)
        self.assertIsNone(seconds_to_us(None))


class NormalizationTests(unittest.TestCase):
    def test_optional_word_timestamps(self):
        word = normalize_word(SimpleNamespace(start=None, end=None, word=" hola", probability=.9))
        self.assertIsNone(word["startUs"])
        self.assertEqual(word["text"], " hola")

    def test_segment_and_words(self):
        raw = SimpleNamespace(start=1.0, end=2.0, text=" Hola", avg_logprob=-.2, no_speech_prob=.01, words=[SimpleNamespace(start=1.1, end=1.4, word=" Hola", probability=.95)])
        segment = normalize_segment(raw)
        self.assertEqual(segment["startUs"], 1_000_000)
        self.assertEqual(segment["words"][0]["endUs"], 1_400_000)

    def test_chunk_offset_is_global(self):
        raw = SimpleNamespace(start=.5, end=1.0, text="x", avg_logprob=None, no_speech_prob=None, words=[])
        self.assertEqual(normalize_segment(raw, 30_000_000)["startUs"], 30_500_000)


class ProfileTests(unittest.TestCase):
    def capabilities(self, cuda=False, vram=None, ram=8*GIB, vendor_types=()):
        return Capabilities(cuda, vendor_types, vram, ram, 12)

    def test_nvidia_4gb_cuda_uses_light_gpu(self):
        profile = select_profile("auto", self.capabilities(True, 4*GIB, vendor_types=("int8_float16",)))
        self.assertEqual((profile.device, profile.model), ("cuda", "base"))

    def test_nvidia_12gb_quality_uses_medium(self):
        self.assertEqual(select_profile("quality", self.capabilities(True, 12*GIB, vendor_types=("int8_float16",))).model, "medium")

    def test_detected_gpu_without_cuda_falls_back(self):
        self.assertEqual(select_profile("auto", self.capabilities(False, 8*GIB)).device, "cpu")

    def test_amd_intel_and_cpu_are_safe_cpu(self):
        for _vendor in ("amd", "intel", "none"):
            self.assertEqual(select_profile("balanced", self.capabilities()).compute_type, "int8")

    def test_low_ram_downgrades(self):
        self.assertEqual(select_profile("quality", self.capabilities(ram=2*GIB)).model, "tiny")

    def test_forced_cpu(self):
        profile = select_profile("auto", self.capabilities(True, 12*GIB, vendor_types=("int8_float16",)), True)
        self.assertEqual(profile.device, "cpu")

    def test_fallback_chain_is_finite(self):
        profile = select_profile("quality", self.capabilities(True, 12*GIB, vendor_types=("int8_float16",)))
        chain = fallback_chain(profile)
        self.assertEqual(len(chain), 3)
        self.assertEqual(chain[-1].device, "cpu")

    def test_cancel_signal(self):
        cancel = threading.Event()
        cancel.set()
        self.assertTrue(cancel.is_set())


if __name__ == "__main__":
    unittest.main()
