# Ingesta de metadata multimedia

## Flujo

```text
Video local
   ↓ diálogo nativo de Tauri
Ruta absoluta
   ↓ IPC tipado
Backend Rust
   ↓ proceso sin shell + timeout
FFprobe JSON
   ↓ normalización TypeScript
VideoMetadata
   ↓
Project Store v2 → UI / Diagnóstico
```

## Seguridad y rendimiento

- El selector devuelve una ruta; JavaScript no recibe bytes del video.
- Rust usa `std::process::Command` con una lista de argumentos. Nombres con espacios, acentos, paréntesis o Unicode no se interpretan como comandos.
- FFprobe se ejecuta como `ffprobe -v error -show_format -show_streams -of json <ruta>` sin shell.
- El proceso tiene un límite de 20 segundos; si expira se termina y se registra un error controlado.
- Sólo stdout/stderr de metadata se conservan temporalmente. El consumo de memoria no crece con el tamaño del video.
- No hay red, Base64, hash completo, copia, movimiento ni modificación de la fuente.

## Detección

Al iniciar, `ffprobe -version` dispone de 3 segundos para responder. El estado y primera línea de versión aparecen en Diagnóstico. Si el ejecutable no existe, la app continúa funcionando y bloquea únicamente la lectura de metadata.

La resolución actual usa `PATH`. El contrato nativo mantiene `executable` separado para poder resolver más adelante un sidecar firmado y versionado. El repositorio no descarga binarios silenciosamente.

## Modelo normalizado

`VideoMetadata` conserva:

- fuente: nombre, ruta, extensión, tamaño y última modificación;
- formato: nombre visible y nombre técnico;
- duración real en segundos;
- video: codecs, dimensiones codificadas y visuales, FPS racional/decimal, aspecto, bitrate, pixel format y rotación;
- audio principal: presencia, codecs, sample rate, canales, layout y bitrate;
- recuentos de streams de video, audio, subtítulos, datos y otros.

Los valores opcionales permanecen `null`; nunca se inventan. Un archivo sin audio es válido. La primera pista de video y audio alimenta el resumen, mientras los recuentos preservan la existencia de pistas adicionales.

## Persistencia y migración

El esquema `cheto-video-ai.projects.v2` guarda la referencia y metadata, nunca el video. Si todavía no existe, se leen proyectos v1 y se crean entradas v2 con estado `legacy`. La clave v1 se conserva intacta como fallback. Una entrada legacy se completa usando **Localizar archivo**.

Al abrir un proyecto v2 se compara existencia, tamaño y fecha de modificación. La app muestra `source-missing` o `source-changed` sin calcular hashes de archivos grandes.

## Errores previstos

Se controlan binario ausente, timeout, ruta relativa, archivo inexistente, carpeta en lugar de archivo, archivo vacío, permisos, contenido inválido, JSON inválido, metadata incompleta y ausencia de video. Los mensajes de UI y log no incluyen rutas completas salvo en el detalle explícito del proyecto.

## Pendientes deliberados

- Empaquetar FFmpeg/FFprobe como sidecar.
- Abrir Explorer con selección segura del archivo (TASK-002A).
- Selector de pista cuando existan múltiples streams.
- Análisis de contenido; reproducción y proxies se incorporaron en TASK-004.
