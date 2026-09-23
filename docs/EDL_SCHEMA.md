# EDL schema v1

El Edit Decision List es un documento declarativo y editable. Su unidad temporal canónica es el microsegundo entero (`startUs`, `endUs`, `sourceDurationUs`). Los segundos decimales sólo existen en la capa de metadata de entrada.

## Documento inicial

```json
{
  "schemaVersion": 1,
  "projectId": "UUID",
  "sourceId": "UUID",
  "timebase": { "unit": "microseconds" },
  "sourceDurationUs": 58000000,
  "tracks": {
    "cuts": [],
    "camera": [],
    "captions": [],
    "broll": [],
    "audio": []
  },
  "output": {
    "aspectRatioMode": "source",
    "resolutionMode": "source",
    "fpsMode": "source"
  },
  "updatedAt": "2026-09-23T12:00:00.000Z"
}
```

El EDL inicial siempre está vacío. TASK-003 no inventa cortes, movimientos, subtítulos, B-roll ni operaciones de audio.

## Contratos de tracks

Los tipos TypeScript y Rust reservan los siguientes contratos futuros:

- `cuts`: ID, intervalo, acción, razón y confianza.
- `camera`: ID, intervalo, modo, zoom, centro, easing, razón y confianza.
- `captions`: ID, intervalo, texto y estilo.
- `broll`: ID, intervalo, tipo de medio, origen, asset, razón y confianza.
- `audio`: ID, intervalo, operación y parámetros JSON.

Smart Cut V1 materializa sugerencias aceptadas como `cuts` con `action: "remove"`, UUID determinista, razón y confianza. Antes de guardar valida que los tiempos sean enteros no negativos, que `endUs > startUs`, que el rango no exceda la fuente y que no se solape accidentalmente con otro corte. Sugerencias pendientes o rechazadas nunca pasan al EDL.

## Evolución

`schemaVersion` cambia únicamente cuando una modificación rompe compatibilidad. Los lectores deben reconocer la versión antes de interpretar tracks. Una migración futura debe producir un documento nuevo válido, preservar el original hasta completar la escritura atómica y actualizar `updatedAt`.
