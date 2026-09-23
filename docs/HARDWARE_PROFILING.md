# Perfil adaptativo de hardware

## Inventario

Rust obtiene CPU, núcleos físicos/lógicos, arquitectura, RAM y disco con `sysinfo`. En Windows enumera adaptadores mediante DXGI y conserva nombre, fabricante, IDs PCI y VRAM dedicada. El producto no depende de PowerShell, WMI ni `nvidia-smi`.

La presencia de una GPU no equivale a aceleración utilizable. El worker consulta CTranslate2, tipos de cómputo y, en Windows, la disponibilidad de las bibliotecas CUDA/cuDNN requeridas. La UI muestra por separado los adaptadores detectados y el backend de transcripción validado, junto con la razón del resultado.

## Modos

- `auto`: elige un perfil conservador según backend, VRAM y RAM disponible.
- `fast`: prioriza modelos pequeños.
- `balanced`: equilibrio predeterminado.
- `quality`: permite `medium` únicamente con CUDA y VRAM suficiente.

CUDA utiliza `int8_float16`; CPU utiliza `int8`, un worker y hasta ocho threads. Menos de 4 GiB de RAM disponible reduce el modelo. La opción de prueba `forceCpu` desactiva CUDA aunque esté validado.

## Fallback finito

Un perfil GPU tiene como máximo tres intentos: selección inicial, GPU con modelo más ligero si corresponde y CPU segura. Un perfil CPU no genera un ciclo de reintentos. Cada cambio emite un evento con el dispositivo/modelo fallido y la causa. Si todos los perfiles fallan, el workflow termina en `error`.

La selección es determinista y está cubierta con escenarios NVIDIA de VRAM baja/alta, GPU visible sin CUDA, AMD, Intel, sólo CPU y RAM baja.
