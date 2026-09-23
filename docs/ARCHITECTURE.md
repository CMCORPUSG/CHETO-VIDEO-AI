# Arquitectura

## Principios

- **Local primero:** el producto debe funcionar sin servicios externos para sus capacidades principales.
- **Dependencias bajo demanda:** motores, modelos e integraciones sólo se inicializarán cuando una función concreta los necesite.
- **Decisiones auditables:** la edición futura se describirá como JSON/EDL antes del render.
- **Límites claros:** UI, orquestación, análisis y render se mantienen desacoplados.

## Flujo previsto

```text
Desktop UI
    ↓
IPC futuro
    ↓
Python Worker
    ↓
Engines
    ↓
JSON/EDL
    ↓
Renderer
```

### Desktop UI

Aplicación Tauri con React y TypeScript. Gestionará proyectos, configuración, diagnóstico y preview. En v0.1 sólo existe el shell visual y no se envían comandos de procesamiento.

### IPC futuro

Contrato tipado entre Tauri y el worker. Definirá comandos, progreso, cancelación y errores sin acoplar la UI a implementaciones concretas.

### Python Worker

Proceso local futuro responsable de orquestar tareas de análisis. El directorio existe como límite arquitectónico, sin dependencias ni código ejecutable en v0.1.

### Engines

Módulos independientes para ingest, audio, transcripción, escenas, visión, cursor, edición, subtítulos, render y calidad. En esta versión sólo existen descripciones de propósito.

### JSON/EDL

Formato intermedio futuro que conservará decisiones, tiempos, fuentes y parámetros. Permitirá revisar un plan antes de renderizarlo.

### Renderer

Etapa futura que aplicará un EDL validado y producirá el archivo final conservando los parámetros de calidad definidos por el proyecto.

## Integraciones externas

`engine/integrations` queda reservado. Las integraciones estarán apagadas por defecto, nunca realizarán llamadas en segundo plano y sólo podrán activarse explícitamente para una función que las requiera. v0.1 no incluye clientes, claves ni llamadas de red.
