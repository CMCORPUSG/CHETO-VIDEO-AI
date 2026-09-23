from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Capabilities:
    cuda_available: bool
    cuda_compute_types: tuple[str, ...]
    gpu_vram_bytes: int | None
    ram_available_bytes: int
    logical_cores: int


@dataclass(frozen=True)
class ExecutionProfile:
    device: str
    compute_type: str
    model: str
    cpu_threads: int
    workers: int
    reason: str
    automatic: bool = True


def select_profile(mode: str, capabilities: Capabilities, force_cpu: bool = False) -> ExecutionProfile:
    mode = mode.lower()
    threads = max(1, min(capabilities.logical_cores, 8))
    enough_cuda = capabilities.cuda_available and "int8_float16" in capabilities.cuda_compute_types and not force_cpu
    vram = capabilities.gpu_vram_bytes or 0
    low_ram = capabilities.ram_available_bytes < 4 * 1024**3
    if enough_cuda:
        if mode == "quality" and vram >= 10 * 1024**3:
            model = "medium"
        elif mode == "fast" or vram < 5 * 1024**3 or low_ram:
            model = "base"
        else:
            model = "small"
        return ExecutionProfile("cuda", "int8_float16", model, threads, 1, "CUDA validado por CTranslate2 y recursos compatibles")
    model = "tiny" if mode == "fast" or low_ram else "small" if mode in {"auto", "balanced", "quality"} else "base"
    reason = "CPU forzada" if force_cpu else "CUDA no utilizable; fallback CPU seguro"
    return ExecutionProfile("cpu", "int8", model, threads, 1, reason)


def fallback_chain(profile: ExecutionProfile) -> list[ExecutionProfile]:
    threads = profile.cpu_threads
    if profile.device == "cuda":
        lighter = "base" if profile.model in {"medium", "large-v3", "small"} else "tiny"
        return [profile, ExecutionProfile("cuda", "int8_float16", lighter, threads, 1, "fallback GPU liviano"), ExecutionProfile("cpu", "int8", "small", threads, 1, "fallback CPU final")]
    return [profile]
