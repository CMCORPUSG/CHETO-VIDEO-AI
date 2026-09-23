# Worker local

El worker de transcripción usa JSONL por stdin/stdout. `stdout` está reservado al protocolo; los logs técnicos estructurados se escriben en `stderr`.

Desarrollo:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r worker\requirements-transcription.txt
.venv\Scripts\python.exe -m unittest discover -s worker\transcription\tests -v
```

Python 3.12 se recomienda en Windows por la disponibilidad de wheels de CTranslate2. La distribución futura empaquetará un sidecar y no dependerá del Python global.
