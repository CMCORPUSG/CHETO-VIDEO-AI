# Smart Cut V1

Smart Cut genera propuestas locales y revisables a partir de `transcript.json`. Nunca modifica el video original ni aplica cortes durante el análisis.

## Flujo

1. El usuario selecciona Conservador, Normal o Agresivo.
2. Rust valida proyecto, fuente y transcript.
3. Se detectan silencios prolongados, muletillas aisladas, repeticiones inmediatas y falsos inicios.
4. Las propuestas solapadas se consolidan conservando la de mayor confianza.
5. `smart_cut.json` se guarda atómicamente con cada estado `pending`, `accepted` o `rejected`.
6. Sólo una acción explícita convierte las aceptadas en operaciones `remove` del track `edl.tracks.cuts`.

Los perfiles centralizan umbral de silencio, duración mínima, margen de habla, ventana de reformulación y confianza. Incluso Agresivo conserva una duración mínima para impedir microcortes.

## Seguridad

Todos los tiempos persistidos son enteros en microsegundos. Antes de aplicar se comprueba `endUs > startUs`, duración de fuente, duración mínima, solapamientos y conflictos con cortes existentes. Los IDs UUID v5 se derivan del tipo y rango, por lo que reaplicar el mismo análisis es idempotente.

Si cambia el `sourceId`, tamaño o modificación del original, el documento pasa a `stale` y no puede aplicarse. Un transcript ausente, obsoleto o corrupto produce un error controlado. El EDL se reemplaza mediante la escritura atómica existente y el original continúa inmutable.

## Límites actuales

V1 usa heurísticas deliberadamente conservadoras sobre timestamps y texto del transcript. No usa LLM, nube, GPU ni modelos nuevos. No renderiza video y no intenta decidir semánticamente si una frase correcta debe eliminarse; cada propuesta requiere revisión humana.
