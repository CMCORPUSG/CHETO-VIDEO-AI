# Ingest

Ingest define el límite entre una fuente multimedia local y el resto del producto. TASK-002 implementa sólo metadata:

```text
Native picker → absolute path → Tauri command → FFprobe JSON → typed normalization → project store
```

La ejecución segura vive en `apps/desktop/src-tauri/src/media_ingest.rs`; los modelos y normalización viven en `apps/desktop/src/media`. Esta separación permite sustituir la detección por un sidecar empaquetado sin acoplar React al proceso.

El módulo no copia, mueve, transforma, reproduce ni carga videos en memoria. Audio extraído, proxies y validaciones de contenido pertenecen a tareas posteriores.
