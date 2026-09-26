# Arquitectura

CHETO VIDEO AI combina React/TypeScript, Tauri/Rust y FFmpeg/FFprobe. La fuente original se trata como inmutable: las operaciones se representan como decisiones de edición y sólo se materializan durante preview o render.

## Capas

```text
UI React
  ├─ Proyectos
  ├─ Player
  ├─ Timeline
  ├─ Smart Cut
  ├─ Smart Camera
  ├─ Audio
  └─ Export
        ↓
Servicios TypeScript / contratos
        ↓
IPC Tauri
        ↓
Backend Rust
  ├─ almacenamiento de proyecto
  ├─ FFprobe
  ├─ proxy
  ├─ Smart Cut
  ├─ Smart Camera
  └─ exportación FFmpeg
```

## Persistencia

Cada proyecto conserva manifiestos JSON. El EDL usa microsegundos enteros y tracks separados para cortes, cámara, b-roll y audio. Las escrituras críticas son atómicas cuando corresponde.

## Smart Cut

Smart Cut analiza silencios locales con FFmpeg y produce candidatos revisables. No depende de transcripción.

## Smart Camera

Smart Camera analiza frames reducidos y en streaming para evitar cargar videos completos en memoria. Los perfiles y el `contentMode` modifican sensibilidad, intervalo de muestra, duración mínima, transición, zoom y densidad de propuestas.

- Gameplay conserva una política prudente.
- Software/Tutorial usa una política más activa y estable.
- Presentation prioriza cambios sostenidos.
- Auto/General mantienen defaults conservadores.

El preview y el export intentan representar el mismo zoom/centro/paneo.

## Audio

Las operaciones de audio se persisten en `tracks.audio`. El render FFmpeg puede aplicar:

- selección de stream fuente;
- mute por tramo;
- ganancia por tramo;
- reducción de ruido;
- filtrado orientado a voz;
- eliminación de zumbido;
- notch para pitidos;
- ganancia maestra;
- normalización;
- limitador de picos.

Cuando la fuente contiene varios streams reales, se puede seleccionar cuál renderizar. Una mezcla única no se divide artificialmente en hablantes.

## Exportación

El backend Rust construye el grafo FFmpeg a partir del EDL y la configuración de exportación. H.264/MP4 es el camino validado. Cuando NVENC no es utilizable se usa fallback seguro a `libx264`.

La exportación expone progreso y cancelación.
