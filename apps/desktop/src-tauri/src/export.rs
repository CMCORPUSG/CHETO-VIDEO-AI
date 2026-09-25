use crate::{
    project_storage::{AudioDecision, CameraDecision, EdlManifest, ProjectStorage},
    proxy_ffmpeg::nvenc_capabilities,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Default)]
pub struct ExportManager {
    active: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
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
                "min(1,min((t-{})/{},({}-t)/{}))",
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
            "if(between(t,{},{}),{},({rest}))",
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

fn audio_filters(edl: &EdlManifest) -> String {
    let mut filters = Vec::<String>::new();

    if let Some(item) = edl
        .tracks
        .audio
        .iter()
        .find(|item| item.operation == "master_gain")
    {
        let gain_db = audio_parameter_f64(item, "gainDb", 0.0).clamp(-24.0, 18.0);
        if gain_db.abs() >= 0.05 {
            filters.push(format!("volume={gain_db}dB"));
        }
    }
    if edl
        .tracks
        .audio
        .iter()
        .any(|item| item.operation == "noise_reduction")
    {
        filters.push("afftdn=nr=10:nf=-35".into());
    }
    if edl
        .tracks
        .audio
        .iter()
        .any(|item| item.operation == "voice_focus")
    {
        filters.push("highpass=f=80".into());
        filters.push("lowpass=f=12000".into());
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

    for item in &edl.tracks.audio {
        let enable = format!(
            "between(t,{},{})",
            seconds(item.start_us),
            seconds(item.end_us)
        );
        match item.operation.as_str() {
            "mute_range" => filters.push(format!("volume=0:enable='{enable}'")),
            "gain_range" => {
                let gain_db = audio_parameter_f64(item, "gainDb", 0.0).clamp(-60.0, 18.0);
                filters.push(format!("volume={gain_db}dB:enable='{enable}'"));
            }
            "noise_reduction_range" => {
                let amount = audio_parameter_f64(item, "amount", 0.45).clamp(0.0, 1.0);
                let nr = 4.0 + amount * 10.0;
                filters.push(format!("afftdn=nr={nr:.1}:nf=-35:enable='{enable}'"));
            }
            "notch_range" => {
                let hz = audio_parameter_f64(item, "hz", 4000.0).clamp(120.0, 16_000.0);
                let width = audio_parameter_f64(item, "width", 90.0).clamp(10.0, 500.0);
                filters.push(format!("bandreject=f={hz}:width_type=h:width={width}:enable='{enable}'"));
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

fn command(config: &ExportConfig, source: &Path, edl: &EdlManifest, encoder: &str) -> Command {
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
    let keep = keep_expression(edl);
    let scaled_w = ((config.width as f64 * config.canvas_scale / 2.0).round() as u32 * 2).max(2);
    let scaled_h = ((config.height as f64 * config.canvas_scale / 2.0).round() as u32 * 2).max(2);
    let crop_x = format!(
        "max(0,(iw-{w})/2-(iw-{w})*({ox})/2)",
        w = config.width,
        ox = config.canvas_offset_x
    );
    let crop_y = format!(
        "max(0,(ih-{h})/2-(ih-{h})*({oy})/2)",
        h = config.height,
        oy = config.canvas_offset_y
    );
    let pad_x = format!(
        "max(0,({w}-iw)/2+({w}-iw)*({ox})/2)",
        w = config.width,
        ox = config.canvas_offset_x
    );
    let pad_y = format!(
        "max(0,({h}-ih)/2+({h}-ih)*({oy})/2)",
        h = config.height,
        oy = config.canvas_offset_y
    );
    let vf=format!(
        "[0:v]crop='iw/({zoom})':'ih/({zoom})':'(iw-iw/({zoom}))*({center_x})':'(ih-ih/({zoom}))*({center_y})',select='{keep}',setpts=N/FRAME_RATE/TB,scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},scale={sw}:{sh},crop='min(iw,{w})':'min(ih,{h})':'{cx}':'{cy}',pad={w}:{h}:'{px}':'{py}':black,setsar=1[v]",
        w=config.width,
        h=config.height,
        sw=scaled_w,
        sh=scaled_h,
        cx=crop_x,
        cy=crop_y,
        px=pad_x,
        py=pad_y
    );
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
        .arg(source)
        .args(["-filter_complex"]);
    if config.include_audio {
        let af = audio_filters(edl);
        let audio_chain = if af.is_empty() {
            format!("[0:a]aselect='{keep}',asetpts=N/SR/TB[a]")
        } else {
            format!("[0:a]aselect='{keep}',asetpts=N/SR/TB,{af}[a]")
        };
        cmd.arg(format!("{vf};{audio_chain}"))
            .args(["-map", "[v]", "-map", "[a]"]);
    } else {
        cmd.arg(vf).args(["-map", "[v]", "-an"]);
    }
    cmd.args(["-r", &config.fps.to_string(), "-c:v", encoder]);
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
    if config.include_audio {
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
    ])
    .arg(&config.output_path)
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
) -> Result<(), ExportError> {
    let output = PathBuf::from(&config.output_path);
    let _ = fs::remove_file(&output);
    let mut child = command(config, source, edl, encoder).spawn().map_err(|e| {
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
    let mut diagnostics = String::new();
    let _ = std::io::Read::read_to_string(&mut BufReader::new(stderr), &mut diagnostics);
    let status = child
        .lock()
        .unwrap()
        .wait()
        .map_err(|e| ExportError::new("ffmpeg-wait", e.to_string()))?;
    manager.active.lock().unwrap().remove(&config.project_id);
    if !status.success() {
        let _ = fs::remove_file(&output);
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
    Ok(())
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
        let encoder = if nvenc_capabilities().1 {
            "h264_nvenc"
        } else {
            "libx264"
        };
        let used = match render(
            &app,
            &manager,
            &config,
            &source,
            &bundle.edl,
            duration,
            encoder,
        ) {
            Ok(()) => encoder,
            Err(_) if encoder == "h264_nvenc" => {
                render(
                    &app,
                    &manager,
                    &config,
                    &source,
                    &bundle.edl,
                    duration,
                    "libx264",
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
    if let Some(child) = manager.active.lock().unwrap().remove(&project_id) {
        let mut child = child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
        Ok(true)
    } else {
        Ok(false)
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
        };
        let rendered = command(&config, &source, &edl, "libx264").output().unwrap();
        assert!(
            rendered.status.success(),
            "{}",
            String::from_utf8_lossy(&rendered.stderr)
        );
        assert!(fs::metadata(&output).is_ok_and(|value| value.len() > 0));
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(output);
    }
}
