from __future__ import annotations

import gc
import json
import os
import threading
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Iterable

from .profiles import ExecutionProfile
from .protocol import seconds_to_us


class TranscriptionEngine(ABC):
    @abstractmethod
    def transcribe(self, source: str, language: str | None, cancel: threading.Event) -> tuple[dict[str, Any], Iterable[Any]]: ...

    @abstractmethod
    def close(self) -> None: ...


class FasterWhisperEngine(TranscriptionEngine):
    def __init__(self, model_path: str, profile: ExecutionProfile):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(model_path, device=profile.device, compute_type=profile.compute_type, cpu_threads=profile.cpu_threads, num_workers=profile.workers, local_files_only=True)

    def transcribe(self, source: str, language: str | None, cancel: threading.Event):
        return self.model.transcribe(source, task="transcribe", language=language, word_timestamps=True, vad_filter=True, condition_on_previous_text=True)

    def close(self) -> None:
        self.model = None
        gc.collect()


def normalize_word(word: Any, segment_start_us: int = 0) -> dict[str, Any]:
    start = seconds_to_us(getattr(word, "start", None))
    end = seconds_to_us(getattr(word, "end", None))
    return {"id": str(uuid.uuid4()), "startUs": None if start is None else start + segment_start_us, "endUs": None if end is None else end + segment_start_us, "text": getattr(word, "word", ""), "probability": getattr(word, "probability", None)}


def normalize_segment(segment: Any, offset_us: int = 0) -> dict[str, Any]:
    start = seconds_to_us(getattr(segment, "start", None))
    end = seconds_to_us(getattr(segment, "end", None))
    return {"id": str(uuid.uuid4()), "startUs": None if start is None else start + offset_us, "endUs": None if end is None else end + offset_us, "text": getattr(segment, "text", ""), "avgLogProb": getattr(segment, "avg_logprob", None), "noSpeechProb": getattr(segment, "no_speech_prob", None), "words": [normalize_word(word, offset_us) for word in (getattr(segment, "words", None) or [])]}


def atomic_json(path: str, value: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".write")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, target)
