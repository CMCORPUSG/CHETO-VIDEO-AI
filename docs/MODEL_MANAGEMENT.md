# Gestión local de modelos

## Ubicación y estados

Los modelos viven fuera del repositorio en:

```text
<appLocalDataDir>/models/whisper/<model>/
```

Los estados públicos son `not_installed`, `downloading`, `ready`, `invalid` y `error`. Un modelo sólo está listo si `model.bin`, `config.json` y `tokenizer.json` existen y no están vacíos.

## Descarga explícita

La inferencia nunca inicia una descarga implícita. La UI presenta el modelo seleccionado y su tamaño estimado; el usuario pulsa **Descargar modelo**. El worker descarga el snapshot oficial compatible con faster-whisper, valida sus archivos y emite inicio, finalización o fallo. Una vez instalado, la transcripción puede ejecutarse offline.

Los modelos admitidos son `tiny`, `base`, `small`, `medium` y `large-v3`. El selector adaptativo puede proponer otro modelo durante un fallback, pero si no está instalado ese intento falla de forma controlada y avanza al siguiente perfil finito; no descarga nada silenciosamente.

## Portabilidad

Los pesos, la caché, `.venv` y los transcripts de prueba están ignorados por Git. La distribución futura debe fijar y firmar un sidecar Python/CTranslate2, verificar integridad de los modelos y ofrecer eliminación/actualización explícita sin guardar secretos: este pipeline no usa claves API.
