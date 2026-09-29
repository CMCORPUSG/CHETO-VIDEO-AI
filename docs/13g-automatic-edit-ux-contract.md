# Contrato UX futuro: Editar automáticamente (13G)

Este documento define la experiencia esperada. No activa ni implementa el motor automático.

1. Tras importar un video, el usuario podrá iniciar **Editar automáticamente**. El modo asistido mostrará propuestas para aprobar; el automático aplicará únicamente decisiones de confianza suficiente que pasen validación y control de conflictos.
2. El análisis avanzará por bloques temporales. La interfaz mostrará el tramo en análisis, el porcentaje de duración procesada, los hallazgos (silencios, cámara, eventos de audio) y las decisiones aplicadas (cortes, zooms, títulos, audio).
3. La timeline distinguirá bloques terminados, en proceso y pendientes. Cada bloque terminado tendrá sus decisiones EDL visibles y editables. Resultado permitirá revisar bloques ya terminados cuando sus archivos y revisiones sean consistentes.
4. **Pausar** detendrá nuevos bloques tras finalizar el trabajo seguro en curso. **Continuar** retomará los pendientes. **Cancelar** conservará los bloques terminados y las decisiones ya confirmadas, sin alterar el archivo original.
5. La sesión concluirá en revisión del usuario y exportación a la ruta elegida. No debe existir una espera opaca de horas sin progreso inspeccionable.

La implementación de este flujo, sus colas, validaciones y persistencia corresponde a 13G.
