from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

from .engine import FasterWhisperEngine, atomic_json, normalize_segment
from .profiles import Capabilities, ExecutionProfile, fallback_chain, select_profile
from .protocol import emit, parse_message

MODEL_REPOS = {name: f"Systran/faster-whisper-{name}" for name in ("tiny", "base", "small", "medium", "large-v3")}


def model_valid(path: Path) -> bool:
    return all((path / name).is_file() and (path / name).stat().st_size > 0 for name in ("model.bin", "config.json", "tokenizer.json"))


def download_model(model: str, models_root: str) -> int:
    if model not in MODEL_REPOS:
        raise ValueError("unsupported model")
    target = Path(models_root) / model
    if model_valid(target):
        emit("MODEL_READY", {"model": model, "reused": True})
        return 0
    emit("DOWNLOAD_STARTED", {"model": model})
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=MODEL_REPOS[model], local_dir=target)
    if not model_valid(target):
        raise RuntimeError("downloaded model is incomplete")
    emit("DOWNLOAD_COMPLETED", {"model": model, "reused": False})
    return 0


def probe() -> dict:
    try:
        import ctranslate2
        physical_count = ctranslate2.get_cuda_device_count()
        types = tuple(ctranslate2.get_supported_compute_types("cuda")) if physical_count else ()
        runtime_error = None
        if physical_count and sys.platform == "win32":
            # Device enumeration only proves that the driver sees a GPU. Actual
            # inference also needs the CUDA/cuDNN runtime libraries.
            import ctypes
            for library in ("cublas64_12.dll", "cudnn64_9.dll"):
                try:
                    ctypes.WinDLL(library)
                except OSError:
                    runtime_error = f"Falta o no se puede cargar {library}"
                    break
        usable_count = physical_count if runtime_error is None else 0
        if runtime_error:
            reason = runtime_error
        elif usable_count:
            reason = "CUDA y runtime validados"
        else:
            reason = "CTranslate2 no detectó dispositivos CUDA"
        return {"installed": True, "physicalCudaDeviceCount": physical_count, "cudaDeviceCount": usable_count, "cudaComputeTypes": types if usable_count else (), "version": ctranslate2.__version__, "reason": reason}
    except Exception as error:
        return {"installed": False, "cudaDeviceCount": 0, "cudaComputeTypes": (), "version": None, "reason": f"{type(error).__name__}: {error}"}


def listen_cancel(cancel: threading.Event) -> None:
    for line in sys.stdin:
        try:
            if parse_message(line).get("command") == "CANCEL":
                cancel.set()
                return
        except Exception:
            continue


def run(request: dict) -> int:
    cancel = threading.Event()
    threading.Thread(target=listen_cancel, args=(cancel,), daemon=True).start()
    profile = ExecutionProfile(**request["profile"])
    emit("START", {"profile": request["profile"]})
    last_error = None
    for attempt in fallback_chain(profile):
        engine = None
        try:
            model_path = str(Path(request["modelsRoot"]) / attempt.model)
            emit("MODEL_LOADING", {"device": attempt.device, "model": attempt.model, "computeType": attempt.compute_type})
            engine = FasterWhisperEngine(model_path, attempt)
            emit("MODEL_LOADED", {"device": attempt.device, "model": attempt.model})
            segments_iter, info = engine.transcribe(request["sourcePath"], request.get("language"), cancel)
            segments = []
            for raw in segments_iter:
                if cancel.is_set():
                    emit("CANCELLED", {})
                    return 2
                segment = normalize_segment(raw)
                segments.append(segment)
                processed = segment["endUs"] or 0
                atomic_json(request["checkpointPath"], {"schemaVersion": 1, "segments": segments, "processedUs": processed, "resumeSupported": False})
                emit("SEGMENT", {"segment": segment, "processedUs": processed, "segmentCount": len(segments), "wordCount": sum(len(item["words"]) for item in segments)})
            language = getattr(info, "language", None)
            probability = getattr(info, "language_probability", None)
            transcript = request["transcriptBase"] | {"engine": {"name": "faster-whisper", "model": attempt.model, "device": attempt.device, "computeType": attempt.compute_type}, "language": {"code": language, "probability": probability}, "statistics": {"segmentCount": len(segments), "wordCount": sum(len(item["words"]) for item in segments)}, "segments": segments}
            atomic_json(request["temporaryPath"], transcript)
            emit("COMPLETED", {"language": language, "languageProbability": probability, "segmentCount": len(segments), "wordCount": transcript["statistics"]["wordCount"], "profile": transcript["engine"]})
            return 0
        except Exception as error:
            last_error = f"{type(error).__name__}: {error}"
            emit("FALLBACK", {"failedDevice": attempt.device, "failedModel": attempt.model, "reason": last_error})
        finally:
            if engine is not None:
                engine.close()
    emit("ERROR", {"code": "all_profiles_failed", "message": last_error or "No execution profile succeeded"})
    return 1


def main() -> int:
    first = sys.stdin.readline()
    if not first:
        emit("ERROR", {"code": "missing_command", "message": "No command received"})
        return 1
    try:
        message = parse_message(first)
        if message["command"] == "PROBE":
            emit("PROBE_RESULT", probe())
            return 0
        if message["command"] == "SELECT_PROFILE":
            capabilities = Capabilities(**message["capabilities"])
            emit("PROFILE_RESULT", select_profile(message["mode"], capabilities, message.get("forceCpu", False)).__dict__)
            return 0
        if message["command"] == "DOWNLOAD":
            return download_model(message["model"], message["modelsRoot"])
        if message["command"] == "START":
            return run(message["request"])
        raise ValueError("unsupported command")
    except Exception as error:
        emit("ERROR", {"code": "invalid_request", "message": f"{type(error).__name__}: {error}"})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
