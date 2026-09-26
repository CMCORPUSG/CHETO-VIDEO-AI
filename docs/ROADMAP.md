# Roadmap

## Completado en la base actual

### Base Desktop
- Tauri + React.
- Proyectos locales.
- Importación de fuente sin modificar el original.
- FFprobe y metadata.
- Proxy local.
- Diagnóstico y configuración.

### Editor
- Player Original / Resultado.
- Timeline editable con microsegundos.
- IN/OUT, marcadores, ruler adaptativo y zoom temporal.
- Undo/Redo.
- Paneles redimensionables.
- Canvas 16:9, 4:3, 1:1, 9:16, 21:9 y personalizado.
- Escala y posición manual.
- Exportación MP4/H.264 con FFmpeg.

### Smart Cut
- Detección de silencios.
- Propuestas revisables.
- Aplicación idempotente al EDL.

### Smart Camera
- Perfiles Conservador / Normal / Dinámico.
- Modos Auto, Gameplay, Software, Presentación y General.
- Zoom dependiente de contenido.
- Anti-jitter.
- Preview y aplicación al EDL.
- Políticas específicas para fuentes largas de 1–2 horas.

### Audio
- Pista de audio visible en timeline.
- Selección de stream real cuando la fuente contiene varios.
- Mute y ganancia por tramo.
- Reducción de ruido global y por tramo.
- Enfoque de voz por filtrado.
- Zumbido 50/60 Hz.
- Atenuación de pitidos por frecuencia.
- Ganancia maestra.
- Normalización.
- Limitador de picos.
- Render real de estas decisiones mediante FFmpeg.

## Pendiente de validación/implementación futura

- Separación neuronal de hablantes o TV cuando todo viene mezclado en un único stream.
- OCR, detección de cursor y clics para enriquecer el modo Software/Tutorial.
- Miniaturas reales del video en la timeline.
- H.265 y MOV cuando se validen de extremo a extremo.
- Sidecar firmado de FFmpeg/FFprobe para distribución sin dependencia del PATH.
- Empaquetado/release final de instalador Windows.

No se incluyen transcripción ni subtítulos automáticos en el alcance actual.
