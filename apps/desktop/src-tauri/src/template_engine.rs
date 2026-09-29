use crate::project_storage::TitleDecision;
use serde_json::Value;
use std::sync::OnceLock;

pub(crate) const RENDERER_VERSION: &str = "13e.1";
const CATALOG: &str = include_str!("../../src/templates/builtin-manifests.json");
static PARSED: OnceLock<Value> = OnceLock::new();

fn catalog() -> &'static Value {
    PARSED.get_or_init(|| {
        serde_json::from_str(CATALOG).expect("bundled template catalog must be valid JSON")
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Layout {
    pub x: f64,
    pub y: f64,
    pub font_scale: f64,
    pub max_width: f64,
    pub safe_area: f64,
}

fn variant(width: u32, height: u32) -> &'static str {
    let ratio = width as f64 / height.max(1) as f64;
    if ratio < 0.8 {
        "portrait"
    } else if ratio < 1.15 {
        "square"
    } else if ratio < 1.55 {
        "classic"
    } else if ratio >= 2.15 {
        "ultrawide"
    } else {
        "landscape"
    }
}

pub(crate) fn resolve_manifest(title: &TitleDecision) -> Result<Option<&Value>, String> {
    let Some(id) = title.template_id.as_deref() else {
        return Ok(None);
    };
    let version = title
        .template_version
        .as_deref()
        .ok_or_else(|| format!("TEMPLATE_VERSION_MISSING {id}"))?;
    let exact = catalog()["templates"].as_array().and_then(|items| {
        items
            .iter()
            .find(|item| item["templateId"] == id && item["templateVersion"] == version)
    });
    if let Some(manifest) = exact {
        return Ok(Some(manifest));
    }
    if let Some(snapshot) = title.template_snapshot.as_ref().filter(|item| {
        item["templateId"] == id
            && item["templateVersion"] == version
            && item["recipe"].is_array()
            && item["responsiveVariants"].is_object()
    }) {
        return Ok(Some(snapshot));
    }
    Err(format!("TEMPLATE_VERSION_MISSING {id}@{version}"))
}

fn parameter_number(title: &TitleDecision, id: &str) -> Option<f64> {
    title
        .parameters
        .as_ref()?
        .get(id)?
        .as_f64()
        .filter(|value| value.is_finite())
}

pub(crate) fn layer_override<'a>(
    title: &'a TitleDecision,
    parameter_id: &str,
) -> Option<&'a Value> {
    let manifest = resolve_manifest(title).ok().flatten()?;
    let id = manifest["layers"]
        .as_array()?
        .iter()
        .find(|layer| layer["parameterId"] == parameter_id)?["layerId"]
        .as_str()?;
    title.layer_overrides.as_ref()?.get(id)
}

fn override_number(value: &Value, key: &str) -> Option<f64> {
    value[key].as_f64().filter(|number| number.is_finite())
}

pub(crate) fn effective_title(title: &TitleDecision) -> TitleDecision {
    let mut resolved = title.clone();
    let empty = serde_json::Map::new();
    let parameters = title.parameters.as_ref().unwrap_or(&empty);
    let string = |key: &str| parameters.get(key).and_then(Value::as_str);
    if let Some(text) = string("text") {
        resolved.text = text.chars().take(140).collect();
    }
    if let Some(text) = string("secondaryText") {
        resolved.secondary_text = text.chars().take(140).collect();
    }
    for (key, target) in [
        ("color", &mut resolved.color),
        ("accentColor", &mut resolved.accent_color),
    ] {
        if let Some(value) = string(key).filter(|value| {
            value.len() == 7
                && value.starts_with('#')
                && value[1..].chars().all(|c| c.is_ascii_hexdigit())
        }) {
            *target = value.to_uppercase();
        }
    }
    if let Some(value) =
        string("font").filter(|value| *value == "Inter" || *value == "Instrument Serif")
    {
        resolved.font = value.into();
    }
    if let Some(value) =
        string("alignment").filter(|value| ["left", "center", "right"].contains(value))
    {
        resolved.alignment = value.into();
    }
    if let Some(value) = parameter_number(title, "fontSize") {
        resolved.font_size = value.clamp(18.0, 160.0);
    }
    if let Some(value) = parameter_number(title, "scale") {
        resolved.scale = value.clamp(0.5, 2.5);
    }
    if let Some(value) = parameter_number(title, "fontWeight") {
        resolved.font_weight = value.clamp(400.0, 900.0) as u32;
    }
    if let Some(value) = parameter_number(title, "positionX") {
        resolved.position_x = value.clamp(0.0, 1.0);
    }
    if let Some(value) = parameter_number(title, "positionY") {
        resolved.position_y = value.clamp(0.0, 1.0);
    }
    if let Some(style) = layer_override(title, "text") {
        if let Some(text) = style["text"].as_str() {
            resolved.text = text.chars().take(1000).collect();
        }
        if let Some(font) = style["font"]
            .as_str()
            .filter(|font| ["Inter", "Instrument Serif"].contains(font))
        {
            resolved.font = font.into();
        }
        if let Some(size) = override_number(style, "fontSize") {
            resolved.font_size = size.clamp(8.0, 240.0);
        }
        if let Some(weight) = override_number(style, "fontWeight") {
            resolved.font_weight = weight.clamp(300.0, 900.0) as u32;
        }
        if let Some(fill) = style["fill"].as_str().filter(|color| {
            color.len() == 7
                && color.starts_with('#')
                && color[1..].chars().all(|c| c.is_ascii_hexdigit())
        }) {
            resolved.color = fill.to_uppercase();
        }
        if let Some(align) = style["alignment"]
            .as_str()
            .filter(|align| ["left", "center", "right"].contains(align))
        {
            resolved.alignment = align.into();
        }
        if let Some(opacity) = override_number(style, "opacity") {
            resolved.opacity *= opacity.clamp(0.0, 1.0);
        }
        if let Some(spacing) = override_number(style, "letterSpacing") {
            resolved.tracking = spacing.clamp(-10.0, 40.0);
        }
        if let Some(height) = override_number(style, "lineHeight") {
            resolved.line_height = height.clamp(0.5, 3.0);
        }
        if let Some(case) = style["case"].as_str() {
            resolved.text = match case {
                "upper" => resolved.text.to_uppercase(),
                "lower" => resolved.text.to_lowercase(),
                "title" => resolved
                    .text
                    .split_whitespace()
                    .map(|word| {
                        let mut chars = word.chars();
                        chars
                            .next()
                            .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                            .unwrap_or_default()
                    })
                    .collect::<Vec<_>>()
                    .join(" "),
                _ => resolved.text,
            };
        }
    }
    if let Some(style) = layer_override(title, "secondaryText") {
        if let Some(text) = style["text"].as_str() {
            resolved.secondary_text = text.chars().take(1000).collect();
        }
        if let Some(fill) = style["fill"].as_str().filter(|color| {
            color.len() == 7
                && color.starts_with('#')
                && color[1..].chars().all(|c| c.is_ascii_hexdigit())
        }) {
            resolved.accent_color = fill.to_uppercase();
        }
    }
    resolved
}

pub(crate) fn layout(
    title: &TitleDecision,
    width: u32,
    height: u32,
) -> Result<Option<Layout>, String> {
    let Some(manifest) = resolve_manifest(title)? else {
        return Ok(None);
    };
    let key = variant(width, height);
    let responsive = &manifest["responsiveVariants"][key];
    let global_safe = catalog()["safeArea"][key].as_f64().unwrap_or(0.06);
    let safe = manifest["safeArea"][key]
        .as_f64()
        .unwrap_or(global_safe)
        .clamp(0.02, 0.2);
    let primary_layout =
        layer_override(title, "text").and_then(|style| style["layoutOverrides"][key].as_object());
    let global_layout = title
        .layout_overrides
        .as_ref()
        .and_then(|layouts| layouts.get(key));
    let x = primary_layout
        .and_then(|layout| layout.get("x"))
        .and_then(Value::as_f64)
        .or_else(|| global_layout.and_then(|layout| layout["x"].as_f64()))
        .or_else(|| parameter_number(title, "positionX"))
        .or_else(|| responsive["positionX"].as_f64())
        .unwrap_or(title.position_x)
        .clamp(safe, 1.0 - safe);
    let y = primary_layout
        .and_then(|layout| layout.get("y"))
        .and_then(Value::as_f64)
        .or_else(|| global_layout.and_then(|layout| layout["y"].as_f64()))
        .or_else(|| parameter_number(title, "positionY"))
        .or_else(|| responsive["positionY"].as_f64())
        .unwrap_or(title.position_y)
        .clamp(safe, 1.0 - safe);
    Ok(Some(Layout {
        x,
        y,
        font_scale: (responsive["fontScale"].as_f64().unwrap_or(1.0)
            * primary_layout
                .and_then(|layout| layout.get("scale"))
                .and_then(Value::as_f64)
                .or_else(|| global_layout.and_then(|layout| layout["scale"].as_f64()))
                .unwrap_or(1.0)
                .clamp(0.25, 4.0))
        .clamp(0.1, 3.0),
        max_width: primary_layout
            .and_then(|layout| layout.get("maxWidth"))
            .and_then(Value::as_f64)
            .or_else(|| global_layout.and_then(|layout| layout["maxWidth"].as_f64()))
            .or_else(|| responsive["maxWidth"].as_f64())
            .unwrap_or(0.82)
            .clamp(0.1, 1.0),
        safe_area: safe,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn title(preset: &str) -> TitleDecision {
        let mut value: Value = serde_json::from_str(r##"{"id":"fixture","presetId":"future-glow","text":"José en Perú","secondaryText":"PRUEBA","startUs":0,"endUs":4000000,"positionX":0.5,"positionY":0.5,"anchor":"center","scale":1,"font":"Inter","fontWeight":700,"fontSize":72,"color":"#FFFFFF","accentColor":"#34D5E5","alignment":"center","tracking":0,"lineHeight":1.15,"opacity":1,"safeArea":0.06,"animationInUs":500000,"animationOutUs":350000,"easing":"ease-out","background":false}"##).unwrap();
        value["presetId"] = preset.into();
        value["templateId"] = format!("cheto.{preset}").into();
        value["templateVersion"] = "1.0.0".into();
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn bundled_catalog_has_unique_valid_identities() {
        let items = catalog()["templates"].as_array().unwrap();
        assert_eq!(items.len(), 18);
        let mut keys = std::collections::HashSet::new();
        for item in items {
            let id = item["templateId"].as_str().unwrap();
            let version = item["templateVersion"].as_str().unwrap();
            assert!(id.starts_with("cheto."));
            assert!(keys.insert(format!("{id}@{version}")));
            assert!(item["recipe"].as_array().is_some());
        }
        assert_eq!(catalog()["rendererVersion"], RENDERER_VERSION);
    }
    #[test]
    fn layer_overrides_survive_deserialization_and_drive_export_layout() {
        let mut value = serde_json::to_value(title("future-glow")).unwrap();
        value["layerOverrides"] = serde_json::json!({"headline":{"text":"EDITADO","fontSize":96,"fill":"#FFAA33","layoutOverrides":{"landscape":{"x":0.31,"y":0.62,"scale":1.4},"portrait":{"x":0.46,"y":0.72}}}});
        let instance: TitleDecision = serde_json::from_value(value).unwrap();
        let effective = effective_title(&instance);
        assert_eq!(effective.text, "EDITADO");
        assert_eq!(effective.font_size, 96.0);
        assert_eq!(effective.color, "#FFAA33");
        let landscape = layout(&instance, 1920, 1080).unwrap().unwrap();
        let portrait = layout(&instance, 1080, 1920).unwrap().unwrap();
        assert!((landscape.x - 0.31).abs() < 0.001);
        assert!((landscape.y - 0.62).abs() < 0.001);
        assert!((portrait.x - 0.46).abs() < 0.001);
        assert!((portrait.y - 0.72).abs() < 0.001);
    }
    #[test]
    fn layout_variants_cover_export_ratios() {
        assert_eq!(variant(1920, 1080), "landscape");
        assert_eq!(variant(1080, 1920), "portrait");
        assert_eq!(variant(1080, 1080), "square");
        assert_eq!(variant(1440, 1080), "classic");
        assert_eq!(variant(2560, 1080), "ultrawide");
    }
    #[test]
    fn six_families_resolve_three_canvas_ratios() {
        for preset in [
            "editorial-master",
            "future-glow",
            "lower-third-premium",
            "stat-hero",
            "tutorial-step",
            "corporate-clean",
        ] {
            let instance = title(preset);
            for (width, height) in [(1920, 1080), (1080, 1920), (1080, 1080)] {
                let state = layout(&instance, width, height).unwrap().unwrap();
                assert!(
                    state.x >= state.safe_area && state.x <= 1.0 - state.safe_area,
                    "{preset}"
                );
                assert!(
                    state.y >= state.safe_area && state.y <= 1.0 - state.safe_area,
                    "{preset}"
                );
                assert!(state.font_scale > 0.0, "{preset}");
            }
        }
        let portrait = layout(&title("lower-third-premium"), 1080, 1920)
            .unwrap()
            .unwrap();
        assert_eq!(portrait.x, 0.14);
        assert_eq!(portrait.y, 0.79);
    }
    #[test]
    fn missing_version_is_controlled_and_snapshot_is_exact() {
        let mut instance = title("future-glow");
        instance.template_version = Some("9.0.0".into());
        assert!(resolve_manifest(&instance)
            .unwrap_err()
            .contains("TEMPLATE_VERSION_MISSING"));
        instance.template_snapshot =
            Some(serde_json::json!({"templateId":"cheto.future-glow","templateVersion":"9.0.0"}));
        assert!(resolve_manifest(&instance)
            .unwrap_err()
            .contains("TEMPLATE_VERSION_MISSING"));
        let mut snapshot = catalog()["templates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["templateId"] == "cheto.future-glow")
            .unwrap()
            .clone();
        snapshot["templateVersion"] = "9.0.0".into();
        instance.template_snapshot = Some(snapshot);
        assert_eq!(
            resolve_manifest(&instance).unwrap().unwrap()["templateVersion"],
            "9.0.0"
        );
    }
    #[test]
    fn parameter_overrides_are_applied_to_export_title() {
        let mut instance = title("future-glow");
        instance.parameters = Some(serde_json::from_value(serde_json::json!({"text":"Niñez en Perú","fontSize":-20,"accentColor":"#AA44EE","positionY":0.75,"glowIntensity":0.9})).unwrap());
        let effective = effective_title(&instance);
        assert_eq!(effective.text, "Niñez en Perú");
        assert_eq!(effective.font_size, 18.0);
        assert_eq!(effective.accent_color, "#AA44EE");
        assert_eq!(layout(&effective, 1080, 1920).unwrap().unwrap().y, 0.75);
    }
}
