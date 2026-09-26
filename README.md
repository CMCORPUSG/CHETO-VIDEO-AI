# CHETO VIDEO AI

Aplicación de escritorio local para edición asistida de videos largos, pensada para sesiones de 1–2 horas. El proyecto prioriza una experiencia NLE compacta, decisiones auditables, fuente inmutable y procesamiento local.

## Estado actual

La rama `main` contiene una base funcional de editor desktop con:

- proyectos locales y fuente de video referenciada sin modificar el archivo original;
- metadata mediante FFprobe;
- proxy local;
- reproductor con modos **Original** y **Resultado**;
- timeline editable con precisión `HH:MM:SS.mmm`;
- marcadores, selección IN/OUT, zoom temporal y scrubbing;
- Smart Cut basado en silencios;
- Smart Camera / Encuadre inteligente con perfiles y modos de contenido;
- encuadre manual con zoom, centro, transición y easing;
- adaptación de canvas a 16:9, 4:3, 1:1, 9:16, 21:9 y relación personalizada;
- escala y posición manual del contenido;
- audio editable y persistido en el EDL;
- selección de streams de audio reales cuando la fuente contiene más de uno;
- filtros locales de audio para reducción de ruido, enfoque de voz, zumbido, pitidos, ganancia, normalización y limitación de picos;
- exportación MP4/H.264 mediante FFmpeg con AAC, progreso, cancelación y fallback NVENC → libx264;
- UI dark compacta con paneles redimensionables y timeline sin scroll general de la aplicación.

No se incluyen transcripción ni subtítulos automáticos.

## Arquitectura

```text
React + TypeScript
        ↓
     Tauri IPC
        ↓
 Rust / Tauri backend
   ↓        ↓
FFprobe    FFmpeg
   ↓        ↓
metadata  análisis/render
        ↓
     JSON / EDL
```

El frontend vive en `apps/desktop`; el backend nativo en `apps/desktop/src-tauri`. La fuente de video permanece inmutable. Las decisiones se guardan en JSON/EDL usando microsegundos enteros.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS 3
- Radix UI
- Lucide React
- Tauri 2
- Rust
- FFmpeg / FFprobe

## Desarrollo

Requisitos principales:

- Node.js **22.13 o superior**.
- npm compatible con esa versión de Node.
- Rust estable MSVC.
- Microsoft C++ Build Tools + Windows SDK.
- WebView2 Runtime.
- FFmpeg y FFprobe disponibles en `PATH`.

Instalación:

```powershell
npm install
```

Aplicación nativa:

```powershell
npm run tauri -- dev
```

Validaciones:

```powershell
npm run typecheck
npm run lint
npm test
npm run build

cd apps/desktop/src-tauri
cargo fmt --check
cargo check
cargo test
```

GitHub Actions ejecuta estas validaciones para `main`.

## Comportamiento del Encuadre

- **Gameplay:** conservador para evitar zooms constantes causados por movimiento rápido de escena.
- **Software / Tutorial:** más sensible a cambios sostenidos de región, con mayor detalle y transiciones suaves.
- **Presentación:** prioriza áreas estables y cambios de contenido.
- **Auto / General:** mantiene un comportamiento seguro y moderado.

El análisis está limitado para videos largos para evitar cientos de propuestas innecesarias.

## Audio

Si el archivo contiene varios streams de audio reales, CHETO permite seleccionar cuál conservar al exportar. Si todo está mezclado dentro de un solo stream, se aplican filtros y ediciones no destructivas sobre esa mezcla.

La separación automática de personas/televisor dentro de una única mezcla no se presenta como una función terminada.

## Límites actuales

- No hay transcripción ni subtítulos automáticos.
- No hay separación neuronal de hablantes/TV dentro de una mezcla única.
- No hay OCR ni seguimiento de cursor implementados todavía para Software/Tutorial.
- H.265/MOV no se anuncian como soportados hasta validarlos de extremo a extremo.
- La API externa permanece desactivada por defecto.

Consulta [Arquitectura](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), [EDL](docs/EDL_SCHEMA.md) y [Desarrollo](docs/DEVELOPMENT.md).
