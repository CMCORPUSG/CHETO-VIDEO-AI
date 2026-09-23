# Roadmap

El roadmap expresa dirección, no una promesa de fechas o alcance cerrado.

## V0.1 — Base Desktop

Shell Tauri/React, sistema visual, navegación, diagnóstico inicial y documentación.

## V0.2 — Importación y metadata (implementado)

Selección local nativa, validación segura, FFprobe, metadata normalizada, persistencia v2 y detalle técnico sin edición automática. Pendiente de distribución: sidecar y abrir ubicación.

## V0.3 — Proyecto + JSON/EDL (implementado)

Persistencia administrada por Rust, manifests versionados, migración progresiva desde el índice v2 y primera especificación EDL vacía en microsegundos.

## V0.4 — Playback + Proxy (implementado)

Reproductor local controlado, timebase en microsegundos, selección original/proxy, generación FFmpeg cancelable, progreso real y fallback NVENC→libx264.

## V0.5 — Transcripción (implementado)

Worker local faster-whisper/CTranslate2, inventario adaptativo de hardware, modelos bajo descarga explícita, fallback finito, cancelación, checkpoints y transcript v1 navegable desde el reproductor.

## V0.6 — Smart Cut

Detección y propuesta revisable de cortes.

## V0.7 — Smart Camera

Decisiones de zoom, paneo, seguimiento y reencuadre.

## V0.8 — Subtítulos

Edición, estilos y exportación de subtítulos.

## V0.9 — B-roll

Flujo opcional y explícito para sugerencias o generación cuando aporte valor.

## V0.10 — Render + Quality Check

Render MP4 y verificaciones técnicas del resultado.

## V1.0 — MVP usable

Flujo integrado de importación, análisis, revisión, preview y render.
