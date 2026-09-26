# Gestión de modelos

No hay modelos de IA obligatorios activos en la base actual.

Smart Cut, Smart Camera, audio y exportación funcionan con lógica local y FFmpeg/Rust sin descargar modelos silenciosamente.

Cualquier futura función que requiera modelos —por ejemplo separación neuronal de hablantes o análisis visual adicional— deberá:

- ser explícitamente habilitada;
- declarar tamaño y licencia;
- tener almacenamiento local controlado;
- evitar llamadas ocultas a APIs;
- permitir fallback o desactivación.

La API externa permanece desactivada por defecto.
