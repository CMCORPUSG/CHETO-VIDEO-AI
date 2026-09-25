# Arquitectura

La aplicación combina React, Tauri/Rust y herramientas locales de FFmpeg. React gestiona proyecto, reproductor, proxy, Smart Cut y Smart Camera. Rust valida fuentes, persiste manifiestos y ejecuta análisis ligeros sin cargar el vídeo completo en memoria.

Smart Cut detecta silencios y produce propuestas revisables. Smart Camera analiza muestras reducidas y aplica encuadres aceptados al track de cámara. Las operaciones son locales, cancelables cuando corresponde e idempotentes.
