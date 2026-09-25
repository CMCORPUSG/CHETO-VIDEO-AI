# Smart Cut

Smart Cut analiza el audio de forma local y propone cortes revisables mediante detección de silencios y heurísticas conservadoras. Las propuestas aceptadas se aplican de forma idempotente al track `edl.tracks.cuts`; la fuente original permanece inmutable y los tiempos son enteros de microsegundos.
