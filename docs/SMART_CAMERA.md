# Smart Camera V1

Smart Camera genera propuestas locales y revisables de movimiento de cámara para videos de pantalla. No renderiza, no modifica el video original, no crea subtítulos y no aplica decisiones sin aceptación explícita.

## Pipeline

1. Rust valida el proyecto, la fuente y su snapshot persistido.
2. FFmpeg decodifica por proceso hijo, sin shell, y envía frames grises de 160×90 por stdout. No se crean imágenes temporales ni se carga el video completo en memoria.
3. El motor compara cada muestra con la anterior, mide el cambio visual y calcula el centro ponderado de los píxeles activos.
4. Según el perfil, propone `zoom` central o `focus` desplazado y añade un `reset` seguro al finalizar.
5. La consolidación elimina solapes y movimientos demasiado frecuentes con prioridad determinista por confianza, duración y tipo.
6. Las propuestas se guardan en `smart_camera.json` para aceptar, rechazar y recuperar la revisión al reabrir.
7. Sólo las propuestas aceptadas se aplican a `edl.tracks.camera`.

## Perfiles

- **Conservador:** menos muestras y umbral más alto; zoom 1.15× e intervalos amplios.
- **Normal:** equilibrio entre sensibilidad y estabilidad; zoom 1.22×.
- **Dinámico:** más muestras y mayor sensibilidad; zoom 1.28× con intervalos más cortos.

Todos limitan el zoom a un máximo contractual de 1.5×, usan centros normalizados y exigen duraciones mínimas. Los perfiles afectan únicamente la generación de propuestas.

## Revisión y preview

Cada propuesta incluye intervalo en microsegundos, zoom, centro, transición, confianza, razón y estado. **Preview** posiciona el player y aplica visualmente la transformación sólo dentro del intervalo seleccionado. Al salir del intervalo vuelve a escala 1.0. Esta previsualización es efímera y no escribe el EDL.

Aceptar o rechazar actualiza `smart_camera.json`. **Aplicar aceptadas al EDL** valida rangos y solapes, conserva `tracks.cuts` y agrega UUID deterministas a `tracks.camera`; repetir la operación no duplica entradas.

## Persistencia, vigencia y cancelación

El documento se escribe mediante temporal y reemplazo atómico. Al cargar se compara `sourceId`, tamaño y fecha de modificación: una fuente distinta marca el análisis como `stale` e impide revisar o aplicar hasta reanalizar.

Durante el análisis la UI recibe progreso real estimado por timestamp procesado. Cancelar termina el proceso FFmpeg, registra workflow `cancelled` y no reemplaza un resultado válido anterior.

## Límites de V0.7

Esta versión detecta actividad visual global y regional; no incluye detección semántica de caras, OCR, seguimiento continuo de cursor ni render final. Tampoco implementa subtítulos: esa capacidad permanece en V0.8.
