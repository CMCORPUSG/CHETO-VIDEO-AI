# Audio Intelligence 13B: detector local

## Integrado

- **Detector:** `webrtc-vad` 0.4.0, enlace Rust para libfvad/WebRTC VAD.
- **Origen:** https://github.com/kaegi/webrtc-vad y https://github.com/dpirch/libfvad
- **Licencias:** MIT para el enlace Rust y licencia BSD de tres cláusulas para libfvad/WebRTC. Copias: [webrtc-vad-LICENSE](../apps/desktop/src-tauri/licenses/webrtc-vad-LICENSE) y [libfvad-LICENSE](../apps/desktop/src-tauri/licenses/libfvad-LICENSE). Ambas permiten redistribución y uso comercial conservando los avisos. Incluir estos archivos al crear un instalador; el empaquetado Tauri aún está desactivado.
- **Tamaño:** el paquete fuente de crates.io es aproximadamente 1,31 MB. No se distribuyen pesos externos ni se descargan modelos al abrir la aplicación.
- **Ejecución:** CPU, audio mono PCM a 16 kHz, frames de 30 ms. Sin GPU ni Python. La compilación en Windows con el toolchain actual pasó `cargo check`.
- **Mantenimiento:** versión del enlace Rust antigua (0.4.0); conviene revisar alternativas mantenidas antes de distribuir comercialmente. libfvad deriva del VAD de WebRTC.
- **Alcance real:** detecta actividad de voz, sin probabilidad calibrada ni identificación de hablante. Un VAD puede marcar música o ruido parecido al habla y perder voz tenue. No clasifica ladridos, TV, música, golpes o hablantes.

## Evaluado, no integrado

- **YAMNet:** modelo de clasificación general de 521 eventos publicado por TensorFlow. La integración distribuible en Windows requiere validar pesos, runtime, licencia del artefacto concreto y rendimiento en videos largos. No se mostrará ninguna de sus etiquetas hasta que exista inferencia local reproducible.
- **Silero VAD:** modelo ONNX de detección de voz; su integración implicaría empaquetar pesos y runtime ONNX. WebRTC VAD cubre la primera fase de voz con menor dependencia binaria.
- **Separación de hablantes:** pendiente. La interfaz `SpeechSeparationEngine` existe sin instancia ni botón. La detección de voz no demuestra que se pueda eliminar una voz solapada.

## Procesamiento

Se inicia solo por acción del usuario. FFmpeg decodifica el stream elegido a PCM mono de 16 kHz. Se leen frames con un canal acotado de 32 frames para no cargar el audio completo en memoria. La caché local depende de ruta, tamaño, fecha de modificación, stream, frecuencia y versión del detector. La cancelación termina FFmpeg y no reemplaza una caché válida. Las acciones usan las operaciones de audio del EDL existente: `mute_range`, `gain_range` y `noise_reduction_range` (FFmpeg `afftdn`).
