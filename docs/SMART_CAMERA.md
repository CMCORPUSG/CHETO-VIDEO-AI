# Smart Camera V1 / Encuadre inteligente

Encuadre inteligente genera propuestas locales y revisables de cámara virtual (zoom, enfoque y retorno a vista completa) para cualquier video. No significa webcam: analiza el contenido del video, no una cámara física. No renderiza, no modifica el video original y no aplica decisiones sin aceptación explícita.

## Pipeline

1. Rust valida el proyecto, la fuente y su snapshot persistido.
2. FFmpeg decodifica por proceso hijo, sin shell, y envía frames grises de 160×90 por stdout. El flujo es streaming: no se crean imágenes temporales ni se carga el video completo en memoria, por lo que es compatible con fuentes de 1–2 horas.
3. El motor compara cada muestra con la anterior, mide el cambio visual y calcula el centro ponderado de los píxeles activos.
4. Según el perfil, propone `zoom` central o `focus` desplazado y añade un `reset` seguro al finalizar.
5. La consolidación elimina solapes y movimientos demasiado frecuentes con prioridad determinista por confianza, duración y tipo.
6. Las propuestas se guardan en `smart_camera.json` para aceptar, rechazar y recuperar la revisión al reabrir.
7. Sólo las propuestas aceptadas se aplican a `edl.tracks.camera`.

## Contexto de contenido

El contrato persistido incluye `contentMode`: `auto`, `software`, `gameplay`, `presentation` o `general`. `auto`, `gameplay` y `general` conservan el detector conservador validado para gameplay. `software` y `presentation` tienen una línea de configuración separada para incorporar señales de cursor, interacción, cambios de interfaz y narración cuando esas señales estén disponibles; hoy no se inventan señales de cursor/OCR que todavía no existen.

La selección manual tendrá prioridad sobre la detección automática cuando se exponga en UI. El modo no cambia el hecho de que todas las propuestas son revisables y previsualizables.

## Perfiles

- **Conservador:** menos muestras y umbral más alto; zoom 1.15× e intervalos amplios.
- **Normal:** equilibrio entre sensibilidad y estabilidad; zoom 1.22×.
- **Dinámico:** más muestras y mayor sensibilidad; zoom 1.28× con intervalos más cortos.

Todos limitan el zoom a un máximo contractual de 1.5×, usan centros normalizados y exigen duraciones mínimas. Los perfiles afectan únicamente la generación de propuestas.

## Revisión y preview

Cada propuesta incluye intervalo en microsegundos, zoom, centro, transición, confianza, razón y estado. **Previsualizar** posiciona el player y aplica visualmente la transformación sólo dentro del intervalo seleccionado. Al salir del intervalo vuelve a escala 1.0. Esta previsualización es efímera y no escribe el EDL.

Aceptar o rechazar actualiza `smart_camera.json`. **Aplicar aceptadas al EDL** valida rangos y solapes, conserva `tracks.cuts` y agrega UUID deterministas a `tracks.camera`; repetir la operación no duplica entradas.

## Persistencia, vigencia y cancelación

El documento se escribe mediante temporal y reemplazo atómico. Al cargar se compara `sourceId`, tamaño y fecha de modificación: una fuente distinta marca el análisis como `stale` e impide revisar o aplicar hasta reanalizar.

Durante el análisis la UI recibe progreso real estimado por timestamp procesado (`processedUs / durationUs`). Cancelar termina el proceso FFmpeg, registra workflow `cancelled` y no reemplaza un resultado válido anterior. El contrato de progreso y el documento ya son compatibles con procesamiento por ventanas y checkpoints; la reanudación desde un checkpoint todavía no se activa en V1.

## Límites de V0.7

Esta versión detecta actividad visual global y regional; no incluye todavía detección semántica de caras, OCR, seguimiento continuo de cursor ni render final. El modo software está preparado como política separada, pero no persigue el cursor pixel a pixel: las señales futuras deberán agrupar regiones persistentes, clics y narración antes de superar un umbral. La densidad de propuestas y la cancelación ya están acotadas; la reanudación de análisis largo permanece documentada como siguiente incremento acotado, no como comportamiento fingido.
