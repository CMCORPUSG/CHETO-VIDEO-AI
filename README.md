# CHETO VIDEO AI

Aplicación de escritorio local para la edición inteligente y automática de videos largos. El proyecto prioriza una experiencia profesional, decisiones de edición auditables y procesamiento local.

## Estado actual

**v0.2.0 — Importación local y metadata**

La aplicación ya puede seleccionar un video mediante el diálogo nativo, entregar su ruta al backend Tauri, consultar FFprobe y persistir metadata normalizada. El archivo original permanece en su ubicación: no se copia, modifica, sube ni carga completo en memoria.

## Arquitectura prevista

```text
Desktop UI (Tauri + React)
          ↓
       IPC Tauri
          ↓
   FFprobe (metadata)
          ↓
 Python Worker (futuro)
          ↓
       Engines
          ↓
       JSON / EDL
          ↓
       Renderer
```

El frontend vive en `apps/desktop`; el comando nativo está en `apps/desktop/src-tauri` y la normalización tipada en `apps/desktop/src/media`. `worker` continúa reservado para análisis futuros.

## Stack

- Tauri 2 para el contenedor de escritorio.
- React y TypeScript estricto para la interfaz.
- Vite para desarrollo y build.
- Tailwind CSS y custom properties para estilos y tokens.
- Rust como backend nativo y FFprobe como motor de metadata.

## Desarrollo

Requisitos:

- Node.js 20.19 o superior.
- npm 10 o superior.
- Para ejecutar la ventana nativa: Rust estable, los prerrequisitos de Tauri para Windows y `ffprobe` disponible en `PATH`.

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
npm test
```

## Límites actuales

El producto mantiene reproducción, proyecto, proxy, Smart Cut y Smart Camera locales. FFprobe se detecta, pero el repositorio no lo descarga ni lo instala silenciosamente. “Abrir ubicación” y el empaquetado como sidecar quedan preparados para una fase posterior. La API externa permanece desactivada.

## Roadmap resumido

| Versión | Alcance |
| --- | --- |
| V0.1 | Base Desktop |
| V0.2 | Importación y metadata de video |
| V0.3 | Proyecto + JSON/EDL |
| V0.5 | Smart Cut |
| V0.7 | Smart Camera |
| V0.8 | B-roll |
| V0.9 | Render + Quality Check |
| V1.0 | MVP usable |

Consulta [la arquitectura](docs/ARCHITECTURE.md), [el roadmap](docs/ROADMAP.md) y [la guía de desarrollo](docs/DEVELOPMENT.md) para más contexto.
