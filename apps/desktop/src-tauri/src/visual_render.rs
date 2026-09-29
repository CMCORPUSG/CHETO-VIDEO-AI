use crate::{asset_mix::edited_time, project_storage::EdlManifest, template_engine};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::PathBuf,
};

const INTER: &[u8] = include_bytes!("../resources/visual-13d/fonts/Inter.ttf");
const INTER_WEIGHTS: [(u16, &[u8]); 6] = [
    (
        400,
        include_bytes!("../resources/visual-13d/fonts/Inter-400.ttf"),
    ),
    (
        500,
        include_bytes!("../resources/visual-13d/fonts/Inter-500.ttf"),
    ),
    (
        600,
        include_bytes!("../resources/visual-13d/fonts/Inter-600.ttf"),
    ),
    (
        700,
        include_bytes!("../resources/visual-13d/fonts/Inter-700.ttf"),
    ),
    (
        800,
        include_bytes!("../resources/visual-13d/fonts/Inter-800.ttf"),
    ),
    (
        900,
        include_bytes!("../resources/visual-13d/fonts/Inter-900.ttf"),
    ),
];
const INSTRUMENT_SERIF: &[u8] =
    include_bytes!("../resources/visual-13d/fonts/InstrumentSerif-Italic.ttf");

pub(crate) fn prepare_assets(edl: &EdlManifest) -> Result<Option<PathBuf>, String> {
    if edl.tracks.titles.is_empty() {
        return Ok(None);
    }
    let dir = std::env::temp_dir().join("cheto-visual-13d");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let font = dir.join("Inter.ttf");
    if !font.is_file() || fs::metadata(&font).map(|v| v.len()).unwrap_or(0) != INTER.len() as u64 {
        let temp = dir.join("Inter.pending.ttf");
        fs::write(&temp, INTER).map_err(|error| error.to_string())?;
        fs::rename(&temp, &font).map_err(|error| error.to_string())?;
    }
    for (weight, bytes) in INTER_WEIGHTS {
        let path = dir.join(format!("Inter-{weight}.ttf"));
        if fs::metadata(&path).map(|v| v.len()).unwrap_or(0) != bytes.len() as u64 {
            fs::write(path, bytes).map_err(|error| error.to_string())?;
        }
    }
    let serif = dir.join("InstrumentSerif-Italic.ttf");
    if !serif.is_file()
        || fs::metadata(&serif).map(|v| v.len()).unwrap_or(0) != INSTRUMENT_SERIF.len() as u64
    {
        fs::write(&serif, INSTRUMENT_SERIF).map_err(|error| error.to_string())?;
    }
    for original in &edl.tracks.titles {
        let effective = template_engine::effective_title(original);
        let title = &effective;
        template_engine::resolve_manifest(title)?;
        for (suffix, contents) in [("main", &title.text), ("secondary", &title.secondary_text)] {
            let name = text_name(&title.id, suffix, contents);
            fs::write(dir.join(name), contents).map_err(|error| error.to_string())?;
        }
        if matches!(
            title.preset_id.as_str(),
            "typewriter-tech" | "letter-cascade-pro"
        ) {
            for (index, ch) in title.text.chars().take(24).enumerate() {
                let contents = ch.to_string();
                fs::write(
                    dir.join(text_name(&title.id, &format!("char-{index}"), &contents)),
                    contents,
                )
                .map_err(|error| error.to_string())?;
            }
        }
        if title.preset_id == "word-highlight" {
            for (index, word) in title.text.split_whitespace().take(10).enumerate() {
                fs::write(
                    dir.join(text_name(&title.id, &format!("word-{index}"), word)),
                    word,
                )
                .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(Some(dir))
}

fn text_name(id: &str, suffix: &str, contents: &str) -> String {
    let safe = id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-')
        .take(64)
        .collect::<String>();
    let mut hasher = DefaultHasher::new();
    contents.hash(&mut hasher);
    format!("title-{safe}-{suffix}-{:016x}.txt", hasher.finish())
}

fn seconds(us: u64) -> String {
    format!("{:.6}", us as f64 / 1_000_000.0)
}

fn hex_color(value: &str) -> &str {
    let color = value.strip_prefix('#').unwrap_or(value);
    if color.len() == 6 && color.bytes().all(|b| b.is_ascii_hexdigit()) {
        color
    } else {
        "FFFFFF"
    }
}

pub(crate) fn filters(edl: &EdlManifest, width: u32, height: u32) -> Vec<String> {
    let mut output = Vec::new();
    for original in &edl.tracks.titles {
        let effective = template_engine::effective_title(original);
        let title = &effective;
        if title.text.trim().is_empty() || title.end_us <= title.start_us {
            continue;
        }
        let start = edited_time(edl, title.start_us);
        let end = edited_time(edl, title.end_us);
        if end <= start {
            continue;
        }
        let preset_scale = match title.preset_id.as_str() {
            "whisper-fade" => 0.68,
            "zoom-out-stat" => 1.3,
            "rise-settle" => 1.08,
            "editorial-master" => 1.42,
            "future-glow" => 1.78,
            "content-create" => 1.48,
            "neon-statement" => 1.64,
            "kinetic-pop" => 1.56,
            "letter-cascade-pro" => 1.32,
            "dynamic-slide" => 1.44,
            "word-highlight" => 1.36,
            "split-impact" => 1.52,
            "stacked-reveal-pro" => 1.38,
            "underline-editorial" => 1.42,
            "stat-hero" => 1.38,
            "lower-third-premium" => 1.16,
            "tutorial-step" => 1.28,
            "quote-editorial" => 0.92,
            "gaming-impact" => 1.76,
            "corporate-clean" => 0.82,
            _ => 1.0,
        };
        let count = title.text.chars().count().max(1) as f64;
        let template_layout = template_engine::layout(title, width, height).ok().flatten();
        let glow_intensity = title
            .parameters
            .as_ref()
            .and_then(|values| values.get("glowIntensity"))
            .and_then(|value| value.as_f64())
            .filter(|value| value.is_finite())
            .unwrap_or(0.5)
            .clamp(0.0, 1.0);
        let responsive_limit = width as f64
            * template_layout
                .map(|layout| layout.max_width)
                .unwrap_or(0.88)
            / (count * 0.55);
        let size = (title.font_size
            * title.scale
            * preset_scale
            * template_layout
                .map(|layout| layout.font_scale)
                .unwrap_or(1.0)
            * height as f64
            / 1080.0)
            .min(responsive_limit)
            .clamp(8.0, 320.0)
            .round();
        let vertical = width as f64 / (height as f64) < 0.8;
        let safe_area = if let Some(layout) = template_layout {
            layout.safe_area
        } else if title.safe_area.is_finite() {
            title.safe_area.clamp(0.02, 0.2)
        } else {
            0.06
        };
        let x_margin = safe_area.max(if vertical { 0.10 } else { 0.06 });
        let y_margin = safe_area.max(if vertical { 0.14 } else { 0.06 });
        let x = template_layout
            .map(|layout| layout.x)
            .unwrap_or(title.position_x)
            .clamp(x_margin, 1.0 - x_margin);
        let y = template_layout
            .map(|layout| layout.y)
            .unwrap_or(title.position_y)
            .clamp(y_margin, 1.0 - y_margin);
        let mut x_expr = match title.anchor.as_str() {
            "left" => format!("w*{x:.3}"),
            "right" => format!("w*{x:.3}-text_w"),
            _ => format!("w*{x:.3}-text_w/2"),
        };
        let y_expr = if title.preset_id == "rise-settle"
            || title.preset_id == "stack-reveal"
            || title.preset_id == "mask-wipe-up"
            || matches!(
                title.preset_id.as_str(),
                "editorial-master" | "content-create" | "stacked-reveal-pro" | "corporate-clean"
            ) {
            format!(
                "h*{y:.3}-text_h/2+24*max(0\\,1-(t-{})/{})",
                seconds(start),
                seconds(title.animation_in_us.max(1))
            )
        } else {
            format!("h*{y:.3}-text_h/2")
        };
        if matches!(
            title.preset_id.as_str(),
            "dynamic-slide" | "split-impact" | "lower-third-premium" | "tutorial-step"
        ) {
            let offset = if title.preset_id == "split-impact" {
                0.22
            } else {
                -0.18
            };
            x_expr = format!(
                "({x_expr})+w*{offset}*max(0\\,1-(t-{})/{})",
                seconds(start),
                seconds(title.animation_in_us.max(1))
            );
        }
        let opacity = title.opacity.clamp(0.0, 1.0);
        let alpha = format!(
            "{opacity:.3}*min(1\\,max(0\\,(t-{})/{}))*min(1\\,max(0\\,({}-t)/{}))",
            seconds(start),
            seconds(title.animation_in_us.max(1)),
            seconds(end),
            seconds(title.animation_out_us.max(1))
        );
        let enable = format!(
            "between(t\\,{start_s}\\,{end_s})",
            start_s = seconds(start),
            end_s = seconds(end)
        );
        let px = (width as f64 * x).round() as i64;
        let py = (height as f64 * y).round() as i64;
        let accent = hex_color(&title.accent_color);
        let main_style = template_engine::layer_override(title, "text");
        let secondary_style = template_engine::layer_override(title, "secondaryText");
        let ratio = width as f64 / height.max(1) as f64;
        let aspect_key = if ratio < 0.8 {
            "portrait"
        } else if ratio < 1.15 {
            "square"
        } else if ratio < 1.55 {
            "classic"
        } else if ratio >= 2.15 {
            "ultrawide"
        } else {
            "landscape"
        };
        let box_filter = |bx: i64, by: i64, bw: i64, bh: i64, color: &str, thickness: &str| {
            format!(
                "drawbox=x={bx}:y={by}:w={bw}:h={bh}:color={color}:t={thickness}:enable='{enable}'"
            )
        };
        match title.preset_id.as_str() {
            "lower-third" => {
                output.push(box_filter(
                    px - 10,
                    py - size as i64,
                    (width as f64 * 0.52) as i64,
                    (size * 2.2) as i64,
                    "black@0.72",
                    "fill",
                ));
                output.push(box_filter(
                    px - 10,
                    py - size as i64,
                    (size * 0.10).max(4.0) as i64,
                    (size * 2.2) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
            }
            "callout" => {
                output.push(box_filter(
                    px - (size * 4.0) as i64,
                    py - size as i64,
                    (size * 8.0) as i64,
                    (size * 2.3) as i64,
                    "black@0.78",
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 4.0) as i64,
                    py - size as i64,
                    (size * 8.0) as i64,
                    (size * 2.3) as i64,
                    &format!("0x{accent}"),
                    "3",
                ));
            }
            "stack-reveal" => {
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py - size as i64,
                    (size * 7.0) as i64,
                    (size * 1.2) as i64,
                    &format!("0x{accent}@0.72"),
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py + (size * 0.25) as i64,
                    (size * 7.0) as i64,
                    (size * 0.85) as i64,
                    "black@0.76",
                    "fill",
                ));
            }
            "underline-sweep" => {
                let line_x = px - (size * 2.5) as i64;
                let segment = (size * 1.25).max(3.0) as i64;
                for part in 0..4 {
                    let at = start + title.animation_in_us.saturating_mul(part) / 4;
                    output.push(format!("drawbox=x={}:y={}:w={segment}:h={}:color=0x{accent}:t=fill:enable='between(t\\,{}\\,{})'", line_x + segment * part as i64, py + (size * 0.65) as i64, (size * 0.06).max(3.0) as i64, seconds(at), seconds(end)));
                }
            }
            "split-line" => {
                output.push(box_filter(
                    px - (size * 2.5) as i64,
                    py + (size * 0.65) as i64,
                    (size * 5.0) as i64,
                    (size * 0.06).max(3.0) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
            }
            "zoom-out-stat" => {
                output.push(box_filter(
                    px - (size * 2.0) as i64,
                    py + (size * 0.65) as i64,
                    (size * 4.0) as i64,
                    (size * 0.06).max(3.0) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
            }
            "editorial-master" => {
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py - (size * 1.2) as i64,
                    (size * 0.06).max(3.0) as i64,
                    (size * 2.2) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 3.25) as i64,
                    py + (size * 0.52) as i64,
                    (size * 4.8) as i64,
                    3,
                    &format!("0x{accent}@0.7"),
                    "fill",
                ));
            }
            "future-glow" => {
                output.push(box_filter(
                    px - (size * 3.0) as i64,
                    py + (size * 0.76) as i64,
                    (size * 6.0) as i64,
                    3,
                    &format!("0x{accent}@0.7"),
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 2.0) as i64,
                    py - (size * 0.9) as i64,
                    (size * 4.0) as i64,
                    (size * 2.0) as i64,
                    &format!("0x{accent}@{:.3}", 0.16 * glow_intensity),
                    "fill",
                ));
            }
            "content-create" => {
                output.push(box_filter(
                    px - (size * 3.4) as i64,
                    py - (size * 1.2) as i64,
                    (size * 6.8) as i64,
                    (size * 0.62) as i64,
                    &format!("0x{accent}@0.86"),
                    "fill",
                ));
            }
            "neon-statement" => {
                output.push(box_filter(
                    px - (size * 3.3) as i64,
                    py - (size * 0.95) as i64,
                    (size * 6.6) as i64,
                    (size * 2.0) as i64,
                    &format!("0x{accent}@0.4"),
                    "3",
                ));
            }
            "kinetic-pop" => {
                output.push(box_filter(
                    px - (size * 3.1) as i64,
                    py - (size * 0.8) as i64,
                    (size * 6.2) as i64,
                    (size * 1.65) as i64,
                    "0xFF5A86@0.82",
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 3.25) as i64,
                    py - (size * 0.95) as i64,
                    (size * 6.2) as i64,
                    (size * 1.65) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
            }
            "letter-cascade-pro" => {
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py + (size * 0.75) as i64,
                    (size * 7.0) as i64,
                    2,
                    &format!("0x{accent}@0.7"),
                    "fill",
                ));
            }
            "dynamic-slide" => {
                output.push(box_filter(
                    px - (size * 3.7) as i64,
                    py - (size * 0.95) as i64,
                    (size * 0.14) as i64,
                    (size * 2.0) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py + (size * 0.82) as i64,
                    (size * 6.5) as i64,
                    3,
                    &format!("0x{accent}@0.5"),
                    "fill",
                ));
            }
            "typewriter-tech" => {
                output.push(box_filter(
                    px - (size * 3.6) as i64,
                    py - (size * 0.9) as i64,
                    (size * 7.2) as i64,
                    (size * 1.8) as i64,
                    "0x071B17@0.85",
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 3.6) as i64,
                    py - (size * 0.9) as i64,
                    (size * 7.2) as i64,
                    (size * 1.8) as i64,
                    &format!("0x{accent}@0.6"),
                    "2",
                ));
            }
            "word-highlight" => {
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py - (size * 0.82) as i64,
                    (size * 7.0) as i64,
                    (size * 1.65) as i64,
                    "0x101B25@0.62",
                    "fill",
                ));
            }
            "split-impact" => {
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py - (size * 0.88) as i64,
                    (size * 7.0) as i64,
                    (size * 0.88) as i64,
                    &format!("0x{accent}@0.82"),
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py + (size * 0.02) as i64,
                    (size * 7.0) as i64,
                    (size * 0.88) as i64,
                    "0xF4F6F5@0.93",
                    "fill",
                ));
            }
            "stacked-reveal-pro" => {
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py - (size * 1.1) as i64,
                    (size * 2.5) as i64,
                    (size * 0.35) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py + (size * 0.76) as i64,
                    (size * 7.0) as i64,
                    2,
                    &format!("0x{accent}@0.55"),
                    "fill",
                ));
            }
            "underline-editorial" => {
                let segment = (size * 0.85).max(3.0) as i64;
                for part in 0..6 {
                    let at = start + title.animation_in_us.saturating_mul(part) / 6;
                    output.push(format!("drawbox=x={}:y={}:w={segment}:h={}:color=0x{accent}:t=fill:enable='between(t\\,{}\\,{})'",px-(size*2.6) as i64+segment*part as i64,py+(size*0.62) as i64,(size*0.055).max(3.0) as i64,seconds(at),seconds(end)));
                }
            }
            "lower-third-premium" => {
                output.push(box_filter(
                    px - 8,
                    py - size as i64,
                    (width as f64 * 0.63) as i64,
                    (size * 2.25) as i64,
                    "0x091522@0.76",
                    "fill",
                ));
                output.push(box_filter(
                    px - 8,
                    py - size as i64,
                    (size * 0.09).max(4.0) as i64,
                    (size * 2.25) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
                output.push(box_filter(
                    px - 8,
                    py + (size * 1.05) as i64,
                    (width as f64 * 0.63) as i64,
                    2,
                    &format!("0x{accent}@0.55"),
                    "fill",
                ));
            }
            "stat-hero" => {
                output.push(box_filter(
                    px - (size * 2.4) as i64,
                    py + (size * 0.8) as i64,
                    (size * 4.8) as i64,
                    (size * 0.10).max(4.0) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 2.4) as i64,
                    py - (size * 0.95) as i64,
                    (size * 4.8) as i64,
                    (size * 2.0) as i64,
                    &format!("0x{accent}@0.12"),
                    "fill",
                ));
            }
            "tutorial-step" => {
                output.push(box_filter(
                    px - 6,
                    py - (size * 1.18) as i64,
                    (size * 2.1) as i64,
                    (size * 0.50) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
                output.push(box_filter(
                    px - 6,
                    py + (size * 0.75) as i64,
                    (size * 6.1) as i64,
                    3,
                    &format!("0x{accent}@0.72"),
                    "fill",
                ));
            }
            "quote-editorial" => {
                output.push(box_filter(
                    px - (size * 3.4) as i64,
                    py - (size * 1.1) as i64,
                    3,
                    (size * 2.3) as i64,
                    &format!("0x{accent}"),
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 3.2) as i64,
                    py + (size * 0.86) as i64,
                    (size * 6.5) as i64,
                    2,
                    &format!("0x{accent}@0.6"),
                    "fill",
                ));
            }
            "gaming-impact" => {
                output.push(box_filter(
                    px - (size * 3.5) as i64,
                    py - (size * 0.95) as i64,
                    (size * 7.0) as i64,
                    (size * 1.9) as i64,
                    "0x9E2F20@0.63",
                    "fill",
                ));
                output.push(box_filter(
                    px - (size * 3.65) as i64,
                    py - (size * 1.09) as i64,
                    (size * 7.0) as i64,
                    (size * 1.9) as i64,
                    &format!("0x{accent}@0.45"),
                    "3",
                ));
            }
            "corporate-clean" => {
                let panel_width = ((count * 0.62 + 1.4) * size).round() as i64;
                let panel_x = px - panel_width / 2;
                output.push(box_filter(
                    panel_x,
                    py - (size * 1.0) as i64,
                    panel_width,
                    (size * 2.0) as i64,
                    "0xE8F1F2@0.92",
                    "fill",
                ));
                output.push(box_filter(
                    panel_x,
                    py + (size * 0.80) as i64,
                    panel_width,
                    2,
                    &format!("0x{accent}"),
                    "fill",
                ));
            }
            _ => {}
        }
        let pack_font = title
            .font
            .strip_prefix("pack-font-")
            .and_then(|value| {
                value
                    .strip_suffix(".ttf")
                    .or_else(|| value.strip_suffix(".otf"))
            })
            .is_some_and(|digest| {
                digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            });
        let main_font = if pack_font {
            title.font.as_str()
        } else if title.font == "Instrument Serif" {
            "InstrumentSerif-Italic.ttf"
        } else {
            match title.font_weight {
                400..=449 => "Inter-400.ttf",
                450..=549 => "Inter-500.ttf",
                550..=649 => "Inter-600.ttf",
                650..=749 => "Inter-700.ttf",
                750..=849 => "Inter-800.ttf",
                _ => "Inter-900.ttf",
            }
        };
        let main_color = match title.preset_id.as_str() {
            "kinetic-pop" | "split-impact" | "corporate-clean" => "13232B",
            "typewriter-tech" => accent,
            _ => hex_color(&title.color),
        };
        let mut effects = match title.preset_id.as_str() {
            "neon-statement" => format!(":borderw=2:bordercolor=0x{accent}@0.8:shadowcolor=0x{accent}@0.6:shadowx=3:shadowy=3"),
            "future-glow" => format!(":borderw=2:bordercolor=0x{accent}@0.8:shadowcolor=0x{accent}@{:.3}:shadowx=3:shadowy=3", 0.9 * glow_intensity + 0.15),
            "gaming-impact" => ":borderw=2:bordercolor=0x8E2D1A:shadowcolor=0xE85C2C:shadowx=4:shadowy=4".into(),
            _ => ":shadowcolor=black@0.55:shadowx=2:shadowy=2".into(),
        };
        if let Some(style) = main_style {
            if let Some(border) = style["strokeWidth"]
                .as_f64()
                .filter(|value| value.is_finite() && *value > 0.0)
            {
                effects.push_str(&format!(
                    ":borderw={:.1}:bordercolor=0x{}",
                    border.clamp(0.0, 12.0),
                    hex_color(style["strokeColor"].as_str().unwrap_or("#000000"))
                ));
            }
            if let (Some(sx), Some(sy)) = (
                style["shadowOffsetX"].as_f64(),
                style["shadowOffsetY"].as_f64(),
            ) {
                effects.push_str(&format!(
                    ":shadowcolor=0x{}:shadowx={:.0}:shadowy={:.0}",
                    hex_color(style["shadowColor"].as_str().unwrap_or("#000000")),
                    sx.clamp(-100.0, 100.0),
                    sy.clamp(-100.0, 100.0)
                ));
            }
        }
        let text_filter = |contents: &str,
                           suffix: &str,
                           size: f64,
                           color: &str,
                           x: &str,
                           y: &str,
                           alpha: &str,
                           enable: &str,
                           font: &str,
                           extra: &str| {
            format!("drawtext=fontfile={font}:expansion=none:textfile={}:fontsize={size:.0}:fontcolor=0x{color}:x='{x}':y='{y}':alpha='{alpha}':enable='{enable}'{extra}", text_name(&title.id,suffix,contents))
        };
        if matches!(
            title.preset_id.as_str(),
            "typewriter-tech" | "letter-cascade-pro"
        ) && title.text.chars().count() <= 24
        {
            let count = title.text.chars().count().max(1);
            let base_x = px as f64 - (count as f64 * size * 0.31);
            for (index, ch) in title.text.chars().enumerate() {
                let contents = ch.to_string();
                let at = start + title.animation_in_us.saturating_mul(index as u64) / count as u64;
                let char_enable = format!("between(t\\,{}\\,{})", seconds(at), seconds(end));
                let char_x = format!("{:.2}", base_x + index as f64 * size * 0.62);
                let char_y = if title.preset_id == "letter-cascade-pro" {
                    format!(
                        "{y_expr}+{}*max(0\\,1-(t-{})/0.24)",
                        (size * 0.48).round(),
                        seconds(at)
                    )
                } else {
                    y_expr.clone()
                };
                output.push(text_filter(
                    &contents,
                    &format!("char-{index}"),
                    size,
                    main_color,
                    &char_x,
                    &char_y,
                    &alpha,
                    &char_enable,
                    main_font,
                    &effects,
                ));
            }
        } else if title.preset_id == "word-highlight" && title.text.split_whitespace().count() <= 10
        {
            let words: Vec<_> = title.text.split_whitespace().collect();
            let total_width = words
                .iter()
                .map(|word| word.chars().count() as f64 * size * 0.58 + size * 0.26)
                .sum::<f64>();
            let mut current_x = px as f64 - total_width / 2.0;
            for (index, word) in words.iter().enumerate() {
                let at = start
                    + title.animation_in_us.saturating_mul(index as u64)
                        / words.len().max(1) as u64;
                let segment_width = word.chars().count() as f64 * size * 0.58;
                output.push(format!("drawbox=x={}:y={}:w={}:h={}:color=0x{accent}@0.88:t=fill:enable='between(t\\,{}\\,{})'",current_x.round() as i64,py-(size*0.54) as i64,segment_width.round().max(2.0) as i64,(size*1.13).round() as i64,seconds(at),seconds(end)));
                output.push(text_filter(
                    word,
                    &format!("word-{index}"),
                    size,
                    "12202A",
                    &format!("{}", current_x.round() as i64),
                    &y_expr,
                    &alpha,
                    &format!("between(t\\,{}\\,{})", seconds(at), seconds(end)),
                    main_font,
                    "",
                ));
                current_x += segment_width + size * 0.26;
            }
        } else {
            if title.preset_id == "future-glow" {
                output.push(text_filter(
                    &title.text,
                    "main",
                    size * 1.06,
                    accent,
                    &x_expr,
                    &y_expr,
                    &format!("{:.3}", 0.36 * glow_intensity),
                    &enable,
                    main_font,
                    ":shadowcolor=0x65FFFF@0.8:shadowx=3:shadowy=3",
                ));
            }
            output.push(text_filter(
                &title.text,
                "main",
                size,
                main_color,
                &x_expr,
                &y_expr,
                &alpha,
                &enable,
                main_font,
                &effects,
            ));
        }
        if main_style
            .and_then(|style| style["underline"].as_bool())
            .unwrap_or(false)
        {
            output.push(box_filter(
                px - (size * count * 0.27) as i64,
                py + (size * 0.52) as i64,
                (size * count * 0.54).round() as i64,
                (size * 0.045).max(2.0).round() as i64,
                &format!("0x{}", hex_color(&title.color)),
                "fill",
            ));
        }
        if !title.secondary_text.trim().is_empty() {
            let secondary_size = secondary_style
                .and_then(|style| style["fontSize"].as_f64())
                .filter(|value| value.is_finite())
                .map(|value| (value * height as f64 / 1080.0).clamp(8.0, 320.0))
                .unwrap_or((size * 0.43).max(8.0))
                .round();
            let mut secondary_y = if matches!(
                title.preset_id.as_str(),
                "editorial-master"
                    | "future-glow"
                    | "content-create"
                    | "split-impact"
                    | "stacked-reveal-pro"
                    | "tutorial-step"
                    | "corporate-clean"
            ) {
                format!("h*{y:.3}-{:.0}", size * 1.22)
            } else {
                format!(
                    "h*{y:.3}+{:.0}",
                    size * title.line_height.clamp(0.8, 2.0) * 0.55
                )
            };
            let mut secondary_font = if matches!(
                title.preset_id.as_str(),
                "editorial-master" | "quote-editorial"
            ) {
                "InstrumentSerif-Italic.ttf"
            } else {
                "Inter.ttf"
            };
            if main_font.starts_with("pack-font-") {
                secondary_font = main_font;
            }
            let mut secondary_color = if title.preset_id == "corporate-clean" {
                "317781"
            } else if matches!(
                title.preset_id.as_str(),
                "content-create" | "stacked-reveal-pro" | "tutorial-step"
            ) {
                "13232B"
            } else {
                accent
            };
            if let Some(style) = secondary_style {
                if style["font"] == "Instrument Serif" {
                    secondary_font = "InstrumentSerif-Italic.ttf";
                }
                if let Some(fill) = style["fill"].as_str() {
                    secondary_color = hex_color(fill);
                }
                if let Some(y) = style["layoutOverrides"][aspect_key]["y"]
                    .as_f64()
                    .filter(|value| value.is_finite())
                {
                    secondary_y = format!("h*{:.3}-text_h/2", y.clamp(safe_area, 1.0 - safe_area));
                }
            }
            let secondary_x = secondary_style
                .and_then(|style| style["layoutOverrides"][aspect_key]["x"].as_f64())
                .filter(|value| value.is_finite())
                .map(|value| format!("w*{:.3}-text_w/2", value.clamp(safe_area, 1.0 - safe_area)))
                .unwrap_or_else(|| x_expr.clone());
            let secondary_alpha = secondary_style
                .and_then(|style| style["opacity"].as_f64())
                .filter(|value| value.is_finite())
                .map(|value| format!("({alpha})*{:.3}", value.clamp(0.0, 1.0)))
                .unwrap_or_else(|| alpha.clone());
            output.push(text_filter(
                &title.secondary_text,
                "secondary",
                secondary_size,
                secondary_color,
                &secondary_x,
                &secondary_y,
                &secondary_alpha,
                &enable,
                secondary_font,
                "",
            ));
        }
    }
    output
}

pub(crate) fn transition_filters(edl: &EdlManifest, width: u32, height: u32) -> Vec<String> {
    let mut output = Vec::new();
    for transition in &edl.tracks.transitions {
        if transition.duration_us == 0 {
            continue;
        }
        let at = edited_time(edl, transition.at_us);
        let half = (transition.duration_us / 2).max(1);
        let start = at.saturating_sub(half);
        let end = at.saturating_add(half);
        let enable = format!(
            "between(t\\,{:.6}\\,{:.6})",
            start as f64 / 1_000_000.0,
            end as f64 / 1_000_000.0
        );
        let filter = match transition.kind.as_str() {
            "fade-black" => format!("eq=brightness='-max(0\\,1-abs(t-{})/{})':eval=frame", seconds(at), seconds(half)),
            "cross-dissolve" => format!("tblend=all_mode=average:all_opacity=0.72:enable='{enable}'"),
            "push" => format!("tmix=frames=2:weights='1 1':enable='{enable}'"),
            "slide-wipe" => format!("tblend=all_mode=screen:all_opacity=0.42:enable='{enable}'"),
            "whip-pan" => format!("tmix=frames=4:weights='1 1 1 1',unsharp=5:5:1.4:5:5:0:enable='{enable}'"),
            "zoom" => format!("scale=w='iw*(1+0.16*max(0\\,1-abs(t-{at})/{half}))':h='ih*(1+0.16*max(0\\,1-abs(t-{at})/{half}))':eval=frame:flags=lanczos,crop={width}:{height}:x='(iw-ow)/2':y='(ih-oh)/2'", at=seconds(at), half=seconds(half)),
            _ => continue,
        };
        output.push(filter);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    #[test]
    fn title_filters_use_edited_timeline() {
        let edl: EdlManifest = serde_json::from_str(r##"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":10000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[{"id":"c","startUs":1000000,"endUs":2000000,"action":"remove","confidence":null,"reason":null}],"camera":[],"broll":[],"audio":[],"titles":[{"id":"t","presetId":"whisper-fade","text":"Hola","secondaryText":"","startUs":3000000,"endUs":5000000,"positionX":0.5,"positionY":0.5,"anchor":"center","scale":1,"font":"Inter","fontWeight":700,"fontSize":72,"color":"#FFFFFF","accentColor":"#34D5E5","alignment":"center","tracking":0,"lineHeight":1.15,"opacity":1,"safeArea":0.06,"animationInUs":500000,"animationOutUs":350000,"easing":"ease-out","background":false}]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"##).unwrap();
        let value = filters(&edl, 1920, 1080).join(",");
        assert!(value.contains("2.000000"));
        assert!(value.contains("4.000000"));
        assert!(!value.contains("Hola"));
        if Command::new("ffmpeg").arg("-version").output().is_ok() {
            let font_dir = prepare_assets(&edl).unwrap().unwrap();
            let rendered = Command::new("ffmpeg")
                .current_dir(font_dir)
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=640x360:d=1",
                    "-vf",
                    &filters(&edl, 640, 360).join(","),
                    "-frames:v",
                    "1",
                    "-f",
                    "null",
                    "-",
                ])
                .output()
                .unwrap();
            assert!(
                rendered.status.success(),
                "{}",
                String::from_utf8_lossy(&rendered.stderr)
            );
        }
    }
    #[test]
    fn utf8_title_roundtrips_and_renders() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let mut edl:EdlManifest=serde_json::from_str(r##"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":1000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[],"titles":[{"id":"utf8","presetId":"editorial-master","text":"Hola","secondaryText":"","startUs":0,"endUs":1000000,"positionX":0.5,"positionY":0.5,"anchor":"center","scale":1,"font":"Instrument Serif","fontWeight":700,"fontSize":72,"color":"#FFFFFF","accentColor":"#34D5E5","alignment":"center","tracking":0,"lineHeight":1.15,"opacity":1,"safeArea":0.06,"animationInUs":100000,"animationOutUs":100000,"easing":"ease-out","background":false}]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"##).unwrap();
        let phrase =
            "José — Configuración y Música: ¡Celebración en Perú! ¿Qué hacemos? ÁÉÍÓÚ áéíóú ñ Ñ";
        edl.tracks.titles[0].text = phrase.into();
        let restored: EdlManifest =
            serde_json::from_str(&serde_json::to_string(&edl).unwrap()).unwrap();
        assert_eq!(restored.tracks.titles[0].text, phrase);
        let dir = prepare_assets(&restored).unwrap().unwrap();
        assert_eq!(
            fs::read_to_string(dir.join(text_name("utf8", "main", phrase))).unwrap(),
            phrase
        );
        let rendered = Command::new("ffmpeg")
            .current_dir(dir)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:d=1",
                "-vf",
                &filters(&restored, 320, 180).join(","),
                "-frames:v",
                "1",
                "-f",
                "null",
                "-",
            ])
            .output()
            .unwrap();
        assert!(
            rendered.status.success(),
            "{}",
            String::from_utf8_lossy(&rendered.stderr)
        );
    }
    #[test]
    fn legacy_and_eighteen_professional_titles_render_distinct_frames() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let mut edl: EdlManifest = serde_json::from_str(r##"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":1000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[],"titles":[{"id":"visual-test","presetId":"whisper-fade","text":"85%","secondaryText":"LABEL","startUs":0,"endUs":1000000,"positionX":0.5,"positionY":0.5,"anchor":"center","scale":1,"font":"Inter","fontWeight":700,"fontSize":72,"color":"#FFFFFF","accentColor":"#34D5E5","alignment":"center","tracking":0,"lineHeight":1.15,"opacity":1,"safeArea":0.06,"animationInUs":300000,"animationOutUs":100000,"easing":"ease-out","background":false}]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"##).unwrap();
        let mut frames = std::collections::HashSet::new();
        for preset in [
            "whisper-fade",
            "rise-settle",
            "stack-reveal",
            "mask-wipe-up",
            "split-line",
            "underline-sweep",
            "lower-third",
            "zoom-out-stat",
            "callout",
            "editorial-master",
            "future-glow",
            "content-create",
            "neon-statement",
            "kinetic-pop",
            "letter-cascade-pro",
            "dynamic-slide",
            "typewriter-tech",
            "word-highlight",
            "split-impact",
            "stacked-reveal-pro",
            "underline-editorial",
            "lower-third-premium",
            "stat-hero",
            "tutorial-step",
            "quote-editorial",
            "gaming-impact",
            "corporate-clean",
        ] {
            edl.tracks.titles[0].preset_id = preset.into();
            let (sample, support, x, y, font_size, font) = match preset {
                "editorial-master" => (
                    "CONTENT CREATE",
                    "those who master",
                    0.5,
                    0.5,
                    72.0,
                    "Inter",
                ),
                "future-glow" => ("FUTURE", "THE NEXT", 0.5, 0.5, 72.0, "Inter"),
                "content-create" => ("CREATE", "CONTENT", 0.5, 0.5, 72.0, "Inter"),
                "neon-statement" => ("NEW ERA", "", 0.5, 0.5, 72.0, "Inter"),
                "kinetic-pop" => ("POP", "", 0.5, 0.5, 72.0, "Inter"),
                "letter-cascade-pro" => ("CASCADE", "", 0.5, 0.5, 72.0, "Inter"),
                "dynamic-slide" => ("MOVE", "", 0.5, 0.5, 72.0, "Inter"),
                "typewriter-tech" => ("HELLO", "SYSTEM", 0.5, 0.5, 72.0, "Inter"),
                "word-highlight" => ("MAKE IT REAL", "", 0.5, 0.5, 72.0, "Inter"),
                "split-impact" => ("STUDIO", "CREATIVE", 0.5, 0.5, 72.0, "Inter"),
                "stacked-reveal-pro" => (
                    "DESIGN SYSTEM",
                    "CHETO · EDITORIAL",
                    0.5,
                    0.5,
                    72.0,
                    "Inter",
                ),
                "underline-editorial" => ("YOUR STORY", "STARTS HERE", 0.5, 0.5, 72.0, "Inter"),
                "lower-third-premium" => (
                    "ALEX RIVERA",
                    "CREATIVE DIRECTOR",
                    0.08,
                    0.82,
                    54.0,
                    "Inter",
                ),
                "stat-hero" => ("85%", "COMPLETADO", 0.5, 0.5, 112.0, "Inter"),
                "tutorial-step" => ("CONFIGURAR JWT", "PASO 01", 0.5, 0.24, 56.0, "Inter"),
                "quote-editorial" => (
                    "Ideas que inspiran",
                    "— José",
                    0.5,
                    0.5,
                    72.0,
                    "Instrument Serif",
                ),
                "gaming-impact" => ("LEVEL UP", "", 0.5, 0.5, 72.0, "Inter"),
                "corporate-clean" => ("CLEAR THINKING", "INSIGHT", 0.5, 0.5, 72.0, "Inter"),
                _ => ("85%", "LABEL", 0.5, 0.5, 72.0, "Inter"),
            };
            let title = &mut edl.tracks.titles[0];
            title.text = sample.into();
            title.secondary_text = support.into();
            title.position_x = x;
            title.position_y = y;
            title.anchor = if preset == "lower-third-premium" {
                "left".into()
            } else {
                "center".into()
            };
            title.font_size = font_size;
            title.font = font.into();
            title.template_id = if [
                "whisper-fade",
                "rise-settle",
                "stack-reveal",
                "mask-wipe-up",
                "split-line",
                "underline-sweep",
                "lower-third",
                "zoom-out-stat",
                "callout",
            ]
            .contains(&preset)
            {
                None
            } else {
                Some(format!("cheto.{preset}"))
            };
            title.template_version = title.template_id.as_ref().map(|_| "1.0.0".into());
            let is_template = title.template_id.is_some();
            let font_dir = prepare_assets(&edl).unwrap().unwrap();
            let output = Command::new("ffmpeg")
                .current_dir(font_dir)
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=320x180:r=2:d=1",
                    "-vf",
                    &filters(&edl, 320, 180).join(","),
                    "-frames:v",
                    "2",
                    "-f",
                    "md5",
                    "-",
                ])
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{preset}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            frames.insert(output.stdout);
            if let Some(folder) = std::env::var_os("CHETO_QA6_TITLE_FRAMES") {
                let folder = PathBuf::from(folder);
                fs::create_dir_all(&folder).unwrap();
                let rendered = Command::new("ffmpeg")
                    .current_dir(prepare_assets(&edl).unwrap().unwrap())
                    .args([
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-f",
                        "lavfi",
                        "-i",
                        "color=c=0x15202b:s=640x360:r=30:d=1",
                        "-vf",
                        &filters(&edl, 640, 360).join(","),
                        "-ss",
                        "0.5",
                        "-frames:v",
                        "1",
                    ])
                    .arg(folder.join(format!("{preset}.png")))
                    .output()
                    .unwrap();
                assert!(
                    rendered.status.success(),
                    "{preset}: {}",
                    String::from_utf8_lossy(&rendered.stderr)
                );
            }
            if is_template {
                if let Some(folder) = std::env::var_os("CHETO_13E_TITLE_FRAMES") {
                    for (ratio, width, height) in
                        [("16x9", 640, 360), ("9x16", 360, 640), ("1x1", 480, 480)]
                    {
                        let folder = PathBuf::from(&folder).join(ratio);
                        fs::create_dir_all(&folder).unwrap();
                        let input = format!("color=c=0x15202b:s={width}x{height}:r=30:d=1");
                        let output = Command::new("ffmpeg")
                            .current_dir(prepare_assets(&edl).unwrap().unwrap())
                            .args([
                                "-y",
                                "-hide_banner",
                                "-loglevel",
                                "error",
                                "-f",
                                "lavfi",
                                "-i",
                                &input,
                                "-vf",
                                &filters(&edl, width, height).join(","),
                                "-ss",
                                "0.5",
                                "-frames:v",
                                "1",
                            ])
                            .arg(folder.join(format!("{preset}.png")))
                            .output()
                            .unwrap();
                        assert!(
                            output.status.success(),
                            "{preset} {ratio}: {}",
                            String::from_utf8_lossy(&output.stderr)
                        );
                    }
                }
            }
        }
        assert_eq!(frames.len(), 27, "Dos presets dibujaron el mismo resultado");
    }
    #[test]
    fn fade_black_filter_parses_in_ffmpeg() {
        let mut edl: EdlManifest = serde_json::from_str(r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":2000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#).unwrap();
        edl.tracks
            .transitions
            .push(crate::project_storage::TransitionDecision {
                id: "fade".into(),
                kind: "fade-black".into(),
                at_us: 1_000_000,
                duration_us: 600_000,
            });
        let filter = transition_filters(&edl, 64, 64).join(",");
        assert!(filter.contains("eq=brightness"));
        if Command::new("ffmpeg").arg("-version").output().is_ok() {
            let result = Command::new("ffmpeg")
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=white:s=64x64:d=2",
                    "-vf",
                    &filter,
                    "-frames:v",
                    "1",
                    "-f",
                    "null",
                    "-",
                ])
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }

    #[test]
    fn all_enabled_transitions_have_deterministic_filters() {
        let mut edl: EdlManifest = serde_json::from_str(r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":3000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#).unwrap();
        for kind in [
            "fade-black",
            "cross-dissolve",
            "push",
            "slide-wipe",
            "whip-pan",
            "zoom",
        ] {
            edl.tracks.transitions.clear();
            edl.tracks
                .transitions
                .push(crate::project_storage::TransitionDecision {
                    id: kind.into(),
                    kind: kind.into(),
                    at_us: 1_500_000,
                    duration_us: 600_000,
                });
            let filter = transition_filters(&edl, 320, 180).join(",");
            assert!(!filter.is_empty(), "missing filter for {kind}");
            if Command::new("ffmpeg").arg("-version").output().is_ok() {
                let result = Command::new("ffmpeg")
                    .args([
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-f",
                        "lavfi",
                        "-i",
                        "testsrc=size=320x180:rate=30:duration=3",
                        "-vf",
                        &filter,
                        "-frames:v",
                        "1",
                        "-f",
                        "null",
                        "-",
                    ])
                    .output()
                    .unwrap();
                assert!(
                    result.status.success(),
                    "{kind}: {}",
                    String::from_utf8_lossy(&result.stderr)
                );
            }
        }
    }
}
