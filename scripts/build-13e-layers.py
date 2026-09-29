"""Add stable editable layer metadata to the bundled 13E templates."""
import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "apps/desktop/src/templates/builtin-manifests.json"
catalog = json.loads(path.read_text(encoding="utf-8"))

def text(layer_id: str, label: str, parameter: str):
    return {"layerId": layer_id, "type": "text", "role": label, "parameterId": parameter, "editable": True, "locked": False}

def shape(layer_id: str, label: str):
    return {"layerId": layer_id, "type": "shape", "role": label, "editable": False, "locked": True}

layouts = {
    "editorial-master": [text("eyebrow", "Antetítulo", "secondaryText"), text("headline", "Título", "text"), shape("accent", "Acento")],
    "future-glow": [text("eyebrow", "Antetítulo", "secondaryText"), text("headline", "Título", "text"), shape("glow", "Brillo"), shape("accent", "Línea")],
    "content-create": [text("eyebrow", "Antetítulo", "secondaryText"), text("headline", "Título", "text"), shape("panel", "Panel")],
    "neon-statement": [text("headline", "Título", "text"), shape("glow", "Brillo")],
    "kinetic-pop": [text("headline", "Título", "text"), shape("panel", "Panel")],
    "letter-cascade-pro": [text("headline", "Título", "text"), shape("underline", "Subrayado")],
    "dynamic-slide": [text("headline", "Título", "text"), text("secondary", "Subtítulo", "secondaryText"), shape("accent", "Acento")],
    "typewriter-tech": [text("headline", "Título", "text"), text("eyebrow", "Etiqueta", "secondaryText"), shape("panel", "Panel")],
    "word-highlight": [text("headline", "Título", "text"), shape("highlight", "Resaltado")],
    "split-impact": [text("eyebrow", "Antetítulo", "secondaryText"), text("headline", "Título", "text"), shape("panel", "Panel")],
    "stacked-reveal-pro": [text("eyebrow", "Antetítulo", "secondaryText"), text("headline", "Título", "text"), shape("accent", "Acento")],
    "underline-editorial": [text("headline", "Título", "text"), text("secondary", "Subtítulo", "secondaryText"), shape("underline", "Subrayado")],
    "lower-third-premium": [text("name", "Nombre", "text"), text("role", "Cargo", "secondaryText"), shape("accent", "Acento"), shape("panel", "Panel")],
    "stat-hero": [text("value", "Número", "text"), text("label", "Etiqueta", "secondaryText"), shape("accent", "Acento")],
    "tutorial-step": [text("step", "Paso", "secondaryText"), text("headline", "Título", "text"), text("description", "Descripción", "descriptionText"), shape("panel", "Panel")],
    "quote-editorial": [text("quote", "Cita", "text"), text("author", "Autor", "secondaryText"), shape("accent", "Acento")],
    "gaming-impact": [text("headline", "Título", "text"), shape("glow", "Brillo"), shape("panel", "Panel")],
    "corporate-clean": [text("eyebrow", "Antetítulo", "secondaryText"), text("headline", "Título", "text"), shape("underline", "Subrayado")],
}

for template in catalog["templates"]:
    key = template["legacyPresetId"]
    template["layers"] = layouts[key]
    if key == "tutorial-step" and not any(item["id"] == "descriptionText" for item in template.get("parameters", [])):
        template.setdefault("parameters", []).append({"id":"descriptionText","label":"Descripción","type":"multilineText","default":"","group":"Contenido"})

path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
