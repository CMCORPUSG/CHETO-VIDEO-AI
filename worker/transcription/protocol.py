from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from typing import Any, TextIO


@dataclass(frozen=True)
class WorkerEvent:
    event: str
    payload: dict[str, Any]


def emit(event: str, payload: dict[str, Any], stream: TextIO = sys.stdout) -> None:
    stream.write(json.dumps(asdict(WorkerEvent(event, payload)), ensure_ascii=False) + "\n")
    stream.flush()


def parse_message(line: str) -> dict[str, Any]:
    value = json.loads(line)
    if not isinstance(value, dict) or not isinstance(value.get("command"), str):
        raise ValueError("worker message requires a string command")
    return value


def seconds_to_us(value: float | None) -> int | None:
    if value is None:
        return None
    if value < 0:
        raise ValueError("timestamps cannot be negative")
    return round(value * 1_000_000)
