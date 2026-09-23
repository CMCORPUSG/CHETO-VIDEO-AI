# Pipeline de proxy

## Propósito

El proxy sirve para preview, navegación y futuros análisis. Nunca reemplaza al original y nunca será la fuente implícita del render final.

Se crea sólo por acción explícita en:

```text
<appDataDir>/projects/<projectId>/media/
├── proxy.mp4
└── proxy.json
```

## Parámetros FFmpeg

- Escala Lanczos manteniendo relación de aspecto.
- Horizontal: caja máxima 960×540.
- Vertical: caja máxima 540×960.
- Sin upscale y siempre con dimensiones pares.
- FPS de la fuente, con GOP aproximado de dos segundos para facilitar seek.
- Pixel format `yuv420p`.
- Audio AAC estéreo a 128 kbit/s cuando existe.
- MP4 con `+faststart`.
- CPU: `libx264`, preset `veryfast`, CRF 23.
- GPU: `h264_nvenc`, preset `p4`, CQ 24.

FFmpeg publica progreso estructurado mediante `-progress pipe:1 -nostats`. El porcentaje se calcula contra `durationUs`; no se interpreta texto localizado ni se inventa progreso.

## NVENC y fallback

El backend primero comprueba que FFmpeg anuncie `h264_nvenc` y después codifica un frame sintético de 64×64. Sólo selecciona NVENC si ambas comprobaciones pasan. Si el encode real falla, elimina el temporal y reintenta automáticamente con `libx264`.

No se descarga CUDA ni se instalan drivers o paquetes adicionales.

## Escritura y cancelación

FFmpeg escribe `proxy.mp4.tmp` dentro de `media/`. El archivo sólo se renombra a `proxy.mp4` después de finalizar correctamente y superar FFprobe. `proxy.json` también se escribe mediante temporal.

Sólo puede existir una generación por proyecto. El backend conserva el proceso hijo; cancelar marca la tarea, termina FFmpeg y limpia el MP4 incompleto. `project.json`, `source.json`, `edl.json` y el original no se modifican.

## Vigencia

`proxy.json` registra schema, sourceId, tamaño, fecha de modificación, duración, codec, dimensiones, FPS, encoder y tamaño del proxy. El proxy se marca `stale` si cambia el tamaño o fecha observable del original, falta el MP4 o no coinciden sourceId/schema.

La reproducción automática utiliza un proxy válido; en cualquier otro caso usa el original. La UI muestra siempre `ORIGINAL` o `PROXY` y permite alternar cuando ambos están disponibles.

## Seguridad

- Rust valida el UUID antes de resolver rutas.
- El proxy sólo puede escribirse en `media/` del proyecto administrado.
- React entrega `projectId`, nunca un destino físico.
- No se usa shell para ejecutar FFmpeg/FFprobe.
- No hay red, servicios externos ni modificaciones del EDL.
