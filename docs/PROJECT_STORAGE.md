# Almacenamiento de proyectos

Cada proyecto contiene `project.json`, `source.json` y `edl.json`. La fuente se identifica mediante ruta, tamaño, fecha de modificación e identificador estable. Los guardados usan escritura temporal y reemplazo atómico; el medio original nunca se modifica.
