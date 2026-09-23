# Pipeline de transcripción local

## Alcance

TASK-005 incorpora transcripción completamente local sobre el video original. La UI solicita el trabajo a Rust; Rust valida el proyecto, selecciona un perfil y lanza un worker Python aislado; `faster-whisper`/CTranslate2 realiza la inferencia y entrega eventos JSONL. No se envía audio ni texto a una API.

```text
React → IPC Tauri → perfil de hardware → proceso Python
      ← eventos tipados ← JSONL stdout ← faster-whisper
                          ↓
      transcript.partial.json / transcript.json
```

El worker reserva stdout exclusivamente para un objeto JSON por línea. Los logs de las librerías no forman parte del protocolo. Los comandos actuales son `PROBE`, `SELECT_PROFILE`, `DOWNLOAD`, `START` y `CANCEL`.

## Ejecución y eventos

Sólo puede existir una transcripción global activa. El backend emite `transcription://event` con `projectId`, nombre de evento y payload. Los eventos incluyen inicio, modelo cargado, segmentos, fallback, idioma detectado, finalización, cancelación y error.

Cada segmento y palabra utiliza enteros en microsegundos; un timestamp que el motor no proporcione permanece `null`. La UI puede pulsar un segmento y posicionar el reproductor en `startUs` sin convertir el contrato persistido a segundos.

## Persistencia y recuperación

Durante la inferencia se reemplaza atómicamente `transcript.partial.json`. El checkpoint conserva segmentos ya producidos para diagnóstico y futura reanudación, pero la versión actual declara `resumeSupported: false`: al reintentar comienza desde cero para evitar duplicados o huecos. TASK-005 procesa la fuente completa, sin chunking ni solapamiento.

El resultado se construye primero como temporal. Sólo después de una salida correcta Rust reemplaza atómicamente `transcript.json`; si existía un resultado válido se conserva durante el reemplazo. Cancelar o fallar nunca convierte un temporal en resultado final. Al reabrir un proyecto que quedó `preparing` o `running` sin proceso activo, el workflow se recupera a `error` con un mensaje controlado.

El transcript incluye schema, proyecto/fuente, snapshot de tamaño y modificación del original, motor y perfil efectivo, idioma/probabilidad, estadísticas, segmentos y palabras. Si el archivo original cambia, el estado pasa a `stale` y exige retranscribir.

## Cancelación y memoria

La UI envía `CANCEL` y Rust termina el proceso si sigue vivo. Finalizar el proceso libera memoria CPU/GPU del motor aun si una librería nativa no atiende la señal cooperativa. El worker cierra referencias del modelo entre intentos de fallback.

## Desarrollo

Crear `.venv`, instalar `worker/requirements-transcription.txt` y ejecutar el worker con `PYTHONPATH=worker`. En desarrollo Rust prefiere `.venv/Scripts/python.exe`; una distribución debe empaquetar un sidecar y sus runtimes en lugar de depender de Python global.
