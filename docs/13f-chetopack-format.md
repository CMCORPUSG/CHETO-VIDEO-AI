# .chetopack (schemaVersion 1)

`.chetopack` es un ZIP local de datos. Incluye `manifest.json`, `checksums.json`, `licenses/LICENSES.json` y uno o más `templates/*.json`. Puede incluir `assets/images|overlays|other/*`, `fonts/*.ttf|otf`, `previews/*` y textos bajo `licenses/`.

`manifest.json` separa `packId` y `packVersion` de cada `templateId` y `templateVersion`. Las plantillas se instalan en el registro existente. Un proyecto guarda la identidad y el snapshot de su plantilla para conservar el fallback al desinstalar un pack.

`checksums.json` contiene SHA-256 de cada archivo salvo de sí mismo. Cada recurso declarado debe existir, coincidir con su hash y tener una entrada redistribuible en `LICENSES.json`. Los nombres de archivo son relativos y las rutas de la máquina de origen no entran al ZIP.

## Límites y seguridad

- ZIP máximo: 128 MiB; hasta 256 archivos.
- Archivo: 32 MiB; JSON: 1 MiB; total descomprimido: 128 MiB.
- Ratio de compresión: hasta 200:1 más 1 MiB de margen por entrada.
- Ruta: hasta 240 bytes, hasta seis segmentos; sin traversal, rutas absolutas, separadores Windows, nombres reservados, symlinks ni colisiones de mayúsculas/minúsculas.
- Extensiones permitidas: JSON, PNG, JPEG, WebP, GIF, TTF, OTF y textos de licencia. Se comprueba la cabecera de formatos binarios.
- Los paquetes no contienen código ejecutable ni declaran dependencias de red. Solo se admiten recetas y fuentes built-in reconocidas por el renderer actual.

La importación inspecciona el archivo antes de pedir confirmación. La instalación extrae a staging, vuelve a comprobar el archivo y publica la carpeta mediante rename; el índice se publica después. Las versiones anteriores instaladas se conservan cuando entra una actualización. La exportación genera un archivo temporal, lo valida y luego publica el destino elegido.

## Recursos externos

Las plantillas pueden declarar IDs locales con la forma `pack:<packId>@<packVersion>:fonts/...` o `assets/...`. La importación valida que cada referencia esté declarada, licenciada y contenida en el mismo paquete. El resolver autorizado comprueba índice, ruta canónica y hash antes de exponer el archivo.

Preview carga fuentes externas mediante `FontFace` y autoriza únicamente el archivo resuelto por Tauri. Resultado y Export copian la fuente validada a un nombre temporal derivado de SHA-256 y hacen que FFmpeg la use desde ese directorio. Una `graphicLayer` declarativa se convierte en un overlay de video usando el mismo asset resuelto. Si falla la resolución, la interfaz muestra un diagnóstico controlado; no hay fallback silencioso a Inter ni a una ruta original.
