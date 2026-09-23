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
Project Store v2
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

### Project Store v2

`cheto-video-ai.projects.v2` conserva sólo ruta, snapshot básico y metadata. La migración lee v1 sin borrarlo; las referencias antiguas quedan marcadas como `legacy` hasta relocalizar su fuente.

### Python Worker

Proceso local futuro responsable de orquestar tareas de análisis. El directorio existe como límite arquitectónico, sin dependencias ni código ejecutable en v0.1.

### Engines

Módulos independientes para ingest, audio, transcripción, escenas, visión, cursor, edición, subtítulos, render y calidad. Ingest ya define el límite funcional de metadata; los demás permanecen documentales.

### JSON/EDL

Formato intermedio futuro que conservará decisiones, tiempos, fuentes y parámetros. Permitirá revisar un plan antes de renderizarlo.

### Renderer

Etapa futura que aplicará un EDL validado y producirá el archivo final conservando los parámetros de calidad definidos por el proyecto.

## Integraciones externas

`engine/integrations` queda reservado. Las integraciones estarán apagadas por defecto, nunca realizarán llamadas en segundo plano y sólo podrán activarse explícitamente para una función que las requiera. v0.1 no incluye clientes, claves ni llamadas de red.
