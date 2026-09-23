# Almacenamiento de proyectos

## Ubicación

Los proyectos no se guardan en el repositorio ni junto al video. El backend resuelve el directorio administrado por Tauri y utiliza:

```text
<appDataDir>/projects/<projectId>/
├── project.json
├── source.json
├── edl.json
├── transcript.json              # sólo tras completar
└── transcript.partial.json      # checkpoint recuperable
```

En Windows, con el identificador actual, la ubicación esperada es `%APPDATA%/com.chetovideoai.desktop/projects`. La aplicación obtiene este valor mediante `app.path().app_data_dir()`; React no construye ni recibe rutas arbitrarias de escritura.

## Responsabilidades

Rust (`src-tauri/src/project_storage.rs`):

- resuelve y crea el directorio administrado;
- exige UUID válidos para `projectId` y `sourceId`;
- rechaza traversal, rutas absolutas y separadores usados como ID;
- crea, lee y valida los tres documentos;
- escribe JSON formateado mediante archivo temporal, sincronización y reemplazo con respaldo;
- devuelve errores serializables sin exponer el contenido de los documentos.

React/TypeScript (`src/project`):

- convierte la metadata normalizada existente en contratos de persistencia;
- convierte segundos a microsegundos enteros;
- solicita operaciones tipadas mediante IPC;
- conserva `cheto-video-ai.projects.v2` únicamente como índice ligero y caché visual.

## Creación y reapertura

Un proyecto nuevo se añade al índice v2 sólo después de que Rust haya escrito `source.json`, `edl.json` y finalmente `project.json`. La metadata ya disponible en memoria se reutiliza; FFprobe no se ejecuta por segunda vez.

Al abrir un proyecto v2:

1. Rust comprueba si existe `project.json`.
2. Si existe, carga y valida el bundle de disco.
3. Si no existe y el índice contiene ruta y metadata válidas, crea los tres archivos sin cambiar el ID ni el nombre personalizado.
4. Si faltan ruta o metadata, el proyecto permanece recuperable mediante **Localizar archivo**.

La clave v2 no se elimina y no se duplica el proyecto.

## Schemas v1

`project.json`:

```json
{
  "schemaVersion": 1,
  "projectId": "UUID",
  "name": "Nombre del proyecto",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "source": {
    "sourceId": "UUID",
    "fileName": "video.mp4",
    "originalPath": "ruta local original",
    "sourceJson": "source.json"
  },
  "edl": { "schemaVersion": 1, "file": "edl.json" },
  "workflow": {
    "ingest": "completed",
    "transcription": "not_started",
    "sceneAnalysis": "not_started",
    "smartCut": "not_started",
    "smartCamera": "not_started",
    "captions": "not_started",
    "broll": "not_started",
    "render": "not_started"
  }
}
```

`source.json` conserva `schemaVersion`, `sourceId`, ruta, nombre, extensión, tamaño, fecha de modificación, `durationUs`, contenedor, video, audio y recuento de streams. Video incluye dimensiones codificadas y visuales, FPS racional/decimal, pixel format, bitrate, rotación y relación de aspecto. Audio conserva presencia, codecs, sample rate, canales, layout y bitrate; los valores no disponibles permanecen `null`.

La forma exacta de `edl.json` está documentada en `EDL_SCHEMA.md`.

## Compatibilidad de schemas

Cada archivo tiene su propio `schemaVersion`. TASK-003/005 soporta únicamente la versión 1 y rechaza versiones incompatibles con un error controlado. Las futuras versiones deben incorporar migraciones explícitas; nunca deben reinterpretar ni sobrescribir silenciosamente un schema desconocido.

## Transcript v1

`transcript.json` conserva `projectId`, `sourceId`, snapshot de la fuente, fecha, motor/perfil efectivo, idioma, estadísticas y segmentos/palabras en microsegundos. Rust compara ID, tamaño y modificación del original para marcar resultados obsoletos. La escritura usa temporal y reemplazo seguro; un fallo o cancelación no destruye el transcript válido anterior. `transcript.partial.json` no se interpreta como resultado final y actualmente no permite reanudar a mitad de archivo.

## Límites históricos de TASK-003

TASK-003 no creaba archivos vacíos para análisis. TASK-005 añade el transcript únicamente cuando existe contenido real y mantiene el video original inmutable.
