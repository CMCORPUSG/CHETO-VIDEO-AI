# Desarrollo

## Entorno mínimo

- Windows 10 u 11.
- Node.js 22.13 o superior.
- npm compatible.
- Rust estable MSVC.
- Microsoft C++ Build Tools con desarrollo de escritorio C++.
- Windows SDK.
- WebView2 Runtime.
- FFmpeg y FFprobe disponibles en `PATH`.

## Instalación

Desde la raíz:

```powershell
npm install
```

Frontend:

```powershell
npm run dev
```

Aplicación Tauri:

```powershell
npm run tauri -- dev
```

## Validación frontend

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

## Validación Rust

```powershell
cd apps/desktop/src-tauri
cargo fmt --check
cargo check
cargo test
```

GitHub Actions ejecuta ambos grupos en `main` y pull requests.

## FFmpeg / FFprobe

Verifica:

```powershell
ffmpeg -version
ffprobe -version
```

FFprobe se usa para metadata. FFmpeg se usa para proxy, análisis local y render. El repositorio no modifica automáticamente la instalación global del sistema.

## Convenciones

- Fuente de video inmutable.
- EDL no destructivo.
- Microsegundos enteros como unidad temporal.
- Componentes y contratos TypeScript tipados.
- Rust formateado con `cargo fmt`.
- Sin claves, videos personales, modelos, temporales o logs privados en Git.
- APIs externas desactivadas por defecto.
- No presentar como funcional una capacidad cuyo motor todavía no exista.

## Estado funcional relevante

El editor actual incluye Smart Cut, Smart Camera, audio y exportación FFmpeg. La documentación debe actualizarse cuando cambie el alcance; no se deben conservar textos de versiones antiguas que contradigan `main`.
