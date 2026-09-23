# Arquitectura

## Principios

- **Local primero:** el producto debe funcionar sin servicios externos para sus capacidades principales.
- **Dependencias bajo demanda:** motores, modelos e integraciones sólo se inicializarán cuando una función concreta los necesite.
- **Decisiones auditables:** la edición futura se describirá como JSON/EDL antes del render.
- **Límites claros:** UI, orquestación, análisis y render se mantienen desacoplados.

## Flujo previsto

```text
Desktop UI
    ↓ selector nativo
Tauri IPC
    ↓ ruta absoluta
Metadata service / FFprobe
    ↓ modelo normalizado
Rust Project Storage
    ↓ JSON versionado en AppData
project.json + source.json + edl.json
    ↓
Python Worker (futuro)
    ↓
Engines
    ↓
JSON/EDL
    ↓
Renderer
```

### Desktop UI

Aplicación Tauri con React y TypeScript. Gestiona referencias locales ligeras, muestra metadata ya normalizada y nunca recibe el contenido completo del video.

### IPC Tauri

Los comandos `detect_ffprobe`, `probe_media` y `check_media_source` validan rutas, ejecutan procesos sin shell y devuelven resultados serializables. `probe_media` aplica un timeout de 20 segundos y captura stdout, stderr, código de salida y duración.

### Metadata service

FFprobe produce JSON técnico. `apps/desktop/src/media` lo convierte en un modelo estricto con duración, contenedor, streams, video, audio, FPS racional, bitrate, aspecto y rotación. React no invoca comandos de sistema ni expone el JSON bruto.

### Persistencia de proyecto

Rust centraliza el almacenamiento físico en `<appDataDir>/projects/<projectId>`. Valida UUID, evita path traversal y escribe `project.json`, `source.json` y `edl.json` mediante temporales y reemplazo seguro. React solicita operaciones por IPC y no escribe rutas arbitrarias.

`cheto-video-ai.projects.v2` se conserva como índice ligero. Al abrir una entrada con metadata válida pero sin manifest, se inicializa el bundle de disco reutilizando la metadata existente, sin ejecutar FFprobe de nuevo y sin alterar el nombre personalizado.

### Python Worker

Proceso local futuro responsable de orquestar tareas de análisis. El directorio existe como límite arquitectónico, sin dependencias ni código ejecutable en v0.1.

### Engines

Módulos independientes para ingest, audio, transcripción, escenas, visión, cursor, edición, subtítulos, render y calidad. Ingest ya define el límite funcional de metadata; los demás permanecen documentales.

### JSON/EDL

`project.json` describe identidad, referencias y workflow; `source.json` conserva una instantánea de FFprobe; `edl.json` define decisiones editables con microsegundos enteros como timebase. EDL v1 empieza con todos los tracks vacíos. Consulta `PROJECT_STORAGE.md` y `EDL_SCHEMA.md`.

### Renderer

Etapa futura que aplicará un EDL validado y producirá el archivo final conservando los parámetros de calidad definidos por el proyecto.

## Integraciones externas

`engine/integrations` queda reservado. Las integraciones estarán apagadas por defecto, nunca realizarán llamadas en segundo plano y sólo podrán activarse explícitamente para una función que las requiera. v0.1 no incluye clientes, claves ni llamadas de red.
