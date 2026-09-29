use crate::{
    asset_mix::{
        active_audio_assets, audio_mix_graph, edited_time, overlay_graph, seamless_music_loop,
        AudioAssetInput,
    },
    project_storage::{AudioDecision, CameraDecision, EdlManifest, ProjectStorage},
    proxy_ffmpeg::nvenc_capabilities,
    visual_render,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, HashMap, HashSet},
    fs,
    hash::{Hash, Hasher},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct ExportManager {
    active: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
}

#[derive(Clone, Default)]
pub struct PreviewManager {
    active: Arc<Mutex<HashMap<String, (Uuid, Arc<Mutex<Child>>)>>>,
    cancelled: Arc<Mutex<HashSet<Uuid>>>,
    latest_request: Arc<Mutex<HashMap<String, u64>>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRequest {
    project_id: String,
    #[serde(default)]
    request_id: u64,
    start_us: u64,
    width: u32,
    height: u32,
    fps: f64,
    canvas_scale: f64,
    canvas_offset_x: f64,
    canvas_offset_y: f64,
    #[serde(default = "default_fit_mode")]
    fit_mode: String,
    #[serde(default = "default_background_mode")]
    background_mode: String,
    #[serde(default = "default_background_color")]
    background_color: String,
    edl: EdlManifest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewChunk {
    project_id: String,
    source_id: String,
    source_path: String,
    edl_revision: String,
    output_bytes: u64,
    ffmpeg_exit_code: Option<i32>,
    camera_samples: Vec<CameraRenderSample>,
    path: String,
    start_us: u64,
    duration_us: u64,
    cache_hit: bool,
    source_duration_us: u64,
    elapsed_ms: u128,
    realtime_factor: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CameraRenderSample {
    timestamp_us: u64,
    decision_id: String,
    stage: String,
    scale: f64,
    center_x: f64,
    center_y: f64,
}

fn camera_render_samples(edl: &EdlManifest, source_start: u64) -> Vec<CameraRenderSample> {
    let Some(decision) = edl.tracks.camera.first() else {
        return Vec::new();
    };
    let duration = decision.end_us.saturating_sub(decision.start_us);
    if duration == 0 {
        return Vec::new();
    }
    let transition = decision.transition_us.unwrap_or(500_000).min(duration / 2);
    let target = decision.zoom.unwrap_or(1.0).clamp(1.0, 3.0);
    let points = [
        ("before", decision.start_us.saturating_sub(1), 0.0),
        ("entrance", decision.start_us + transition / 2, 0.5),
        ("hold", decision.start_us + duration / 2, 1.0),
        ("exit", decision.end_us.saturating_sub(transition / 2), 0.5),
        ("after", decision.end_us.saturating_add(1), 0.0),
    ];
    points
        .into_iter()
        .map(|(stage, local_us, progress)| {
            let eased = match decision.easing.as_deref() {
                Some("ease_in") => progress * progress,
                Some("ease_out") => 1.0 - (1.0 - progress) * (1.0 - progress),
                Some("ease_in_out") => progress * progress * (3.0 - 2.0 * progress),
                _ => progress,
            };
            CameraRenderSample {
                timestamp_us: source_start.saturating_add(local_us),
                decision_id: decision.id.clone(),
                stage: stage.into(),
                scale: 1.0 + (target - 1.0) * eased,
                center_x: decision.center_x.unwrap_or(0.5),
                center_y: decision.center_y.unwrap_or(0.5),
            }
        })
        .collect()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    project_id: String,
    output_path: String,
    width: u32,
    height: u32,
    fps: f64,
    bitrate: String,
    include_audio: bool,
    aspect_ratio: f64,
    canvas_scale: f64,
    canvas_offset_x: f64,
    canvas_offset_y: f64,
    #[serde(default = "default_fit_mode")]
    fit_mode: String,
    #[serde(default = "default_background_mode")]
    background_mode: String,
    #[serde(default = "default_background_color")]
    background_color: String,
    #[serde(default = "default_export_preset")]
    preset: String,
    #[serde(default)]
    preview_source_start_us: u64,
    #[serde(default)]
    preview_duration_us: Option<u64>,
}

fn default_export_preset() -> String {
    "balanced".into()
}
fn default_fit_mode() -> String {
    "cover".into()
}
fn default_background_mode() -> String {
    "black".into()
}
fn default_background_color() -> String {
    "#000000".into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    project_id: String,
    stage: String,
    progress: f64,
    processed_us: u64,
    duration_us: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    output_path: String,
    encoder: String,
    file_size_bytes: u64,
    duration_us: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportError {
    code: String,
    message: String,
}
impl ExportError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

fn validate(config: &ExportConfig, edl: &EdlManifest, duration_us: u64) -> Result<(), ExportError> {
    if edl.source_on_timeline == Some(false) {
        return Err(ExportError::new(
            "empty-timeline",
            "Añade el video de Medios a la timeline antes de exportar.",
        ));
    }
    if !(16..=7680).contains(&config.width)
        || !(16..=4320).contains(&config.height)
        || config.width % 2 != 0
        || config.height % 2 != 0
    {
        return Err(ExportError::new(
            "invalid-resolution",
            "La resolución debe ser par y estar dentro de límites seguros.",
        ));
    }
    if !(1.0..=240.0).contains(&config.fps) {
        return Err(ExportError::new("invalid-fps", "Los FPS no son válidos."));
    }
    if !config.aspect_ratio.is_finite() || !(0.2..=5.0).contains(&config.aspect_ratio) {
        return Err(ExportError::new(
            "invalid-aspect",
            "La relación de aspecto no es válida.",
        ));
    }
    if !config.canvas_scale.is_finite() || !(0.5..=2.5).contains(&config.canvas_scale) {
        return Err(ExportError::new(
            "invalid-canvas-scale",
            "La escala del lienzo no es válida.",
        ));
    }
    if !config.canvas_offset_x.is_finite()
        || !config.canvas_offset_y.is_finite()
        || config.canvas_offset_x.abs() > 1.0
        || config.canvas_offset_y.abs() > 1.0
    {
        return Err(ExportError::new(
            "invalid-canvas-position",
            "La posición del lienzo no es válida.",
        ));
    }
    if !matches!(config.fit_mode.as_str(), "cover" | "contain" | "center")
        || !matches!(config.background_mode.as_str(), "black" | "blur" | "color")
        || !(config.background_color.len() == 7
            && config.background_color.starts_with('#')
            && config.background_color[1..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err(ExportError::new(
            "invalid-fit",
            "El modo de encaje o fondo no es válido.",
        ));
    }
    let output = Path::new(&config.output_path);
    if output
        .extension()
        .and_then(|v| v.to_str())
        .is_none_or(|v| !v.eq_ignore_ascii_case("mp4"))
    {
        return Err(ExportError::new(
            "invalid-output",
            "La salida debe usar contenedor MP4.",
        ));
    }
    if output.parent().is_none_or(|value| !value.is_dir()) {
        return Err(ExportError::new(
            "invalid-output",
            "La carpeta de salida no existe.",
        ));
    }
    for (label, start, end) in edl
        .tracks
        .cuts
        .iter()
        .map(|v| ("corte", v.start_us, v.end_us))
        .chain(
            edl.tracks
                .camera
                .iter()
                .map(|v| ("encuadre", v.start_us, v.end_us)),
        )
        .chain(
            edl.tracks
                .audio
                .iter()
                .map(|v| ("audio", v.start_us, v.end_us)),
        )
    {
        if start >= end || end > duration_us {
            return Err(ExportError::new(
                "invalid-edl",
                format!("El {label} {start}–{end} µs está fuera del video."),
            ));
        }
    }
    for item in &edl.tracks.assets {
        if item.start_us >= item.end_us
            || item.end_us > duration_us
            || !matches!(item.kind.as_str(), "sfx" | "music" | "overlay")
            || !item.gain_db.is_finite()
            || !item.scale.is_finite()
            || !item.opacity.is_finite()
            || !item.position_x.is_finite()
            || !item.position_y.is_finite()
        {
            return Err(ExportError::new(
                "invalid-asset",
                "La colocación multimedia no es válida.",
            ));
        }
        if !item.muted && !Path::new(&item.asset_path).is_file() {
            return Err(ExportError::new(
                "asset-missing",
                format!("Recurso no encontrado: {}", item.asset_path),
            ));
        }
    }
    for title in &edl.tracks.titles {
        if title.start_us >= title.end_us
            || title.end_us > duration_us
            || title.text.len() > 1_024
            || title.secondary_text.len() > 1_024
            || !title.font_size.is_finite()
            || !title.position_x.is_finite()
            || !title.position_y.is_finite()
            || !title.opacity.is_finite()
            || !title.scale.is_finite()
            || !(8.0..=320.0).contains(&title.font_size)
            || !(0.0..=1.0).contains(&title.position_x)
            || !(0.0..=1.0).contains(&title.position_y)
        {
            return Err(ExportError::new(
                "invalid-title",
                "Un título contiene valores fuera de rango.",
            ));
        }
    }
    for transition in &edl.tracks.transitions {
        if transition.at_us > duration_us
            || !(100_000..=2_000_000).contains(&transition.duration_us)
        {
            return Err(ExportError::new(
                "invalid-transition",
                "Una transición contiene valores fuera de rango.",
            ));
        }
    }
    let mut camera = edl.tracks.camera.clone();
    camera.sort_by_key(|v| v.start_us);
    for pair in camera.windows(2) {
        if pair[0].end_us > pair[1].start_us {
            return Err(ExportError::new(
                "camera-overlap",
                format!(
                    "Conflicto de encuadre: {}–{} y {}–{} µs.",
                    pair[0].start_us, pair[0].end_us, pair[1].start_us, pair[1].end_us
                ),
            ));
        }
    }
    Ok(())
}

fn seconds(us: u64) -> String {
    format!("{:.6}", us as f64 / 1_000_000.0)
}
fn nested_camera(
    camera: &[CameraDecision],
    field: fn(&CameraDecision) -> f64,
    default: f64,
) -> String {
    camera.iter().rev().fold(default.to_string(), |rest, item| {
        let target = field(item);
        let duration_us = item.end_us.saturating_sub(item.start_us);
        let transition_us = item.transition_us.unwrap_or(500_000).min(duration_us / 2);
        let factor = if transition_us == 0 {
            "1".to_string()
        } else {
            let linear = format!(
                "min(1,min((it-{})/{},({}-it)/{}))",
                seconds(item.start_us),
                seconds(transition_us),
                seconds(item.end_us),
                seconds(transition_us)
            );
            match item.easing.as_deref() {
                Some("ease_in") => format!("(({linear})*({linear}))"),
                Some("ease_out") => format!("(1-(1-({linear}))*(1-({linear})))"),
                Some("ease_in_out") => format!("(({linear})*({linear})*(3-2*({linear})))"),
                _ => linear,
            }
        };
        let animated = format!("({default}+({target}-{default})*({factor}))");
        format!(
            "if(between(it,{},{}),{},({rest}))",
            seconds(item.start_us),
            seconds(item.end_us),
            animated
        )
    })
}
fn keep_expression(edl: &EdlManifest) -> String {
    if edl.tracks.cuts.is_empty() {
        "1".into()
    } else {
        format!(
            "not({})",
            edl.tracks
                .cuts
                .iter()
                .map(|v| format!("between(t,{},{})", seconds(v.start_us), seconds(v.end_us)))
                .collect::<Vec<_>>()
                .join("+")
        )
    }
}
fn audio_parameter_f64(item: &AudioDecision, key: &str, default: f64) -> f64 {
    item.parameters
        .get(key)
        .and_then(|value| value.as_f64())
        .unwrap_or(default)
}

pub(crate) fn selected_audio_stream(edl: &EdlManifest) -> usize {
    edl.tracks
        .audio
        .iter()
        .find(|item| item.operation == "source_stream")
        .and_then(|item| item.parameters.get("index"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as usize
}

fn audio_filters(edl: &EdlManifest) -> String {
    audio_filters_from(edl, 0)
}

pub(crate) fn audio_filters_from(edl: &EdlManifest, offset_us: u64) -> String {
    let mut filters = Vec::<String>::new();

    if edl.audio_on_timeline == Some(false)
        || edl.tracks.audio.iter().any(|item| item.operation == "mute")
    {
        filters.push("volume=0".into());
    }

    if let Some(item) = edl
        .tracks
        .audio
        .iter()
        .find(|item| item.operation == "master_gain")
    {
        let gain_db = audio_parameter_f64(item, "gainDb", 0.0).clamp(-60.0, 12.0);
        if gain_db.abs() >= 0.05 {
            filters.push(format!("volume={gain_db}dB"));
        }
    }
    if let Some(item) = edl
        .tracks
        .audio
        .iter()
        .find(|item| item.operation == "noise_reduction")
    {
        let amount = audio_parameter_f64(item, "amount", 0.55).clamp(0.0, 1.0);
        if amount > 0.001 {
            let nr = 4.0 + amount * 12.0;
            filters.push(format!("afftdn=nr={nr:.1}:nf=-35"));
        }
    }
    if let Some(item) = edl
        .tracks
        .audio
        .iter()
        .find(|item| item.operation == "voice_focus")
    {
        let amount = audio_parameter_f64(item, "amount", 0.5).clamp(0.0, 1.0);
        if amount > 0.001 {
            let highpass = (60.0 + amount * 60.0).round();
            let lowpass = (14_000.0 - amount * 6_000.0).round();
            filters.push(format!("highpass=f={highpass:.0}"));
            filters.push(format!("lowpass=f={lowpass:.0}"));
        }
    }
    if let Some(item) = edl
        .tracks
        .audio
        .iter()
        .find(|item| item.operation == "hum_filter")
    {
        let hz = audio_parameter_f64(item, "hz", 50.0).clamp(45.0, 65.0);
        filters.push(format!("bandreject=f={hz}:width_type=h:width=4"));
    }

    if let Some(item) = edl
        .tracks
        .audio
        .iter()
        .find(|item| item.operation == "peak_limiter")
    {
        let limit = audio_parameter_f64(item, "limit", 0.95).clamp(0.1, 1.0);
        filters.push(format!("alimiter=limit={limit:.2}"));
    }

    for item in &edl.tracks.audio {
        let offset_edited = edited_time(edl, offset_us);
        let start_edited = edited_time(edl, item.start_us);
        let end_edited = edited_time(edl, item.end_us);
        let enable = format!(
            "between(t,{:.6},{:.6})",
            (start_edited as f64 - offset_edited as f64) / 1_000_000.0,
            (end_edited as f64 - offset_edited as f64) / 1_000_000.0
        );
        match item.operation.as_str() {
            "mute_range" => filters.push(format!("volume=0:enable='{enable}'")),
            "gain_range" => {
                let gain_db = audio_parameter_f64(item, "gainDb", 0.0).clamp(-60.0, 18.0);
                if gain_db.abs() >= 0.05 {
                    filters.push(format!("volume={gain_db}dB:enable='{enable}'"));
                }
            }
            "noise_reduction_range" => {
                let amount = audio_parameter_f64(item, "amount", 0.45).clamp(0.0, 1.0);
                if amount > 0.001 {
                    let nr = 4.0 + amount * 10.0;
                    filters.push(format!("afftdn=nr={nr:.1}:nf=-35:enable='{enable}'"));
                }
            }
            "notch_range" => {
                let hz = audio_parameter_f64(item, "hz", 4000.0).clamp(120.0, 16_000.0);
                let width = audio_parameter_f64(item, "width", 90.0).clamp(10.0, 500.0);
                filters.push(format!(
                    "bandreject=f={hz}:width_type=h:width={width}:enable='{enable}'"
                ));
            }
            _ => {}
        }
    }

    if edl
        .tracks
        .audio
        .iter()
        .any(|item| item.operation == "normalize")
    {
        filters.push("loudnorm=I=-16:LRA=11:TP=-1.5".into());
    }

    let source_duration = edl.source_duration_us.unwrap_or(0);
    let result_duration = edited_duration(edl, source_duration);
    for operation in ["fade_in", "fade_out"] {
        let Some(item) = edl
            .tracks
            .audio
            .iter()
            .find(|item| item.operation == operation)
        else {
            continue;
        };
        let fade_us = item
            .parameters
            .get("durationUs")
            .and_then(|value| value.as_u64())
            .unwrap_or(0)
            .min(result_duration);
        if fade_us == 0 {
            continue;
        }
        if operation == "fade_in" {
            if offset_us < fade_us {
                let remaining = (fade_us - offset_us) as f64 / 1_000_000.0;
                filters.push(format!("afade=t=in:st=0.000000:d={remaining:.6}"));
            }
        } else {
            let fade_start_us = result_duration.saturating_sub(fade_us);
            let start = fade_start_us.saturating_sub(offset_us) as f64 / 1_000_000.0;
            let remaining =
                result_duration.saturating_sub(offset_us).min(fade_us) as f64 / 1_000_000.0;
            if remaining > 0.0 {
                filters.push(format!("afade=t=out:st={start:.6}:d={remaining:.6}"));
            }
        }
    }

    filters.join(",")
}

fn edited_duration(edl: &EdlManifest, duration: u64) -> u64 {
    let mut ranges = edl
        .tracks
        .cuts
        .iter()
        .map(|v| (v.start_us, v.end_us))
        .collect::<Vec<_>>();
    ranges.sort();
    let mut removed = 0;
    let mut current: Option<(u64, u64)> = None;
    for (start, end) in ranges {
        current = Some(match current {
            Some((a, b)) if start <= b => (a, b.max(end)),
            Some((a, b)) => {
                removed += b - a;
                (start, end)
            }
            None => (start, end),
        });
    }
    if let Some((a, b)) = current {
        removed += b - a;
    }
    duration.saturating_sub(removed)
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}
#[cfg(not(windows))]
fn hide_console(_: &mut Command) {}

fn video_filter_chain(config: &ExportConfig, edl: &EdlManifest, source_size: (u32, u32)) -> String {
    let mut filters = Vec::<String>::new();
    let has_camera = !edl.tracks.camera.is_empty();
    if has_camera {
        // zoompan evaluates the zoom expression for every input frame. crop evaluates
        // its dimensions only when the filter starts, so it cannot animate zoom.
        filters.extend(fit_filters(config));
        filters.push(format!("fps=fps={}", config.fps));
        let zoom = nested_camera(
            &edl.tracks.camera,
            |v| v.zoom.unwrap_or(1.0).clamp(1.0, 3.0),
            1.0,
        );
        let center_x = nested_camera(
            &edl.tracks.camera,
            |v| v.center_x.unwrap_or(0.5).clamp(0.0, 1.0),
            0.5,
        );
        let center_y = nested_camera(
            &edl.tracks.camera,
            |v| v.center_y.unwrap_or(0.5).clamp(0.0, 1.0),
            0.5,
        );
        filters.push(format!(
            "zoompan=z='{zoom}':x='(iw-iw/zoom)*({center_x})':y='(ih-ih/zoom)*({center_y})':d=1:s={}x{}:fps={}",
            config.width, config.height, config.fps
        ));
    }
    if edl.tracks.cuts.iter().any(|cut| cut.action == "remove") {
        filters.push(format!("select='{}'", keep_expression(edl)));
        filters.push("setpts=N/FRAME_RATE/TB".into());
    }
    if !has_camera && (source_size != (config.width, config.height) || config.fit_mode != "cover") {
        filters.extend(fit_filters(config));
    }
    // Camera is relative to the fitted source; the persistent canvas transform is
    // applied once afterward. Preview and export both call this filter chain.
    if (config.canvas_scale - 1.0).abs() > 0.0001 {
        let sw = ((config.width as f64 * config.canvas_scale / 2.0).round() as u32 * 2).max(2);
        let sh = ((config.height as f64 * config.canvas_scale / 2.0).round() as u32 * 2).max(2);
        let ox = config.canvas_offset_x;
        let oy = config.canvas_offset_y;
        let w = config.width;
        let h = config.height;
        filters.push(format!("scale={sw}:{sh}"));
        filters.push(format!("crop='min(iw,{w})':'min(ih,{h})':'max(0,(iw-{w})/2-(iw-{w})*({ox})/2)':'max(0,(ih-{h})/2-(ih-{h})*({oy})/2)'"));
        filters.push(format!("pad={w}:{h}:'max(0,({w}-iw)/2+({w}-iw)*({ox})/2)':'max(0,({h}-ih)/2+({h}-ih)*({oy})/2)':black"));
    }
    filters.extend(visual_render::filters(edl, config.width, config.height));
    if !filters.is_empty() {
        filters.push("setsar=1".into());
    }
    filters.join(",")
}

fn fit_filters(config: &ExportConfig) -> Vec<String> {
    let w = config.width;
    let h = config.height;
    // At 100% canvas scale, move the fitted image inside the available crop or
    // padding. At other scales the base transform below owns the translation.
    let ox = if (config.canvas_scale - 1.0).abs() <= 0.0001 {
        config.canvas_offset_x
    } else {
        0.0
    };
    let oy = if (config.canvas_scale - 1.0).abs() <= 0.0001 {
        config.canvas_offset_y
    } else {
        0.0
    };
    if config.fit_mode == "cover" {
        vec![
            format!("scale={w}:{h}:force_original_aspect_ratio=increase"),
            format!("crop={w}:{h}:'max(0,(iw-{w})/2+(iw-{w})*({ox})/2)':'max(0,(ih-{h})/2+(ih-{h})*({oy})/2)'"),
        ]
    } else {
        let background = if config.fit_mode == "center" && config.background_mode == "color" {
            format!("0x{}", &config.background_color[1..])
        } else {
            "black".into()
        };
        vec![
            format!("scale={w}:{h}:force_original_aspect_ratio=decrease"),
            format!("pad={w}:{h}:'(ow-iw)/2+(ow-iw)*({ox})/2':'(oh-ih)/2+(oh-ih)*({oy})/2':{background}"),
        ]
    }
}

fn center_blur_graph(config: &ExportConfig) -> String {
    let w = config.width;
    let h = config.height;
    let ox = if (config.canvas_scale - 1.0).abs() <= 0.0001 {
        config.canvas_offset_x
    } else {
        0.0
    };
    let oy = if (config.canvas_scale - 1.0).abs() <= 0.0001 {
        config.canvas_offset_y
    } else {
        0.0
    };
    format!("[0:v:0]split=2[blur_source][main_source];[blur_source]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=20:1,eq=brightness=-0.16[blur_background];[main_source]scale={w}:{h}:force_original_aspect_ratio=decrease[main_contain];[blur_background][main_contain]overlay=(W-w)/2+(W-w)*({ox})/2:(H-h)/2+(H-h)*({oy})/2,setsar=1[vfit]")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RenderRegionKind {
    Unchanged,
    Removed,
    Camera,
    Audio,
    CameraAudio,
}

fn analyze_render_regions(
    edl: &EdlManifest,
    duration_us: u64,
) -> Vec<(u64, u64, RenderRegionKind)> {
    let mut boundaries = vec![0, duration_us];
    for (start, end) in edl
        .tracks
        .cuts
        .iter()
        .map(|item| (item.start_us, item.end_us))
        .chain(
            edl.tracks
                .camera
                .iter()
                .map(|item| (item.start_us, item.end_us)),
        )
        .chain(
            edl.tracks
                .audio
                .iter()
                .map(|item| (item.start_us, item.end_us)),
        )
    {
        boundaries.extend([start.min(duration_us), end.min(duration_us)]);
    }
    boundaries.sort_unstable();
    boundaries.dedup();
    let mut regions: Vec<(u64, u64, RenderRegionKind)> = Vec::new();
    for pair in boundaries.windows(2) {
        let (start, end) = (pair[0], pair[1]);
        if start == end {
            continue;
        }
        let cut =
            edl.tracks.cuts.iter().any(|item| {
                item.action == "remove" && item.start_us <= start && item.end_us >= end
            });
        let camera = edl
            .tracks
            .camera
            .iter()
            .any(|item| item.start_us <= start && item.end_us >= end);
        let audio = edl.tracks.audio.iter().any(|item| {
            item.operation != "source_stream" && item.start_us <= start && item.end_us >= end
        });
        let kind = if cut {
            RenderRegionKind::Removed
        } else if camera && audio {
            RenderRegionKind::CameraAudio
        } else if camera {
            RenderRegionKind::Camera
        } else if audio {
            RenderRegionKind::Audio
        } else {
            RenderRegionKind::Unchanged
        };
        if let Some(last) = regions.last_mut() {
            if last.1 == start && last.2 == kind {
                last.1 = end;
                continue;
            }
        }
        regions.push((start, end, kind));
    }
    regions
}

fn encoder_preset(encoder: &str, preset: &str) -> &'static str {
    match (encoder, preset) {
        ("h264_nvenc", "fast") => "p1",
        ("h264_nvenc", "high") => "p6",
        ("h264_nvenc", "maximum") => "p7",
        ("h264_nvenc", _) => "p4",
        (_, "fast") => "veryfast",
        (_, "high") => "slow",
        (_, "maximum") => "veryslow",
        _ => "medium",
    }
}

fn choose_encoder(nvenc_available: bool, preset: &str) -> &'static str {
    if nvenc_available && matches!(preset, "fast" | "balanced") {
        "h264_nvenc"
    } else {
        "libx264"
    }
}

fn should_retry_on_cpu(encoder: &str, error: &ExportError) -> bool {
    encoder == "h264_nvenc" && error.code == "ffmpeg-failed"
}

fn render_edl_for_manual_trim(edl: &EdlManifest) -> EdlManifest {
    let Some(trim) = &edl.manual_trim else {
        return edl.clone();
    };
    let mut result = edl.clone();
    let start = trim.source_in_us;
    let end = trim.source_out_us;
    result
        .tracks
        .camera
        .retain(|item| item.end_us > start && item.start_us < end);
    for item in &mut result.tracks.camera {
        if item.start_us < start {
            item.transition_us = Some(0);
        }
        item.start_us = item.start_us.max(start);
        item.end_us = item.end_us.min(end);
    }
    result
        .tracks
        .audio
        .retain(|item| item.end_us > start && item.start_us < end);
    for item in &mut result.tracks.audio {
        item.start_us = item.start_us.max(start);
        item.end_us = item.end_us.min(end);
    }
    result
        .tracks
        .titles
        .retain(|item| item.end_us > start && item.start_us < end);
    for item in &mut result.tracks.titles {
        if item.start_us < start {
            item.animation_in_us = 0;
        }
        item.start_us = item.start_us.max(start);
        item.end_us = item.end_us.min(end);
    }
    result
        .tracks
        .assets
        .retain(|item| item.end_us > start && item.start_us < end);
    for item in &mut result.tracks.assets {
        if item.start_us < start {
            let elapsed = start - item.start_us;
            item.preview_input_offset_us = Some(if item.loop_ && item.source_duration_us > 0 {
                elapsed % item.source_duration_us
            } else {
                elapsed
            });
            item.fade_in_us = 0;
        }
        item.start_us = item.start_us.max(start);
        item.end_us = item.end_us.min(end);
    }
    result
        .tracks
        .transitions
        .retain(|item| item.at_us >= start && item.at_us < end);
    result
}

fn command(
    config: &ExportConfig,
    source: &Path,
    edl: &EdlManifest,
    encoder: &str,
    source_size: (u32, u32),
    source_audio_present: bool,
) -> Command {
    let manual_trim = edl.manual_trim.clone();
    let render_edl = render_edl_for_manual_trim(edl);
    let edl = &render_edl;
    let blur_fit = config.fit_mode == "center" && config.background_mode == "blur";
    let mut fitted_config = config.clone();
    if blur_fit {
        fitted_config.fit_mode = "cover".into();
    }
    let video_filters = video_filter_chain(
        &fitted_config,
        edl,
        if blur_fit {
            (config.width, config.height)
        } else {
            source_size
        },
    );
    let blur_graph = blur_fit.then(|| center_blur_graph(config));
    let transition_filters =
        visual_render::transition_filters(edl, config.width, config.height).join(",");
    let combined_filters = [video_filters.as_str(), transition_filters.as_str()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(",");
    let has_audio = config.include_audio
        && ((source_audio_present && edl.audio_on_timeline != Some(false))
            || !active_audio_assets(edl).is_empty());
    let mut cmd = Command::new("ffmpeg");
    if let Ok(Some(font_dir)) = visual_render::prepare_assets(edl) {
        cmd.current_dir(font_dir);
    }
    let profiling = std::env::var_os("CHETO_EXPORT_PROFILE").is_some();
    cmd.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        if profiling { "info" } else { "error" },
        "-nostdin",
    ]);
    if profiling {
        cmd.arg("-benchmark");
    }
    let source_seek_us = config.preview_source_start_us.max(
        manual_trim
            .as_ref()
            .map(|trim| trim.source_in_us)
            .unwrap_or(0),
    );
    if source_seek_us > 0 {
        cmd.args([
            "-ss",
            &format!("{:.6}", source_seek_us as f64 / 1_000_000.0),
        ]);
    }
    cmd.arg("-i").arg(source);
    if edl.tracks.assets.iter().any(|item| !item.muted) {
        let active: Vec<_> = edl
            .tracks
            .assets
            .iter()
            .filter(|item| !item.muted)
            .collect();
        let mut audio_inputs = Vec::new();
        let mut overlays = Vec::new();
        for (slot, item) in active.iter().enumerate() {
            if item.loop_ {
                cmd.args(["-stream_loop", "-1"]);
            }
            if item.kind == "overlay" {
                cmd.args(["-ignore_loop", "1"]);
            }
            if let Some(offset) = item.preview_input_offset_us.filter(|value| *value > 0) {
                cmd.args(["-ss", &format!("{:.6}", offset as f64 / 1_000_000.0)]);
            }
            cmd.arg("-i").arg(&item.asset_path);
            if item.kind == "overlay" {
                overlays.push((slot + 1, *item));
            } else {
                audio_inputs.push(AudioAssetInput {
                    index: slot + 1,
                    item,
                    start_us: edited_time(edl, item.start_us),
                    end_us: edited_time(edl, item.end_us),
                });
            }
        }
        let overlay_filters = overlay_graph(
            &overlays,
            &video_filters,
            edl,
            if blur_fit { "vfit" } else { "0:v:0" },
        )
        .map(|graph| {
            if transition_filters.is_empty() {
                graph
            } else {
                format!("{graph};[vout]{transition_filters}[vfinal]")
            }
        });
        if overlay_filters.is_some() || blur_fit {
            cmd.args([
                "-map",
                if overlay_filters.is_some() && transition_filters.is_empty() {
                    "[vout]"
                } else {
                    "[vfinal]"
                },
            ]);
        } else {
            cmd.args(["-map", "0:v:0"]);
            if !combined_filters.is_empty() {
                cmd.args(["-vf", &combined_filters]);
            }
        }
        let source_audio_filters = {
            let mut filters = Vec::new();
            if edl.tracks.cuts.iter().any(|cut| cut.action == "remove") {
                filters.push(format!("aselect='{}'", keep_expression(edl)));
                filters.push("asetpts=N/SR/TB".into());
            }
            let effects = audio_filters(edl);
            if !effects.is_empty() {
                filters.push(effects);
            }
            filters.join(",")
        };
        let mixed = if has_audio {
            audio_mix_graph(
                edl,
                &audio_inputs,
                &source_audio_filters,
                0,
                edited_duration(edl, edl.source_duration_us.unwrap_or(u64::MAX)),
                source_audio_present,
            )
        } else {
            None
        };
        let video_graph = if let Some(overlay) = overlay_filters {
            Some(if let Some(blur) = blur_graph.as_ref() {
                format!("{blur};{overlay}")
            } else {
                overlay
            })
        } else if let Some(blur) = blur_graph.as_ref() {
            Some(format!(
                "{blur};[vfit]{}[vfinal]",
                if combined_filters.is_empty() {
                    "null"
                } else {
                    &combined_filters
                }
            ))
        } else {
            None
        };
        let graph = [video_graph, mixed.clone()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(";");
        if !graph.is_empty() {
            cmd.args(["-filter_complex", &graph]);
        }
        if mixed.is_some() {
            cmd.args(["-map", "[aout]"]);
        } else if has_audio && source_audio_present {
            cmd.args(["-map", &format!("0:a:{}", selected_audio_stream(edl))]);
            if !source_audio_filters.is_empty() {
                cmd.args(["-af", &source_audio_filters]);
            }
        } else {
            cmd.arg("-an");
        }
        cmd.arg("-shortest");
    } else {
        if let Some(blur) = blur_graph.as_ref() {
            cmd.args(["-map", "[vfinal]"]);
            cmd.args([
                "-filter_complex",
                &format!(
                    "{blur};[vfit]{}[vfinal]",
                    if combined_filters.is_empty() {
                        "null"
                    } else {
                        &combined_filters
                    }
                ),
            ]);
        } else {
            cmd.args(["-map", "0:v:0"]);
        }
        if !blur_fit && !combined_filters.is_empty() {
            cmd.args(["-vf", &combined_filters]);
        }
        if has_audio && source_audio_present {
            let stream = selected_audio_stream(edl);
            cmd.args(["-map", &format!("0:a:{stream}")]);
            let mut af = Vec::<String>::new();
            if edl.tracks.cuts.iter().any(|cut| cut.action == "remove") {
                af.push(format!("aselect='{}'", keep_expression(edl)));
                af.push("asetpts=N/SR/TB".into());
            }
            let effects = audio_filters(edl);
            if !effects.is_empty() {
                af.push(effects);
            }
            if !af.is_empty() {
                cmd.args(["-af", &af.join(",")]);
            }
        } else {
            cmd.arg("-an");
        }
    }
    cmd.args([
        "-r",
        &config.fps.to_string(),
        "-c:v",
        encoder,
        "-preset",
        encoder_preset(encoder, &config.preset),
    ]);
    match config.bitrate.as_str() {
        "low" => {
            cmd.args(["-b:v", "2M"]);
        }
        "medium" => {
            cmd.args(["-b:v", "5M"]);
        }
        "high" => {
            cmd.args(["-b:v", "10M"]);
        }
        "max" => {
            cmd.args(["-b:v", "16M"]);
        }
        value if value.starts_with("custom:") => {
            cmd.args(["-b:v", value.trim_start_matches("custom:")]);
        }
        _ if encoder == "h264_nvenc" => {
            cmd.args(["-cq", "23", "-b:v", "0"]);
        }
        _ => {
            cmd.args(["-crf", "21"]);
        }
    }
    if has_audio {
        cmd.args(["-c:a", "aac", "-b:a", "192k"]);
    }
    cmd.args([
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
    ]);
    if let Some(limit) = config.preview_duration_us.or_else(|| {
        manual_trim
            .as_ref()
            .map(|trim| trim.source_out_us.saturating_sub(trim.source_in_us))
    }) {
        cmd.args(["-t", &format!("{:.6}", limit as f64 / 1_000_000.0)]);
    }
    cmd.arg(&config.output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);
    cmd
}

fn render(
    app: &AppHandle,
    manager: &ExportManager,
    config: &ExportConfig,
    source: &Path,
    edl: &EdlManifest,
    duration_us: u64,
    encoder: &str,
    source_size: (u32, u32),
    source_audio_present: bool,
) -> Result<(), ExportError> {
    visual_render::prepare_assets(edl).map_err(|error| ExportError::new("title-assets", error))?;
    let output = PathBuf::from(&config.output_path);
    let file_name = output
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("export.mp4");
    let temporary = output.with_file_name(format!(".{file_name}.{}.partial.mp4", Uuid::new_v4()));
    let mut temporary_config = config.clone();
    temporary_config.output_path = temporary.to_string_lossy().into_owned();
    let started = Instant::now();
    let mut child = command(
        &temporary_config,
        source,
        edl,
        encoder,
        source_size,
        source_audio_present,
    )
    .spawn()
    .map_err(|e| {
        ExportError::new(
            "ffmpeg-unavailable",
            format!("No se pudo iniciar FFmpeg: {e}"),
        )
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ExportError::new("ffmpeg-progress", "FFmpeg no expuso progreso."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ExportError::new("ffmpeg-error", "FFmpeg no expuso diagnóstico."))?;
    let diagnostics_task = std::thread::spawn(move || {
        let mut diagnostics = String::new();
        let _ = std::io::Read::read_to_string(&mut BufReader::new(stderr), &mut diagnostics);
        diagnostics
    });
    let child = Arc::new(Mutex::new(child));
    manager
        .active
        .lock()
        .unwrap()
        .insert(config.project_id.clone(), child.clone());
    let edited = edited_duration(edl, duration_us).max(1);
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(value) = line
            .strip_prefix("out_time_us=")
            .and_then(|v| v.parse::<u64>().ok())
        {
            let _ = app.emit(
                "export-progress",
                ExportProgress {
                    project_id: config.project_id.clone(),
                    stage: "rendering".into(),
                    progress: (value as f64 / edited as f64 * 100.0).clamp(0.0, 100.0),
                    processed_us: value,
                    duration_us: edited,
                },
            );
        }
    }
    let status = child.lock().unwrap().wait();
    manager.active.lock().unwrap().remove(&config.project_id);
    let diagnostics = diagnostics_task.join().unwrap_or_default();
    let cancelled = manager.cancelled.lock().unwrap().remove(&config.project_id);
    if std::env::var_os("CHETO_EXPORT_PROFILE").is_some() {
        eprintln!("CHETO_EXPORT_PROFILE encoder={encoder} video_filters={} audio_filters={} elapsed_s={:.3} realtime_factor={:.2}", video_filter_chain(config, edl, source_size).split(',').filter(|value| !value.is_empty()).count(), audio_filters(edl).split(',').filter(|value| !value.is_empty()).count(), started.elapsed().as_secs_f64(), edited as f64 / 1_000_000.0 / started.elapsed().as_secs_f64().max(0.001));
        let regions = analyze_render_regions(edl, duration_us);
        eprintln!("CHETO_EXPORT_PROFILE regions={} unchanged={} removed={} camera={} audio={} camera_audio={} (preanalysis only; no stream copy)", regions.len(), regions.iter().filter(|item| item.2 == RenderRegionKind::Unchanged).count(), regions.iter().filter(|item| item.2 == RenderRegionKind::Removed).count(), regions.iter().filter(|item| item.2 == RenderRegionKind::Camera).count(), regions.iter().filter(|item| item.2 == RenderRegionKind::Audio).count(), regions.iter().filter(|item| item.2 == RenderRegionKind::CameraAudio).count());
        for line in diagnostics.lines().filter(|line| line.contains("bench:")) {
            eprintln!("CHETO_EXPORT_PROFILE {line}");
        }
    }
    if cancelled {
        let _ = fs::remove_file(&temporary);
        return Err(ExportError::new(
            "export-cancelled",
            "Exportación cancelada.",
        ));
    }
    let status = status.map_err(|error| {
        let _ = fs::remove_file(&temporary);
        ExportError::new("ffmpeg-wait", error.to_string())
    })?;
    if !status.success() {
        let _ = fs::remove_file(&temporary);
        return Err(ExportError::new(
            "ffmpeg-failed",
            diagnostics
                .lines()
                .rev()
                .take(8)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n"),
        ));
    }
    publish_output(&temporary, &output)?;
    Ok(())
}

fn publish_output(temporary: &Path, output: &Path) -> Result<(), ExportError> {
    let backup = output.with_file_name(format!(
        ".{}.{}.bak",
        output
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("export"),
        Uuid::new_v4()
    ));
    let had_previous = output.exists();
    if had_previous {
        fs::rename(output, &backup)
            .map_err(|e| ExportError::new("output-backup", e.to_string()))?;
    }
    if let Err(error) = fs::rename(temporary, output) {
        if had_previous {
            let _ = fs::rename(&backup, output);
        }
        let _ = fs::remove_file(temporary);
        return Err(ExportError::new("output-publish", error.to_string()));
    }
    if had_previous {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn source_at_edited(edl: &EdlManifest, edited_us: u64, source_duration_us: u64) -> u64 {
    if edited_us == edited_duration(edl, source_duration_us) {
        let mut endpoint = source_duration_us;
        loop {
            let Some(start) = edl
                .tracks
                .cuts
                .iter()
                .filter(|item| {
                    item.action == "remove" && item.start_us < endpoint && item.end_us >= endpoint
                })
                .map(|item| item.start_us)
                .min()
            else {
                break;
            };
            endpoint = start;
        }
        return endpoint;
    }
    let mut removed: Vec<_> = edl
        .tracks
        .cuts
        .iter()
        .filter(|item| item.action == "remove")
        .map(|item| (item.start_us, item.end_us))
        .collect();
    removed.sort_unstable();
    let mut source = 0_u64;
    let mut edited = 0_u64;
    for (start, end) in removed {
        if end <= source {
            continue;
        }
        let kept = start.saturating_sub(source);
        if edited_us < edited.saturating_add(kept) {
            return (source + edited_us - edited).min(source_duration_us);
        }
        edited = edited.saturating_add(kept);
        source = source.max(end);
    }
    (source + edited_us.saturating_sub(edited)).min(source_duration_us)
}

fn localize_edl(edl: &EdlManifest, source_start: u64, source_end: u64) -> EdlManifest {
    let mut local = edl.clone();
    local.manual_trim = None;
    local.manual_split_points_us.clear();
    local.source_duration_us = Some(source_end.saturating_sub(source_start));
    local
        .tracks
        .cuts
        .retain(|item| item.end_us > source_start && item.start_us < source_end);
    for item in &mut local.tracks.cuts {
        item.start_us = item.start_us.saturating_sub(source_start);
        item.end_us = item.end_us.min(source_end) - source_start;
    }
    local
        .tracks
        .camera
        .retain(|item| item.end_us > source_start && item.start_us < source_end);
    for item in &mut local.tracks.camera {
        let started_before = item.start_us < source_start;
        item.start_us = item.start_us.saturating_sub(source_start);
        item.end_us = item.end_us.min(source_end) - source_start;
        if started_before {
            item.transition_us = Some(0);
        }
    }
    local
        .tracks
        .audio
        .retain(|item| item.end_us > source_start && item.start_us < source_end);
    for item in &mut local.tracks.audio {
        item.start_us = item.start_us.saturating_sub(source_start);
        item.end_us = item.end_us.min(source_end) - source_start;
    }
    local
        .tracks
        .assets
        .retain(|item| item.end_us > source_start && item.start_us < source_end);
    for item in &mut local.tracks.assets {
        let elapsed = source_start.saturating_sub(item.start_us);
        if elapsed > 0 {
            item.preview_input_offset_us = Some(if item.loop_ && item.source_duration_us > 0 {
                elapsed % item.source_duration_us
            } else {
                elapsed
            });
            item.fade_in_us = 0;
        }
        item.start_us = item.start_us.saturating_sub(source_start);
        item.end_us = item.end_us.min(source_end) - source_start;
    }
    local
        .tracks
        .titles
        .retain(|item| item.end_us > source_start && item.start_us < source_end);
    for item in &mut local.tracks.titles {
        if item.start_us < source_start {
            item.animation_in_us = 0;
        }
        item.start_us = item.start_us.saturating_sub(source_start);
        item.end_us = item.end_us.min(source_end) - source_start;
    }
    local
        .tracks
        .transitions
        .retain(|item| item.at_us >= source_start && item.at_us < source_end);
    for item in &mut local.tracks.transitions {
        item.at_us -= source_start;
    }
    local
}

fn trim_preview_cache(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|v| v.to_str()) != Some("mp4") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            Some((path, metadata.modified().ok()?, metadata.len()))
        })
        .collect();
    files.sort_by_key(|(_, modified, _)| *modified);
    let mut total: u64 = files.iter().map(|(_, _, size)| *size).sum();
    while files.len() > 8 || total > 600_000_000 {
        let (path, _, size) = files.remove(0);
        total = total.saturating_sub(size);
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub async fn render_result_chunk(
    app: AppHandle,
    manager: tauri::State<'_, PreviewManager>,
    request: PreviewRequest,
) -> Result<PreviewChunk, ExportError> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        if request.request_id > 0 {
            let mut latest = manager.latest_request.lock().unwrap();
            let entry = latest.entry(request.project_id.clone()).or_default();
            if request.request_id < *entry {
                return Err(ExportError::new("preview-cancelled", "Solicitud obsoleta."));
            }
            *entry = request.request_id;
        }
        let storage = ProjectStorage::from_app(&app)
            .map_err(|error| ExportError::new("storage", error.message))?;
        let bundle = storage
            .load_project(&request.project_id)
            .map_err(|error| ExportError::new("project", error.message))?;
        let duration = bundle
            .source
            .duration_us
            .ok_or_else(|| ExportError::new("duration", "Duración de fuente desconocida"))?;
        if request.edl.project_id != bundle.edl.project_id
            || request.edl.source_id != bundle.edl.source_id
        {
            return Err(ExportError::new(
                "preview-edl",
                "El EDL ya no pertenece a esta fuente.",
            ));
        }
        let edl = request.edl;
        let total = edited_duration(&edl, duration);
        let start = request.start_us.min(total.saturating_sub(1));
        let length = 15_000_000_u64.min(total.saturating_sub(start));
        if length == 0
            || request.width < 160
            || request.width > 1920
            || request.height < 90
            || request.height > 1080
            || !request.fps.is_finite()
            || request.fps <= 0.0
            || request.fps > 60.0
        {
            return Err(ExportError::new(
                "preview-range",
                "Rango o tamaño de preview inválido",
            ));
        }
        let source_start = source_at_edited(&edl, start, duration);
        let source_end = source_at_edited(&edl, start + length, duration);
        let local = localize_edl(&edl, source_start, source_end.max(source_start + 1));
        let camera_samples = camera_render_samples(&local, source_start);
        let mut hash = DefaultHasher::new();
        crate::template_engine::RENDERER_VERSION.hash(&mut hash);
        // The cache key uses the localized render interval. An edit in a different
        // chunk must not invalidate this chunk of a multi-hour project.
        let mut cache_edl = local.clone();
        cache_edl.updated_at.clear();
        serde_json::to_string(&cache_edl)
            .unwrap_or_default()
            .hash(&mut hash);
        bundle.source.path.hash(&mut hash);
        request.project_id.hash(&mut hash);
        bundle.source.source_id.hash(&mut hash);
        source_start.hash(&mut hash);
        source_end.hash(&mut hash);
        bundle.source.file_size_bytes.hash(&mut hash);
        request.width.hash(&mut hash);
        request.height.hash(&mut hash);
        request.fps.to_bits().hash(&mut hash);
        request.canvas_scale.to_bits().hash(&mut hash);
        request.canvas_offset_x.to_bits().hash(&mut hash);
        request.canvas_offset_y.to_bits().hash(&mut hash);
        request.fit_mode.hash(&mut hash);
        request.background_mode.hash(&mut hash);
        request.background_color.hash(&mut hash);
        start.hash(&mut hash);
        let dir = storage
            .project_dir(&request.project_id)
            .map_err(|error| ExportError::new("storage", error.message))?
            .join("media")
            .join("result-preview");
        fs::create_dir_all(&dir)
            .map_err(|error| ExportError::new("preview-cache", error.to_string()))?;
        let output = dir.join(format!("{:016x}.mp4", hash.finish()));
        if output.is_file() && fs::metadata(&output).map(|v| v.len()).unwrap_or(0) > 1024 {
            app.asset_protocol_scope()
                .allow_file(&output)
                .map_err(|error| {
                    ExportError::new(
                        "preview-scope",
                        format!("No se pudo autorizar el chunk: {error}"),
                    )
                })?;
            return Ok(PreviewChunk {
                project_id: request.project_id.clone(),
                source_id: bundle.source.source_id.clone(),
                source_path: bundle.source.path.clone(),
                edl_revision: edl.updated_at.clone(),
                output_bytes: fs::metadata(&output).map(|v| v.len()).unwrap_or(0),
                ffmpeg_exit_code: None,
                camera_samples,
                path: output.to_string_lossy().into_owned(),
                start_us: start,
                duration_us: length,
                cache_hit: true,
                source_duration_us: duration,
                elapsed_ms: started.elapsed().as_millis(),
                realtime_factor: None,
            });
        }
        let temporary = dir.join(format!("{}.partial.mp4", Uuid::new_v4()));
        let config = ExportConfig {
            project_id: request.project_id.clone(),
            output_path: temporary.to_string_lossy().into_owned(),
            width: request.width,
            height: request.height,
            fps: request.fps,
            bitrate: "low".into(),
            include_audio: true,
            aspect_ratio: request.width as f64 / request.height as f64,
            canvas_scale: request.canvas_scale,
            canvas_offset_x: request.canvas_offset_x,
            canvas_offset_y: request.canvas_offset_y,
            fit_mode: request.fit_mode.clone(),
            background_mode: request.background_mode.clone(),
            background_color: request.background_color.clone(),
            preset: "fast".into(),
            preview_source_start_us: source_start,
            preview_duration_us: Some(length),
        };
        validate(&config, &local, source_end.saturating_sub(source_start))?;
        visual_render::prepare_assets(&local)
            .map_err(|error| ExportError::new("title-assets", error))?;
        let size = (
            bundle
                .source
                .video
                .display_width
                .or(bundle.source.video.width)
                .unwrap_or(0) as u32,
            bundle
                .source
                .video
                .display_height
                .or(bundle.source.video.height)
                .unwrap_or(0) as u32,
        );
        let mut cmd = command(
            &config,
            Path::new(&bundle.source.path),
            &local,
            "libx264",
            size,
            bundle.source.streams.audio > 0,
        );
        let command_line = format!(
            "{} {}",
            cmd.get_program().to_string_lossy(),
            cmd.get_args().map(|arg| format!("{:?}", arg)).collect::<Vec<_>>().join(" ")
        );
        let mut child = cmd
            .spawn()
            .map_err(|error| ExportError::new("preview-start", error.to_string()))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let progress_task = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(mut stream) = stdout {
                let _ = std::io::Read::read_to_end(&mut stream, &mut bytes);
            }
            bytes
        });
        let error_task = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(mut stream) = stderr {
                let _ = std::io::Read::read_to_end(&mut stream, &mut bytes);
            }
            bytes
        });
        let token = Uuid::new_v4();
        let child = Arc::new(Mutex::new(child));
        let latest_guard = manager.latest_request.lock().unwrap();
        if request.request_id > 0 && latest_guard.get(&request.project_id).is_some_and(|latest| request.request_id < *latest) {
            drop(latest_guard);
            let _ = child.lock().unwrap().kill();
            let _ = progress_task.join();
            let _ = error_task.join();
            let _ = fs::remove_file(&temporary);
            return Err(ExportError::new("preview-cancelled", "Solicitud obsoleta."));
        }
        let previous = manager
            .active
            .lock()
            .unwrap()
            .insert(request.project_id.clone(), (token, child.clone()));
        drop(latest_guard);
        if let Some((previous_token, previous)) = previous {
            manager.cancelled.lock().unwrap().insert(previous_token);
            let _ = previous.lock().unwrap().kill();
        }
        let rendered = loop {
            match child.lock().unwrap().try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(error) => break Err(error),
            }
        };
        let progress_text = progress_task.join().unwrap_or_default();
        let error_text = error_task.join().unwrap_or_default();
        let was_cancelled = manager.cancelled.lock().unwrap().remove(&token);
        if manager
            .active
            .lock()
            .unwrap()
            .get(&request.project_id)
            .is_some_and(|(id, _)| *id == token)
        {
            manager.active.lock().unwrap().remove(&request.project_id);
        }
        let result =
            rendered.map_err(|error| ExportError::new("preview-wait", error.to_string()))?;
        if was_cancelled {
            let _ = fs::remove_file(&temporary);
            return Err(ExportError::new("preview-cancelled", "La solicitud de Resultado fue reemplazada."));
        }
        if !result.success() {
            let output_bytes = fs::metadata(&temporary).map(|value| value.len()).unwrap_or(0);
            let diagnostic = format!(
                "FFmpeg exitCode={:?} executable={} args={} inputOriginal={} inputProxy={} output={} outputExists={} outputBytes={} filterChain={} startUs={} durationUs={} projectId={} edlRevision={} stderr={} stdout={}",
                result.code(), cmd.get_program().to_string_lossy(), command_line,
                bundle.source.path, dir.parent().unwrap_or(&dir).join("proxy.mp4").display(),
                temporary.display(), temporary.exists(), output_bytes,
                video_filter_chain(&config, &local, size), source_start, length,
                request.project_id, edl.updated_at,
                String::from_utf8_lossy(&error_text).trim(),
                String::from_utf8_lossy(&progress_text).trim()
            );
            eprintln!("RESULT_PREVIEW_FAILED {diagnostic}");
            let _ = fs::remove_file(&temporary);
            return Err(ExportError::new(
                "preview-render",
                diagnostic,
            ));
        }
        fs::rename(&temporary, &output)
            .map_err(|error| ExportError::new("preview-cache", error.to_string()))?;
        app.asset_protocol_scope()
            .allow_file(&output)
            .map_err(|error| {
                ExportError::new(
                    "preview-scope",
                    format!("No se pudo autorizar el chunk: {error}"),
                )
            })?;
        trim_preview_cache(&dir);
        let elapsed_ms = started.elapsed().as_millis();
        Ok(PreviewChunk {
            project_id: request.project_id.clone(),
            source_id: bundle.source.source_id.clone(),
            source_path: bundle.source.path.clone(),
            edl_revision: edl.updated_at.clone(),
            output_bytes: fs::metadata(&output).map(|v| v.len()).unwrap_or(0),
            ffmpeg_exit_code: result.code(),
            camera_samples,
            path: output.to_string_lossy().into_owned(),
            start_us: start,
            duration_us: length,
            cache_hit: false,
            source_duration_us: duration,
            elapsed_ms,
            realtime_factor: Some(length as f64 / 1_000.0 / elapsed_ms.max(1) as f64),
        })
    })
    .await
    .map_err(|error| ExportError::new("preview-task", error.to_string()))?
}

#[tauri::command]
pub fn cancel_result_preview(manager: tauri::State<'_, PreviewManager>, project_id: String) {
    let active = manager.active.lock().unwrap().remove(&project_id);
    if let Some((token, child)) = active {
        manager.cancelled.lock().unwrap().insert(token);
        let _ = child.lock().unwrap().kill();
    }
}

#[tauri::command]
pub async fn start_export(
    app: AppHandle,
    manager: tauri::State<'_, ExportManager>,
    config: ExportConfig,
) -> Result<ExportResult, ExportError> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let storage =
            ProjectStorage::from_app(&app).map_err(|e| ExportError::new("storage", e.message))?;
        let bundle = storage
            .load_project(&config.project_id)
            .map_err(|e| ExportError::new("project", e.message))?;
        let duration = bundle
            .source
            .duration_us
            .ok_or_else(|| ExportError::new("duration", "La fuente no tiene duración válida."))?;
        validate(&config, &bundle.edl, duration)?;
        let source = PathBuf::from(&bundle.source.path);
        if !source.is_file() {
            return Err(ExportError::new(
                "source-missing",
                "El archivo fuente no existe.",
            ));
        }
        if Path::new(&config.output_path).is_file()
            && fs::canonicalize(&source).ok() == fs::canonicalize(&config.output_path).ok()
        {
            return Err(ExportError::new(
                "source-output-same",
                "La salida no puede sustituir el archivo fuente original.",
            ));
        }
        if config.include_audio
            && bundle.source.streams.audio > 0
            && bundle.edl.audio_on_timeline != Some(false)
        {
            let selected_stream = selected_audio_stream(&bundle.edl);
            if selected_stream >= bundle.source.streams.audio as usize {
                return Err(ExportError::new(
                    "invalid-audio-stream",
                    "La pista de audio seleccionada ya no existe en la fuente.",
                ));
            }
        }
        let edited = edited_duration(&bundle.edl, duration);
        let _ = app.emit(
            "export-progress",
            ExportProgress {
                project_id: config.project_id.clone(),
                stage: "preparing".into(),
                progress: 0.0,
                processed_us: 0,
                duration_us: edited,
            },
        );
        let encoder = choose_encoder(nvenc_capabilities().1, &config.preset);
        let source_size = (
            bundle
                .source
                .video
                .display_width
                .or(bundle.source.video.width)
                .unwrap_or(0) as u32,
            bundle
                .source
                .video
                .display_height
                .or(bundle.source.video.height)
                .unwrap_or(0) as u32,
        );
        let mut export_edl = bundle.edl.clone();
        let loop_cache = storage
            .project_dir(&config.project_id)
            .map_err(|error| ExportError::new("storage", error.message))?
            .join("media")
            .join("music-loop");
        for item in &mut export_edl.tracks.assets {
            if item.kind == "music" && item.loop_ && !item.muted {
                let (path, cycle_us) = seamless_music_loop(
                    Path::new(&item.asset_path),
                    item.source_duration_us,
                    &loop_cache,
                )
                .map_err(|error| ExportError::new("music-loop", error))?;
                item.asset_path = path.to_string_lossy().into_owned();
                item.source_duration_us = cycle_us;
            }
        }
        let used = match render(
            &app,
            &manager,
            &config,
            &source,
            &export_edl,
            duration,
            encoder,
            source_size,
            bundle.source.streams.audio > 0,
        ) {
            Ok(()) => encoder,
            Err(e) if should_retry_on_cpu(encoder, &e) => {
                render(
                    &app,
                    &manager,
                    &config,
                    &source,
                    &export_edl,
                    duration,
                    "libx264",
                    source_size,
                    bundle.source.streams.audio > 0,
                )?;
                "libx264"
            }
            Err(e) => return Err(e),
        };
        let size = fs::metadata(&config.output_path)
            .map(|v| v.len())
            .unwrap_or(0);
        let _ = app.emit(
            "export-progress",
            ExportProgress {
                project_id: config.project_id.clone(),
                stage: "completed".into(),
                progress: 100.0,
                processed_us: edited,
                duration_us: edited,
            },
        );
        Ok(ExportResult {
            output_path: config.output_path,
            encoder: used.into(),
            file_size_bytes: size,
            duration_us: edited,
        })
    })
    .await
    .map_err(|e| ExportError::new("export-task", e.to_string()))?
}

#[tauri::command]
pub fn cancel_export(
    manager: tauri::State<'_, ExportManager>,
    project_id: String,
) -> Result<bool, ExportError> {
    Ok(stop_active_export(manager.inner(), &project_id))
}

fn stop_active_export(manager: &ExportManager, project_id: &str) -> bool {
    if let Some(child) = manager.active.lock().unwrap().remove(project_id) {
        manager
            .cancelled
            .lock()
            .unwrap()
            .insert(project_id.to_owned());
        let mut child = child.lock().unwrap();
        let _ = child.kill();
        true
    } else {
        false
    }
}
#[tauri::command]
pub fn open_export_file(path: String) -> Result<(), ExportError> {
    let value = PathBuf::from(path);
    if !value.is_file() {
        return Err(ExportError::new(
            "output-missing",
            "El archivo exportado ya no existe.",
        ));
    }
    Command::new("explorer")
        .arg(value)
        .spawn()
        .map_err(|e| ExportError::new("open-failed", e.to_string()))?;
    Ok(())
}
#[tauri::command]
pub fn reveal_export_file(path: String) -> Result<(), ExportError> {
    let value = PathBuf::from(path);
    if !value.is_file() {
        return Err(ExportError::new(
            "output-missing",
            "El archivo exportado ya no existe.",
        ));
    }
    Command::new("explorer")
        .arg(format!("/select,{}", value.display()))
        .spawn()
        .map_err(|e| ExportError::new("open-failed", e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_storage::CutDecision;
    fn neutral_edl() -> EdlManifest {
        serde_json::from_str(r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":30000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#).unwrap()
    }
    fn neutral_config() -> ExportConfig {
        ExportConfig {
            project_id: "p".into(),
            output_path: "out.mp4".into(),
            width: 1280,
            height: 720,
            fps: 30.0,
            bitrate: "medium".into(),
            include_audio: true,
            aspect_ratio: 16.0 / 9.0,
            canvas_scale: 1.0,
            canvas_offset_x: 0.0,
            canvas_offset_y: 0.0,
            fit_mode: default_fit_mode(),
            background_mode: default_background_mode(),
            background_color: default_background_color(),
            preset: "balanced".into(),
            preview_source_start_us: 0,
            preview_duration_us: None,
        }
    }

    #[test]
    fn qa7_result_chunk_incremental_filters_on_confirmed_source() {
        let Ok(path) = std::env::var("CHETO_QA_VIDEO") else {
            return;
        };
        let source = Path::new(&path);
        let dir = tempfile::tempdir().unwrap();
        for stage in ["source", "canvas", "camera", "titles", "audio", "combined"] {
            let mut edl = neutral_edl();
            edl.source_duration_us = Some(206_329_705);
            if matches!(stage, "camera" | "combined") {
                edl.tracks.camera.push(CameraDecision {
                    id: "qa7-camera".into(),
                    start_us: 16_000_000,
                    end_us: 29_000_000,
                    mode: "zoom".into(),
                    zoom: Some(1.3),
                    center_x: Some(0.55),
                    center_y: Some(0.45),
                    easing: Some("ease_in_out".into()),
                    reason: None,
                    confidence: None,
                    transition_us: Some(500_000),
                    automation: None,
                });
            }
            if matches!(stage, "titles" | "combined") {
                edl.tracks.titles.push(
                    serde_json::from_value(serde_json::json!({
                        "id":"qa7-title","presetId":"whisper-fade","text":"QA7","secondaryText":"",
                        "startUs":17_000_000,"endUs":24_000_000,"positionX":0.5,"positionY":0.5,
                        "anchor":"center","scale":1.0,"font":"Inter","fontWeight":700,"fontSize":80,
                        "color":"#FFFFFF","accentColor":"#34D5E5","alignment":"center","tracking":0,
                        "lineHeight":1.15,"opacity":1.0,"safeArea":0.06,"animationInUs":200_000,
                        "animationOutUs":200_000,"easing":"ease-out","background":false
                    }))
                    .unwrap(),
                );
            }
            if matches!(stage, "audio" | "combined") {
                edl.tracks.audio.push(AudioDecision {
                    id: "qa7-noise".into(),
                    start_us: 16_000_000,
                    end_us: 29_000_000,
                    operation: "noise_reduction_range".into(),
                    parameters: serde_json::json!({"amount":0.8}),
                });
            }
            let local = localize_edl(&edl, 15_000_000, 30_000_000);
            visual_render::prepare_assets(&local).unwrap();
            let mut config = neutral_config();
            config.output_path = dir
                .path()
                .join(format!("{stage}.mp4"))
                .to_string_lossy()
                .into_owned();
            config.width = 320;
            config.height = 180;
            config.fps = 30.0;
            config.preview_source_start_us = 15_000_000;
            config.preview_duration_us = Some(15_000_000);
            if matches!(stage, "canvas" | "combined") {
                config.canvas_scale = 1.15;
            }
            let output = command(&config, source, &local, "libx264", (1280, 720), true)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "stage={stage} exit={:?} stderr={} stdout={}",
                output.status.code(),
                String::from_utf8_lossy(&output.stderr),
                String::from_utf8_lossy(&output.stdout)
            );
            assert!(
                fs::metadata(&config.output_path).unwrap().len() > 1024,
                "{stage}"
            );
        }
    }

    #[test]
    fn qa7_trim_end_maps_to_last_kept_source_frame() {
        let mut edl = neutral_edl();
        edl.source_duration_us = Some(60_000_000);
        edl.manual_trim = Some(crate::project_storage::ManualTrim {
            source_in_us: 10_000_000,
            source_out_us: 40_000_000,
        });
        edl.tracks.cuts.push(CutDecision {
            id: "trim-start".into(),
            start_us: 0,
            end_us: 10_000_000,
            action: "remove".into(),
            confidence: None,
            reason: None,
            automation: None,
        });
        edl.tracks.cuts.push(CutDecision {
            id: "trim-end".into(),
            start_us: 40_000_000,
            end_us: 60_000_000,
            action: "remove".into(),
            confidence: None,
            reason: None,
            automation: None,
        });
        assert_eq!(edited_duration(&edl, 60_000_000), 30_000_000);
        assert_eq!(source_at_edited(&edl, 0, 60_000_000), 10_000_000);
        assert_eq!(source_at_edited(&edl, 30_000_000, 60_000_000), 40_000_000);
    }

    #[test]
    fn qa7_trim_renders_thirty_seconds_on_confirmed_source() {
        let Ok(path) = std::env::var("CHETO_QA_VIDEO") else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let mut edl = neutral_edl();
        edl.source_duration_us = Some(206_329_705);
        edl.manual_trim = Some(crate::project_storage::ManualTrim {
            source_in_us: 10_000_000,
            source_out_us: 40_000_000,
        });
        edl.tracks.cuts.push(CutDecision {
            id: "manual-trim-start".into(),
            start_us: 0,
            end_us: 10_000_000,
            action: "remove".into(),
            confidence: None,
            reason: None,
            automation: None,
        });
        edl.tracks.cuts.push(CutDecision {
            id: "manual-trim-end".into(),
            start_us: 40_000_000,
            end_us: 206_329_705,
            action: "remove".into(),
            confidence: None,
            reason: None,
            automation: None,
        });
        let mut config = neutral_config();
        config.output_path = dir
            .path()
            .join("trimmed.mp4")
            .to_string_lossy()
            .into_owned();
        config.width = 320;
        config.height = 180;
        config.fps = 30.0;
        let result = command(
            &config,
            Path::new(&path),
            &edl,
            "libx264",
            (1280, 720),
            true,
        )
        .output()
        .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let probe = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
            ])
            .arg(&config.output_path)
            .output()
            .unwrap();
        assert!(probe.status.success());
        let seconds: f64 = String::from_utf8_lossy(&probe.stdout)
            .trim()
            .parse()
            .unwrap();
        assert!((seconds - 30.0).abs() < 0.2, "rendered duration={seconds}");
    }
    #[test]
    fn horizontal_source_supports_vertical_and_square_fit_modes() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("red-horizontal.mp4");
        let generated = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=640x360:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(generated.status.success());
        for (name, width, height, fit, background, color) in [
            ("vertical-cover", 180, 320, "cover", "black", "#000000"),
            ("vertical-contain", 180, 320, "contain", "black", "#000000"),
            (
                "vertical-center-black",
                180,
                320,
                "center",
                "black",
                "#000000",
            ),
            (
                "vertical-center-blue",
                180,
                320,
                "center",
                "color",
                "#0000FF",
            ),
            (
                "vertical-center-blur",
                180,
                320,
                "center",
                "blur",
                "#000000",
            ),
            ("square-cover", 320, 320, "cover", "black", "#000000"),
            ("square-contain", 320, 320, "contain", "black", "#000000"),
            ("square-center", 320, 320, "center", "black", "#000000"),
        ] {
            let mut config = neutral_config();
            config.output_path = dir
                .path()
                .join(format!("{name}.mp4"))
                .to_string_lossy()
                .into_owned();
            config.width = width;
            config.height = height;
            config.aspect_ratio = width as f64 / height as f64;
            config.include_audio = false;
            config.fit_mode = fit.into();
            config.background_mode = background.into();
            config.background_color = color.into();
            let result = command(
                &config,
                &source,
                &neutral_edl(),
                "libx264",
                (640, 360),
                false,
            )
            .output()
            .unwrap();
            assert!(
                result.status.success(),
                "{name}: {}",
                String::from_utf8_lossy(&result.stderr)
            );
            let raw = Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(&config.output_path)
                .args(["-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"])
                .output()
                .unwrap();
            assert!(raw.status.success());
            let pixel = |x: usize, y: usize| {
                let offset = (y * width as usize + x) * 3;
                &raw.stdout[offset..offset + 3]
            };
            let corner = pixel(2, 2);
            let middle = pixel(width as usize / 2, height as usize / 2);
            assert!(middle[0] > 130, "{name}: center must show video");
            if fit == "cover" {
                assert!(corner[0] > 130, "{name}: cover must fill canvas");
            } else if background == "color" {
                assert!(corner[2] > 100, "{name}: color background missing");
            } else if background == "blur" {
                assert!(corner[0] > 50, "{name}: blurred video background missing");
            } else {
                assert!(
                    corner.iter().all(|value| *value < 30),
                    "{name}: expected empty black margin"
                );
            }
        }
        let mut moved = neutral_config();
        moved.output_path = dir
            .path()
            .join("vertical-contain-bottom.mp4")
            .to_string_lossy()
            .into_owned();
        moved.width = 180;
        moved.height = 320;
        moved.aspect_ratio = 180.0 / 320.0;
        moved.fit_mode = "contain".into();
        moved.canvas_offset_y = 1.0;
        moved.include_audio = false;
        let result = command(
            &moved,
            &source,
            &neutral_edl(),
            "libx264",
            (640, 360),
            false,
        )
        .output()
        .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let raw = Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&moved.output_path)
            .args(["-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"])
            .output()
            .unwrap();
        assert!(raw.status.success());
        let red_at = |y: usize| raw.stdout[(y * 180 + 90) * 3];
        assert!(
            red_at(120) < 30 && red_at(270) > 130,
            "Manual Y did not move the contained video"
        );
    }
    #[test]
    fn neutral_export_avoids_video_filtergraph_and_selects_encoder() {
        let edl = neutral_edl();
        let config = neutral_config();
        assert_eq!(video_filter_chain(&config, &edl, (1280, 720)), "");
        let args: Vec<_> = command(
            &config,
            Path::new("in.mp4"),
            &edl,
            "libx264",
            (1280, 720),
            true,
        )
        .get_args()
        .map(|value| value.to_string_lossy().into_owned())
        .collect();
        assert!(!args
            .iter()
            .any(|arg| arg == "-vf" || arg == "-filter_complex" || arg == "-af"));
        assert_eq!(choose_encoder(true, "fast"), "h264_nvenc");
        assert_eq!(choose_encoder(true, "balanced"), "h264_nvenc");
        assert_eq!(choose_encoder(true, "high"), "libx264");
        assert_eq!(choose_encoder(false, "fast"), "libx264");
        assert!(should_retry_on_cpu(
            "h264_nvenc",
            &ExportError::new("ffmpeg-failed", "encoder unavailable")
        ));
        assert!(!should_retry_on_cpu(
            "h264_nvenc",
            &ExportError::new("export-cancelled", "cancelled")
        ));
    }
    #[test]
    fn preview_seeks_in_edited_time_and_localizes_tracks() {
        let mut edl = neutral_edl();
        edl.tracks.cuts.push(CutDecision {
            id: "cut".into(),
            start_us: 2_000_000,
            end_us: 4_000_000,
            action: "remove".into(),
            reason: None,
            confidence: None,
            automation: None,
        });
        assert_eq!(source_at_edited(&edl, 1_000_000, 30_000_000), 1_000_000);
        assert_eq!(source_at_edited(&edl, 2_000_000, 30_000_000), 4_000_000);
        assert_eq!(source_at_edited(&edl, 7_000_000, 30_000_000), 9_000_000);
        let local = localize_edl(&edl, 4_000_000, 10_000_000);
        assert!(local.tracks.cuts.is_empty());
        assert_eq!(local.source_duration_us, Some(6_000_000));
    }
    #[test]
    fn render_preanalysis_separates_regions_without_stream_copy() {
        let mut edl = neutral_edl();
        edl.tracks.cuts.push(CutDecision {
            id: "cut".into(),
            start_us: 5_000_000,
            end_us: 8_000_000,
            action: "remove".into(),
            confidence: None,
            reason: None,
            automation: None,
        });
        edl.tracks.camera.push(CameraDecision {
            id: "zoom".into(),
            start_us: 10_000_000,
            end_us: 12_000_000,
            mode: "zoom".into(),
            zoom: Some(1.2),
            center_x: Some(0.5),
            center_y: Some(0.5),
            easing: None,
            reason: None,
            confidence: None,
            transition_us: None,
            automation: None,
        });
        let regions = analyze_render_regions(&edl, 30_000_000);
        assert!(regions
            .iter()
            .any(|item| item.2 == RenderRegionKind::Removed));
        assert!(regions
            .iter()
            .any(|item| item.2 == RenderRegionKind::Camera));
        assert!(regions
            .iter()
            .any(|item| item.2 == RenderRegionKind::Unchanged));
        assert!(video_filter_chain(&neutral_config(), &edl, (1280, 720)).contains("select="));
    }
    #[test]
    fn publication_preserves_previous_export_on_failure() {
        let id = Uuid::new_v4();
        let output = std::env::temp_dir().join(format!("cheto-publish-{id}.mp4"));
        let temporary = std::env::temp_dir().join(format!("cheto-publish-temp-{id}.mp4"));
        fs::write(&output, b"previous").unwrap();
        assert!(publish_output(&temporary, &output).is_err());
        assert_eq!(fs::read(&output).unwrap(), b"previous");
        fs::write(&temporary, b"new").unwrap();
        publish_output(&temporary, &output).unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"new");
        fs::remove_file(output).unwrap();
    }
    #[test]
    fn cancellation_terminates_the_active_ffmpeg_process() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let manager = ExportManager::default();
        let mut process = Command::new("ffmpeg");
        process
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-re",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30",
                "-t",
                "30",
                "-f",
                "null",
                "-",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_console(&mut process);
        let child = Arc::new(Mutex::new(process.spawn().unwrap()));
        manager
            .active
            .lock()
            .unwrap()
            .insert("test".into(), child.clone());
        assert!(stop_active_export(&manager, "test"));
        assert!(!stop_active_export(&manager, "test"));
        assert!(manager.cancelled.lock().unwrap().contains("test"));
        assert!(!child.lock().unwrap().wait().unwrap().success());
    }
    #[test]
    fn edited_duration_merges_overlaps() {
        let mut edl:EdlManifest=serde_json::from_str(r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":100,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[{"id":"a","startUs":10,"endUs":30,"action":"remove","reason":null,"confidence":1},{"id":"b","startUs":20,"endUs":40,"action":"remove","reason":null,"confidence":1}],"camera":[],"broll":[],"audio":[]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#).unwrap();
        assert_eq!(edited_duration(&edl, 100), 70);
        edl.tracks.cuts.clear();
        assert_eq!(edited_duration(&edl, 100), 100);
    }

    #[test]
    fn audio_filters_use_adjustable_parameters() {
        let edl: EdlManifest = serde_json::from_str(
            r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":3000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[{"id":"n","startUs":0,"endUs":3000000,"operation":"noise_reduction","parameters":{"amount":0.75}},{"id":"h","startUs":0,"endUs":3000000,"operation":"hum_filter","parameters":{"hz":60}},{"id":"l","startUs":0,"endUs":3000000,"operation":"peak_limiter","parameters":{"limit":0.94}},{"id":"p","startUs":1000000,"endUs":2000000,"operation":"notch_range","parameters":{"hz":4200,"width":80}}]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#,
        )
        .unwrap();

        let filters = audio_filters(&edl);
        assert!(filters.contains("afftdn=nr=13.0:nf=-35"));
        assert!(filters.contains("bandreject=f=60"));
        assert!(filters.contains("alimiter=limit=0.94"));
        assert!(filters.contains("bandreject=f=4200"));
        assert!(filters.contains("between(t,1.000000,2.000000)"));
    }

    #[test]
    fn selected_audio_stream_defaults_to_first_and_reads_edl_choice() {
        let default_edl: EdlManifest = serde_json::from_str(
            r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":100,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#,
        )
        .unwrap();
        assert_eq!(selected_audio_stream(&default_edl), 0);
        assert_eq!(default_edl.source_on_timeline, None);
        assert_eq!(default_edl.audio_on_timeline, None);
        let mut removed = default_edl.clone();
        removed.source_on_timeline = Some(false);
        removed.audio_on_timeline = Some(false);
        assert!(audio_filters(&removed).contains("volume=0"));

        let selected: EdlManifest = serde_json::from_str(
            r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":100,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[{"id":"stream","startUs":0,"endUs":100,"operation":"source_stream","parameters":{"index":2}}]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#,
        )
        .unwrap();
        assert_eq!(selected_audio_stream(&selected), 2);
    }

    #[test]
    fn preview_and_export_share_gain_fades_normalization_and_voice_filters() {
        let edl: EdlManifest = serde_json::from_str(
            r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":10000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[{"id":"gain","startUs":0,"endUs":10000000,"operation":"master_gain","parameters":{"gainDb":3}},{"id":"in","startUs":0,"endUs":10000000,"operation":"fade_in","parameters":{"durationUs":500000}},{"id":"out","startUs":0,"endUs":10000000,"operation":"fade_out","parameters":{"durationUs":500000}},{"id":"norm","startUs":0,"endUs":10000000,"operation":"normalize","parameters":{}},{"id":"voice","startUs":0,"endUs":10000000,"operation":"voice_focus","parameters":{"amount":0.5}}]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#,
        ).unwrap();
        let filters = audio_filters(&edl);
        assert_eq!(filters, audio_filters_from(&edl, 0));
        assert!(filters.contains("volume=3dB"));
        assert!(filters.contains("highpass=f=90"));
        assert!(filters.contains("lowpass=f=11000"));
        assert!(filters.contains("loudnorm=I=-16"));
        assert!(filters.contains("afade=t=in:st=0.000000:d=0.500000"));
        assert!(filters.contains("afade=t=out:st=9.500000:d=0.500000"));
        assert!(audio_filters_from(&edl, 9_000_000).contains("afade=t=out:st=0.500000:d=0.500000"));
    }

    #[test]
    fn ffmpeg_command_renders_edl_when_available() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let suffix = std::process::id();
        let source = std::env::temp_dir().join(format!("cheto-export-source-{suffix}.mp4"));
        let output = std::env::temp_dir().join(format!("cheto-export-result-{suffix}.mp4"));
        let generated = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=24",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "3",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(generated.success());
        let edl:EdlManifest=serde_json::from_str(r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":3000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[{"id":"cut","startUs":500000,"endUs":1000000,"action":"remove","reason":null,"confidence":1}],"camera":[{"id":"cam","startUs":1000000,"endUs":2000000,"mode":"zoom","zoom":1.2,"centerX":0.6,"centerY":0.4,"easing":"linear","reason":null,"confidence":1,"transitionUs":200000}],"broll":[],"audio":[]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#).unwrap();
        let config = ExportConfig {
            project_id: "p".into(),
            output_path: output.to_string_lossy().into(),
            width: 320,
            height: 180,
            fps: 24.0,
            bitrate: "low".into(),
            include_audio: true,
            aspect_ratio: 16.0 / 9.0,
            canvas_scale: 1.0,
            canvas_offset_x: 0.0,
            canvas_offset_y: 0.0,
            fit_mode: default_fit_mode(),
            background_mode: default_background_mode(),
            background_color: default_background_color(),
            preset: "balanced".into(),
            preview_source_start_us: 0,
            preview_duration_us: None,
        };
        let mut without_audio = edl.clone();
        without_audio.audio_on_timeline = Some(false);
        assert!(command(
            &config,
            &source,
            &without_audio,
            "libx264",
            (320, 180),
            true
        )
        .get_args()
        .any(|arg| arg == "-an"));
        let mut without_video = edl.clone();
        without_video.source_on_timeline = Some(false);
        assert_eq!(
            validate(&config, &without_video, 3_000_000)
                .unwrap_err()
                .code,
            "empty-timeline"
        );
        let rendered = command(&config, &source, &edl, "libx264", (320, 180), true)
            .output()
            .unwrap();
        assert!(
            rendered.status.success(),
            "{}",
            String::from_utf8_lossy(&rendered.stderr)
        );
        assert!(fs::metadata(&output).is_ok_and(|value| value.len() > 0));
        if let Ok(probe) = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,duration",
                "-of",
                "csv=p=0",
            ])
            .arg(&output)
            .output()
        {
            assert!(probe.status.success());
            let streams = String::from_utf8_lossy(&probe.stdout);
            let durations: Vec<f64> = streams
                .lines()
                .filter_map(|line| line.split(',').find_map(|part| part.parse::<f64>().ok()))
                .collect();
            assert!(durations.len() >= 2);
            assert!(
                (durations[0] - durations[1]).abs() < 0.2,
                "A/V desincronizado: {streams}"
            );
        }
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(output);
    }

    #[test]
    fn result_preview_fixture_renders_playable_video_and_audio() {
        if Command::new("ffmpeg").arg("-version").output().is_err()
            || Command::new("ffprobe").arg("-version").output().is_err()
        {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.mp4");
        let output = dir.path().join("preview.mp4");
        let generated = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "3",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(generated.success());
        let mut config = neutral_config();
        config.output_path = output.to_string_lossy().into_owned();
        config.width = 320;
        config.height = 180;
        config.preview_source_start_us = 500_000;
        config.preview_duration_us = Some(1_500_000);
        let edl = neutral_edl();
        let rendered = command(&config, &source, &edl, "libx264", (320, 180), true)
            .output()
            .unwrap();
        assert!(
            rendered.status.success(),
            "{}",
            String::from_utf8_lossy(&rendered.stderr)
        );
        let probe = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,duration",
                "-of",
                "csv=p=0",
            ])
            .arg(&output)
            .output()
            .unwrap();
        assert!(
            probe.status.success(),
            "{}",
            String::from_utf8_lossy(&probe.stderr)
        );
        let streams = String::from_utf8_lossy(&probe.stdout);
        assert!(streams.lines().any(|line| line.starts_with("video,")));
        assert!(streams.lines().any(|line| line.starts_with("audio,")));
    }

    #[test]
    fn alternating_projects_render_their_own_video() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        for (project, color) in [("A", "red"), ("B", "blue")] {
            let source = dir.path().join(format!("{project}.mp4"));
            let generated = Command::new("ffmpeg")
                .args([
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                ])
                .arg(format!("color=c={color}:s=160x90:r=24:d=1"))
                .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
                .arg(&source)
                .status()
                .unwrap();
            assert!(generated.success());
        }
        let mut fingerprints = Vec::new();
        for (index, project) in ["A", "B", "A", "B"].iter().enumerate() {
            let source = dir.path().join(format!("{project}.mp4"));
            let output = dir.path().join(format!("preview-{index}.mp4"));
            let mut config = neutral_config();
            config.project_id = (*project).into();
            config.output_path = output.to_string_lossy().into_owned();
            config.width = 160;
            config.height = 90;
            config.fps = 24.0;
            config.include_audio = false;
            config.preview_duration_us = Some(500_000);
            let mut edl = neutral_edl();
            edl.project_id = (*project).into();
            let rendered = command(&config, &source, &edl, "libx264", (160, 90), false)
                .output()
                .unwrap();
            assert!(
                rendered.status.success(),
                "{}",
                String::from_utf8_lossy(&rendered.stderr)
            );
            let frame = Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(&output)
                .args(["-frames:v", "1", "-f", "md5", "-"])
                .output()
                .unwrap();
            assert!(frame.status.success());
            fingerprints.push(frame.stdout);
        }
        assert_eq!(fingerprints[0], fingerprints[2]);
        assert_eq!(fingerprints[1], fingerprints[3]);
        assert_ne!(fingerprints[0], fingerprints[1]);
    }

    #[test]
    fn three_template_families_match_result_preview_and_export_frames() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.mp4");
        let source_result = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x15202b:s=320x180:r=24:d=6",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            source_result.status.success(),
            "{}",
            String::from_utf8_lossy(&source_result.stderr)
        );
        let mut edl = neutral_edl();
        edl.source_duration_us = Some(6_000_000);
        for (index, preset) in ["future-glow", "lower-third-premium", "stat-hero"]
            .iter()
            .enumerate()
        {
            let start_us = index as u64 * 2_000_000;
            let title: crate::project_storage::TitleDecision = serde_json::from_value(serde_json::json!({
                "id":format!("template-{index}"),"instanceId":format!("template-{index}"),"presetId":preset,
                "templateId":format!("cheto.{preset}"),"templateVersion":"1.0.0",
                "text":if *preset == "stat-hero" {"85%"} else if *preset == "future-glow" {"FUTURE"} else {"JOSÉ PÉREZ"},
                "secondaryText":if *preset == "lower-third-premium" {"DIRECTOR"} else {"CHETO"},
                "startUs":start_us,"endUs":start_us+2_000_000,"positionX":if *preset == "lower-third-premium" {0.08} else {0.5},
                "positionY":if *preset == "lower-third-premium" {0.82} else {0.5},
                "anchor":if *preset == "lower-third-premium" {"left"} else {"center"},
                "scale":1.0,"font":"Inter","fontWeight":700,"fontSize":72,"color":"#FFFFFF","accentColor":"#34D5E5",
                "alignment":"center","tracking":0,"lineHeight":1.15,"opacity":1.0,"safeArea":0.06,
                "animationInUs":200_000,"animationOutUs":200_000,"easing":"ease-out","background":false
            })).unwrap();
            edl.tracks.titles.push(title);
        }
        let mut outputs = Vec::new();
        for preview in [false, true] {
            let output = dir.path().join(if preview {
                "result-preview.mp4"
            } else {
                "export.mp4"
            });
            let mut config = neutral_config();
            config.output_path = output.to_string_lossy().into_owned();
            config.width = 320;
            config.height = 180;
            config.fps = 24.0;
            config.preview_duration_us = if preview { Some(6_000_000) } else { None };
            let rendered = command(&config, &source, &edl, "libx264", (320, 180), false)
                .output()
                .unwrap();
            assert!(
                rendered.status.success(),
                "{}",
                String::from_utf8_lossy(&rendered.stderr)
            );
            outputs.push(output);
        }
        for second in [0.5, 2.5, 4.5] {
            let mut frames = Vec::new();
            for output in &outputs {
                let frame = Command::new("ffmpeg")
                    .args([
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-ss",
                        &format!("{second}"),
                        "-i",
                    ])
                    .arg(output)
                    .args(["-frames:v", "1", "-f", "md5", "-"])
                    .output()
                    .unwrap();
                assert!(frame.status.success());
                frames.push(frame.stdout);
            }
            assert_eq!(frames[0], frames[1], "Preview/export mismatch at {second}s");
        }
    }

    #[test]
    fn manual_camera_title_and_sfx_change_rendered_media() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.mp4");
        let click = dir.path().join("click.wav");
        let generated = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=24",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=220:sample_rate=48000",
                "-t",
                "6",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        let generated = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1800:sample_rate=48000:duration=0.2",
            ])
            .arg(&click)
            .output()
            .unwrap();
        assert!(generated.status.success());
        let mut base = neutral_edl();
        base.source_duration_us = Some(6_000_000);
        let mut camera = base.clone();
        camera.tracks.camera.push(CameraDecision {
            id: "test-camera".into(),
            start_us: 1_000_000,
            end_us: 5_000_000,
            mode: "zoom".into(),
            zoom: Some(1.30),
            center_x: Some(0.6),
            center_y: Some(0.4),
            easing: Some("ease_in_out".into()),
            reason: None,
            confidence: None,
            transition_us: Some(500_000),
            automation: None,
        });
        let mut title = base.clone();
        title.tracks.titles.push(
            serde_json::from_value(serde_json::json!({
                "id":"test-title","presetId":"whisper-fade","text":"TEST","secondaryText":"",
                "startUs":1_000_000,"endUs":5_000_000,"positionX":0.5,"positionY":0.5,
                "anchor":"center","scale":1.0,"font":"Inter","fontWeight":700,"fontSize":100,
                "color":"#FFFFFF","accentColor":"#34D5E5","alignment":"center","tracking":0,
                "lineHeight":1.15,"opacity":1.0,"safeArea":0.06,"animationInUs":200_000,
                "animationOutUs":200_000,"easing":"ease-out","background":false
            }))
            .unwrap(),
        );
        let mut combined = camera.clone();
        combined.tracks.titles = title.tracks.titles.clone();
        combined
            .tracks
            .assets
            .push(crate::project_storage::AssetDecision {
                id: "test-click".into(),
                asset_id: "test-click".into(),
                asset_path: click.to_string_lossy().into_owned(),
                source_duration_us: 200_000,
                kind: "sfx".into(),
                start_us: 2_000_000,
                end_us: 2_200_000,
                gain_db: 0.0,
                fade_in_us: 0,
                fade_out_us: 0,
                loop_: false,
                ducking: false,
                duck_db: -12.0,
                attack_ms: 80,
                release_ms: 250,
                position_x: 0.5,
                position_y: 0.5,
                scale: 1.0,
                opacity: 1.0,
                muted: false,
                preview_input_offset_us: None,
                automation: None,
            });
        let mut frames = Vec::new();
        let mut audio = Vec::new();
        for (name, edl) in [
            ("base", base),
            ("camera", camera),
            ("title", title),
            ("combined", combined),
        ] {
            let output = dir.path().join(format!("{name}.mp4"));
            let mut config = neutral_config();
            config.output_path = output.to_string_lossy().into_owned();
            config.width = 320;
            config.height = 180;
            config.fps = 24.0;
            config.preview_duration_us = Some(6_000_000);
            let rendered = command(&config, &source, &edl, "libx264", (320, 180), true)
                .output()
                .unwrap();
            assert!(
                rendered.status.success(),
                "{name}: {}",
                String::from_utf8_lossy(&rendered.stderr)
            );
            let frame = Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-ss", "2", "-i"])
                .arg(&output)
                .args(["-frames:v", "1", "-f", "md5", "-"])
                .output()
                .unwrap();
            assert!(frame.status.success());
            frames.push(frame.stdout);
            let sound = Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(&output)
                .args(["-map", "0:a:0", "-f", "md5", "-"])
                .output()
                .unwrap();
            assert!(
                sound.status.success(),
                "{name}: {}",
                String::from_utf8_lossy(&sound.stderr)
            );
            audio.push(sound.stdout);
        }
        assert_ne!(
            frames[0], frames[1],
            "CameraDecision 1.30x no cambió el fotograma"
        );
        assert_ne!(
            frames[0], frames[2],
            "TitleDecision TEST no cambió el fotograma"
        );
        assert_ne!(frames[1], frames[3], "La combinación no mostró el título");
        assert_ne!(audio[0], audio[3], "El SFX no cambió el audio");

        // ResultPlayer seeks to a source offset and renders a localized EDL.
        // A camera decision already in progress must remain visible there.
        let mut preview_frames = Vec::new();
        for (name, edl) in [
            ("base", neutral_edl()),
            ("camera", {
                let mut edl = neutral_edl();
                edl.tracks.camera.push(CameraDecision {
                    id: "preview-camera".into(),
                    start_us: 1_000_000,
                    end_us: 5_000_000,
                    mode: "zoom".into(),
                    zoom: Some(1.30),
                    center_x: Some(0.6),
                    center_y: Some(0.4),
                    easing: Some("ease_in_out".into()),
                    reason: None,
                    confidence: None,
                    transition_us: Some(500_000),
                    automation: None,
                });
                edl
            }),
        ] {
            let output = dir.path().join(format!("preview-{name}.mp4"));
            let mut config = neutral_config();
            config.output_path = output.to_string_lossy().into_owned();
            config.width = 320;
            config.height = 180;
            config.fps = 24.0;
            config.preview_source_start_us = 2_000_000;
            config.preview_duration_us = Some(2_000_000);
            let local = localize_edl(&edl, 2_000_000, 4_000_000);
            let rendered = command(&config, &source, &local, "libx264", (320, 180), true)
                .output()
                .unwrap();
            assert!(
                rendered.status.success(),
                "{name}: {}",
                String::from_utf8_lossy(&rendered.stderr)
            );
            let frame = Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i"])
                .arg(&output)
                .args(["-frames:v", "1", "-f", "md5", "-"])
                .output()
                .unwrap();
            assert!(frame.status.success());
            preview_frames.push(frame.stdout);
        }
        assert_ne!(
            preview_frames[0], preview_frames[1],
            "El chunk con seek perdió CameraDecision"
        );
    }

    #[test]
    fn five_second_gain_and_noise_cleanup_change_result_audio() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.mp4");
        let generated = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=320x180:r=24:d=5",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=5",
                "-f",
                "lavfi",
                "-i",
                "anoisesrc=color=white:amplitude=0.08:sample_rate=48000:duration=5",
                "-filter_complex",
                "[1:a][2:a]amix=inputs=2:duration=first[a]",
                "-map",
                "0:v",
                "-map",
                "[a]",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        let mut fingerprints = Vec::new();
        let mut levels = Vec::new();
        for operation in ["original", "gain_range", "noise_reduction_range"] {
            let mut edl = neutral_edl();
            edl.source_duration_us = Some(5_000_000);
            if operation != "original" {
                edl.tracks
                    .audio
                    .push(crate::project_storage::AudioDecision {
                        id: operation.into(),
                        start_us: 0,
                        end_us: 5_000_000,
                        operation: operation.into(),
                        parameters: if operation == "gain_range" {
                            serde_json::json!({"gainDb": -18})
                        } else {
                            serde_json::json!({"amount": 0.8})
                        },
                    });
            }
            let output = dir.path().join(format!("{operation}.mp4"));
            let mut config = neutral_config();
            config.output_path = output.to_string_lossy().into_owned();
            config.width = 320;
            config.height = 180;
            config.fps = 24.0;
            let rendered = command(&config, &source, &edl, "libx264", (320, 180), true)
                .output()
                .unwrap();
            assert!(
                rendered.status.success(),
                "{operation}: {}",
                String::from_utf8_lossy(&rendered.stderr)
            );
            let pcm = Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(&output)
                .args(["-map", "0:a:0", "-ac", "1", "-f", "s16le", "-"])
                .output()
                .unwrap();
            assert!(pcm.status.success());
            let samples: Vec<i16> = pcm
                .stdout
                .chunks_exact(2)
                .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            let rms = (samples.iter().map(|v| (*v as f64).powi(2)).sum::<f64>()
                / samples.len() as f64)
                .sqrt();
            levels.push(rms);
            fingerprints.push(pcm.stdout);
        }
        assert!(
            levels[1] < levels[0] * 0.2,
            "-18 dB no redujo el nivel: {levels:?}"
        );
        assert_ne!(
            fingerprints[0], fingerprints[2],
            "Limpiar ruido no cambió el PCM"
        );
    }

    #[test]
    fn camera_result_frames_show_entrance_hold_exit_and_return() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.mp4");
        let created = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=24:duration=10",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(created.status.success());
        let mut camera = neutral_edl();
        camera.source_duration_us = Some(10_000_000);
        camera.tracks.camera.push(CameraDecision {
            id: "visible-zoom".into(),
            start_us: 1_500_000,
            end_us: 8_000_000,
            mode: "zoom".into(),
            zoom: Some(1.32),
            center_x: Some(0.6),
            center_y: Some(0.4),
            easing: Some("linear".into()),
            reason: None,
            confidence: None,
            transition_us: Some(600_000),
            automation: None,
        });
        let mut original = neutral_edl();
        original.source_duration_us = Some(10_000_000);
        for (name, edl) in [("original", original), ("result", camera)] {
            let mut config = neutral_config();
            config.output_path = dir
                .path()
                .join(format!("{name}.mp4"))
                .to_string_lossy()
                .into_owned();
            config.width = 320;
            config.height = 180;
            config.fps = 24.0;
            let rendered = command(&config, &source, &edl, "libx264", (320, 180), false)
                .output()
                .unwrap();
            assert!(
                rendered.status.success(),
                "{name}: {}",
                String::from_utf8_lossy(&rendered.stderr)
            );
        }
        let mut differences = Vec::new();
        for timestamp in ["1.0", "1.8", "4.75", "7.7", "8.5"] {
            let mut frames = Vec::new();
            for name in ["original", "result"] {
                let frame = Command::new("ffmpeg")
                    .args(["-hide_banner", "-loglevel", "error", "-ss", timestamp, "-i"])
                    .arg(dir.path().join(format!("{name}.mp4")))
                    .args(["-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"])
                    .output()
                    .unwrap();
                assert!(frame.status.success());
                frames.push(frame.stdout);
            }
            assert_eq!(frames[0].len(), frames[1].len());
            let diff = frames[0]
                .iter()
                .zip(&frames[1])
                .map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs() as f64)
                .sum::<f64>()
                / frames[0].len() as f64;
            differences.push(diff);
        }
        assert!(
            differences[2] > 10.0 && differences[2] > differences[0] * 2.0,
            "Hold no mostró zoom perceptible: {differences:?}"
        );
        assert!(
            differences[1] > differences[0] && differences[3] > differences[4],
            "Entrada/salida no cambiaron visualmente: {differences:?}"
        );
    }

    #[test]
    fn qa_video_five_second_audio_ab_when_source_is_provided() {
        let Ok(path) = std::env::var("CHETO_QA_VIDEO") else {
            return;
        };
        let source = Path::new(&path);
        let dir = tempfile::tempdir().unwrap();
        let mut metrics = Vec::new();
        for operation in ["original", "gain_range", "noise_reduction_range"] {
            let mut edl = neutral_edl();
            edl.source_duration_us = Some(5_000_000);
            if operation != "original" {
                edl.tracks
                    .audio
                    .push(crate::project_storage::AudioDecision {
                        id: operation.into(),
                        start_us: 0,
                        end_us: 5_000_000,
                        operation: operation.into(),
                        parameters: if operation == "gain_range" {
                            serde_json::json!({"gainDb": -18})
                        } else {
                            serde_json::json!({"amount": 0.8})
                        },
                    });
            }
            let output = dir.path().join(format!("{operation}.mp4"));
            let mut config = neutral_config();
            config.output_path = output.to_string_lossy().into_owned();
            config.preview_source_start_us = 5_000_000;
            config.preview_duration_us = Some(5_000_000);
            config.width = 320;
            config.height = 180;
            config.fps = 30.0;
            let rendered = command(&config, source, &edl, "libx264", (1280, 720), true)
                .output()
                .unwrap();
            assert!(
                rendered.status.success(),
                "{operation}: {}",
                String::from_utf8_lossy(&rendered.stderr)
            );
            if let Ok(folder) = std::env::var("CHETO_QA_OUTPUT_DIR") {
                fs::create_dir_all(&folder).unwrap();
                fs::copy(
                    &output,
                    Path::new(&folder).join(format!("qa4-audio-{operation}.mp4")),
                )
                .unwrap();
            }
            let pcm = Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(&output)
                .args(["-map", "0:a:0", "-ac", "1", "-f", "s16le", "-"])
                .output()
                .unwrap();
            assert!(pcm.status.success());
            let samples: Vec<i16> = pcm
                .stdout
                .chunks_exact(2)
                .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            let rms = (samples.iter().map(|v| (*v as f64).powi(2)).sum::<f64>()
                / samples.len() as f64)
                .sqrt();
            metrics.push((rms, pcm.stdout));
        }
        eprintln!(
            "QA_AUDIO_AB originalRms={:.2} gainMinus18Rms={:.2} cleanRms={:.2}",
            metrics[0].0, metrics[1].0, metrics[2].0
        );
        assert!(metrics[1].0 < metrics[0].0 * 0.2);
        assert_ne!(metrics[0].1, metrics[2].1);
    }

    #[test]
    fn qa_video_camera_frames_when_source_is_provided() {
        let Ok(path) = std::env::var("CHETO_QA_VIDEO") else {
            return;
        };
        let source = Path::new(&path);
        let dir = tempfile::tempdir().unwrap();
        let mut camera = neutral_edl();
        camera.source_duration_us = Some(10_000_000);
        camera.tracks.camera.push(CameraDecision {
            id: "qa-zoom".into(),
            start_us: 1_500_000,
            end_us: 8_000_000,
            mode: "zoom".into(),
            zoom: Some(1.32),
            center_x: Some(0.6),
            center_y: Some(0.4),
            easing: Some("linear".into()),
            reason: None,
            confidence: None,
            transition_us: Some(600_000),
            automation: None,
        });
        let mut original = neutral_edl();
        original.source_duration_us = Some(10_000_000);
        for (name, edl) in [("original", original), ("result", camera)] {
            let mut config = neutral_config();
            config.output_path = dir
                .path()
                .join(format!("{name}.mp4"))
                .to_string_lossy()
                .into_owned();
            config.width = 320;
            config.height = 180;
            config.fps = 30.0;
            config.preview_duration_us = Some(10_000_000);
            let rendered = command(&config, source, &edl, "libx264", (1280, 720), true)
                .output()
                .unwrap();
            assert!(
                rendered.status.success(),
                "{name}: {}",
                String::from_utf8_lossy(&rendered.stderr)
            );
            if let Ok(folder) = std::env::var("CHETO_QA_OUTPUT_DIR") {
                fs::create_dir_all(&folder).unwrap();
                fs::copy(
                    &config.output_path,
                    Path::new(&folder).join(format!("qa4-camera-{name}.mp4")),
                )
                .unwrap();
            }
        }
        let mut differences = Vec::new();
        for timestamp in ["1.0", "1.8", "4.75", "7.7", "8.5"] {
            let mut frames = Vec::new();
            for name in ["original", "result"] {
                let frame = Command::new("ffmpeg")
                    .args(["-hide_banner", "-loglevel", "error", "-ss", timestamp, "-i"])
                    .arg(dir.path().join(format!("{name}.mp4")))
                    .args(["-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"])
                    .output()
                    .unwrap();
                assert!(frame.status.success());
                frames.push(frame.stdout);
            }
            let diff = frames[0]
                .iter()
                .zip(&frames[1])
                .map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs() as f64)
                .sum::<f64>()
                / frames[0].len() as f64;
            differences.push(diff);
        }
        eprintln!("QA_CAMERA_FRAME_DIFF timestamps=1.0,1.8,4.75,7.7,8.5 values={differences:?}");
        assert!(differences[2] > differences[0] * 2.0 && differences[2] > 5.0);
    }

    #[test]
    fn ffmpeg_renders_sfx_music_and_gif_when_available() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::TempDir::new().unwrap();
        let source = dir.path().join("source.mp4");
        let sfx = dir.path().join("sfx.wav");
        let music = dir.path().join("music.wav");
        let gif = dir.path().join("overlay.gif");
        let output = dir.path().join("result.mp4");
        for (path, args) in [
            (
                &source,
                vec![
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=160x90:r=15",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:sample_rate=48000",
                    "-t",
                    "2",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                ],
            ),
            (
                &sfx,
                vec![
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=880:sample_rate=48000",
                    "-t",
                    "0.4",
                ],
            ),
            (
                &music,
                vec![
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=220:sample_rate=48000",
                    "-t",
                    "0.8",
                ],
            ),
            (
                &gif,
                vec!["-f", "lavfi", "-i", "color=c=red:s=24x24:r=5", "-t", "0.6"],
            ),
        ] {
            let result = Command::new("ffmpeg")
                .args(["-y", "-hide_banner", "-loglevel", "error"])
                .args(args)
                .arg(path)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
        let mut edl = neutral_edl();
        edl.source_duration_us = Some(2_000_000);
        let asset = |id: &str, kind: &str, path: &Path, start_us, end_us, loop_, ducking| {
            crate::project_storage::AssetDecision {
                id: id.into(),
                asset_id: id.into(),
                asset_path: path.to_string_lossy().into_owned(),
                source_duration_us: if kind == "music" { 800_000 } else { 400_000 },
                kind: kind.into(),
                start_us,
                end_us,
                gain_db: -12.0,
                fade_in_us: 100_000,
                fade_out_us: 100_000,
                loop_,
                ducking,
                duck_db: -12.0,
                attack_ms: 80,
                release_ms: 250,
                position_x: 0.5,
                position_y: 0.5,
                scale: 1.0,
                opacity: 1.0,
                muted: false,
                preview_input_offset_us: None,
                automation: None,
            }
        };
        edl.tracks.assets = vec![
            asset("s", "sfx", &sfx, 200_000, 600_000, false, false),
            asset("m", "music", &music, 0, 2_000_000, true, true),
            asset("g", "overlay", &gif, 500_000, 1_500_000, true, false),
        ];
        let mut config = neutral_config();
        config.output_path = output.to_string_lossy().into_owned();
        config.width = 160;
        config.height = 90;
        config.fps = 15.0;
        config.aspect_ratio = 16.0 / 9.0;
        config.bitrate = "low".into();
        let result = command(&config, &source, &edl, "libx264", (160, 90), true)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(fs::metadata(&output).is_ok_and(|meta| meta.len() > 1000));
        let silent_source = dir.path().join("silent.mp4");
        let silent_output = dir.path().join("silent-result.mp4");
        let generated = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=160x90:r=15",
                "-t",
                "2",
                "-c:v",
                "libx264",
            ])
            .arg(&silent_source)
            .output()
            .unwrap();
        assert!(generated.status.success());
        edl.tracks.assets.retain(|item| item.kind == "sfx");
        config.output_path = silent_output.to_string_lossy().into_owned();
        let silent_result = command(&config, &silent_source, &edl, "libx264", (160, 90), false)
            .output()
            .unwrap();
        assert!(
            silent_result.status.success(),
            "{}",
            String::from_utf8_lossy(&silent_result.stderr)
        );
        assert!(fs::metadata(silent_output).is_ok_and(|meta| meta.len() > 1000));
    }
}
