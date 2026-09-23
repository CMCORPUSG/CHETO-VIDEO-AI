# CHETO VIDEO AI

Aplicación de escritorio local para la edición inteligente y automática de videos largos. El proyecto prioriza una experiencia profesional, decisiones de edición auditables y procesamiento local.

## Estado actual

**v0.1.0 — Bootstrap**

Esta versión contiene únicamente la base del producto: shell de escritorio, interfaz inicial, navegación, design tokens, modal visual de proyecto, diagnóstico básico y documentación. No procesa ni reproduce video.

## Arquitectura prevista

```text
Desktop UI (Tauri + React)
          ↓
       IPC futuro
          ↓
     Python Worker
          ↓
       Engines
          ↓
       JSON / EDL
          ↓
       Renderer
```

El frontend vive en `apps/desktop`. `worker` y `engine` son límites arquitectónicos reservados; no contienen implementación funcional en esta fase.

## Stack

- Tauri 2 para el contenedor de escritorio.
- React y TypeScript estricto para la interfaz.
- Vite para desarrollo y build.
- Tailwind CSS y custom properties para estilos y tokens.
- Rust como requisito del contenedor Tauri, sin motor de video todavía.

## Desarrollo

Requisitos:

- Node.js 20.19 o superior.
- npm 10 o superior.
- Para ejecutar la ventana nativa: Rust estable y los prerrequisitos de Tauri para Windows.

```powershell
npm install
npm run dev
```

La interfaz web se abre en la URL que imprime Vite. Para la aplicación nativa, después de instalar Rust y los requisitos de Windows descritos en `docs/DEVELOPMENT.md`:

```powershell
npm run tauri -- dev
```

Validaciones:

```powershell
npm run typecheck
npm run lint
npm run build
```

## No implementado todavía

No hay importación real, lectura de metadata, procesamiento, FFmpeg, reproducción avanzada, timeline, transcripción, IA, Smart Cut, Smart Camera, subtítulos, B-roll, render, APIs externas ni descarga de modelos. La API externa permanece desactivada por diseño.

## Roadmap resumido

| Versión | Alcance |
| --- | --- |
| V0.1 | Base Desktop |
| V0.2 | Importación y metadata de video |
| V0.3 | Proyecto + JSON/EDL |
| V0.4 | Transcripción |
| V0.5 | Smart Cut |
| V0.6 | Smart Camera |
| V0.7 | Subtítulos |
| V0.8 | B-roll |
| V0.9 | Render + Quality Check |
| V1.0 | MVP usable |

Consulta [la arquitectura](docs/ARCHITECTURE.md), [el roadmap](docs/ROADMAP.md) y [la guía de desarrollo](docs/DEVELOPMENT.md) para más contexto.
