# Perfil de hardware

CHETO detecta recursos locales reutilizables por el pipeline multimedia:

- CPU;
- núcleos lógicos y físicos;
- arquitectura;
- RAM total y disponible;
- adaptadores GPU;
- VRAM dedicada;
- espacio libre del disco de trabajo.

La detección de GPU no implica que una aceleración concreta sea utilizable. Para exportación se valida el camino disponible y se mantiene fallback seguro a CPU cuando corresponde.

El perfil no contiene dependencias de transcripción.
