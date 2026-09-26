# EDL

El EDL es la representación no destructiva de la edición.

## Tiempo

`timebase.unit` es `microseconds`. Los rangos se guardan como enteros:

- `startUs`
- `endUs`
- `transitionUs` cuando corresponde.

## Tracks

```text
tracks
  ├─ cuts
  ├─ camera
  ├─ broll
  └─ audio
```

### cuts

Rangos eliminados o decisiones de corte.

### camera

Decisiones de encuadre con zoom, centro X/Y, transición y easing.

### audio

Operaciones no destructivas. La implementación actual reconoce, entre otras:

- `source_stream`
- `mute_range`
- `gain_range`
- `noise_reduction`
- `noise_reduction_range`
- `voice_focus`
- `hum_filter`
- `notch_range`
- `master_gain`
- `normalize`
- `peak_limiter`

`parameters` conserva la configuración propia de cada operación, por ejemplo `gainDb`, `amount`, `hz`, `index` o `limit`.

## Output

El EDL conserva configuración de salida como resolución, FPS y relación de aspecto. La UI permite trabajar con Original, 16:9, 4:3, 1:1, 9:16, 21:9 y relación personalizada.

La fuente original no se modifica.
