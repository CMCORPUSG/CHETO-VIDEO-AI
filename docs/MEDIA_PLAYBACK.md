# Reproducción multimedia

## Alcance

TASK-004 incorpora un reproductor local dentro del detalle del proyecto. La fuente se resuelve siempre por `projectId` en Rust; React no puede enviar una ruta arbitraria para reproducir ni escribir archivos.

El reproductor ofrece play, pausa, seek por clic o arrastre, inicio/final, saltos de cinco segundos, volumen, mute, fullscreen compatible con WebView y velocidades de preview entre 0.5x y 2x. La velocidad no modifica el archivo ni el EDL.

## Resolución de fuente

```text
projectId + preferencia
        ↓
Rust carga source.json y valida proxy.json
        ↓
proxy válido → media/proxy.mp4
sin proxy válido → fuente original
        ↓
scope asset dinámico para ese archivo exacto
        ↓
<video> de WebView
```

El protocolo local de Tauri está habilitado con un scope estático vacío. `get_playback_source` autoriza dinámicamente únicamente el archivo original registrado o el proxy administrado del proyecto. No se aceptan URLs remotas.

## Tiempo y estado

`source.json.durationUs` es la duración autoritativa. El DOM usa segundos durante reproducción, pero `secondsToUs`, `usToSeconds` y `clampTimelineUs` centralizan toda conversión con redondeo a enteros.

El estado controlado contempla `idle`, `loading`, `ready`, `playing`, `paused`, `ended` y `error`, además de `playheadUs`, velocidad, volumen y mute. El playhead vive sólo en memoria: no genera escrituras en localStorage, manifests ni EDL.

Los atajos Space y flechas izquierda/derecha se ignoran al escribir en inputs, textareas, selects o elementos editables.

## Limitaciones de TASK-004

- El soporte de codecs de reproducción depende de WebView2; el proxy H.264/AAC es la alternativa compatible.
- No existe edición, render final ni análisis IA.
- La selección de pistas múltiples queda para una etapa posterior.
