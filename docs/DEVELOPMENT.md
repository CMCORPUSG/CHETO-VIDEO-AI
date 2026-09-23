# Desarrollo

## Entorno mínimo

- Windows 10 u 11.
- Node.js 20.19 o superior.
- npm 10 o superior.
- FFprobe disponible en `PATH` para lectura real de metadata.

Para ejecutar sólo el frontend:

```powershell
npm install
npm run dev
```

## Requisitos nativos de Tauri

La ventana de escritorio necesita Rust y los prerrequisitos de compilación de Tauri para Windows. Este repositorio no los instala ni altera la configuración global.

1. Instala Microsoft C++ Build Tools con la carga de trabajo **Desarrollo de escritorio con C++** y Windows SDK.
2. Instala WebView2 Runtime si tu versión de Windows no lo incluye.
3. Instala Rust estable desde <https://rustup.rs/>. El comando habitual tras descargar `rustup-init.exe` es:

```powershell
rustup default stable-msvc
```

Abre una terminal nueva y verifica:

```powershell
rustc --version
cargo --version
```

Después ejecuta:

```powershell
npm run tauri -- dev
```

## FFprobe

La aplicación busca el ejecutable `ffprobe` en `PATH` y registra su primera línea de versión. No se descarga ni instala automáticamente. Verifica el entorno con:

```powershell
ffprobe -version
```

La ausencia del binario no bloquea el arranque: Diagnóstico mostrará **No disponible** y el modal explicará por qué no puede completar el análisis. En distribución futura podrá resolverse `ffprobe` como sidecar firmado sin cambiar el contrato de metadata.

## Comandos

| Comando | Propósito |
| --- | --- |
| `npm run dev` | Servidor de desarrollo web |
| `npm run typecheck` | TypeScript estricto |
| `npm run lint` | Reglas estáticas |
| `npm run build` | Build frontend de producción |
| `npm test` | Tests unitarios de normalización de metadata |
| `npm run tauri -- dev` | Aplicación nativa en desarrollo |

## Convenciones

- Componentes pequeños, propiedades tipadas y nombres explícitos.
- Sin `any` salvo una justificación documentada.
- Tokens compartidos para colores, espaciado, radios y sombras.
- Nada de claves, videos personales, modelos, temporales o logs privados en Git.
- APIs externas apagadas por defecto y sin actividad en background.

## Límites de v0.2

No se instala automáticamente FFmpeg, Python, modelos ni librerías de IA. El backend no usa shell, no lee el archivo completo y sólo conserva metadata y una referencia a la ruta. Para una descripción detallada, consulta `docs/MEDIA_INGEST.md`.
