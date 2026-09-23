use crate::proxy_model::{ProxyError, ProxyFps, ProxyProgress, ProxyState};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

#[derive(Clone)]
struct ActiveProxy {
    cancelled: Arc<AtomicBool>,
    child: Option<Arc<Mutex<Child>>>,
}

#[derive(Clone, Default)]
pub struct ProxyManager {
    active: Arc<Mutex<HashMap<String, ActiveProxy>>>,
}

impl ProxyManager {
    pub(crate) fn claim(&self, project_id: &str) -> Result<Arc<AtomicBool>, ProxyError> {
        let mut active = self.active.lock().map_err(|_| {
            ProxyError::new(
                "proxy-state-poisoned",
                "El estado del proxy no está disponible.",
            )
        })?;
        if active.contains_key(project_id) {
            return Err(ProxyError::new(
                "proxy-already-running",
                "Ya existe una generación de proxy activa para este proyecto.",
            ));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        active.insert(
            project_id.into(),
            ActiveProxy {
                cancelled: cancelled.clone(),
                child: None,
            },
        );
        Ok(cancelled)
    }

    fn attach(&self, project_id: &str, child: Arc<Mutex<Child>>) -> Result<(), ProxyError> {
        let mut active = self.active.lock().map_err(|_| {
            ProxyError::new(
                "proxy-state-poisoned",
                "El estado del proxy no está disponible.",
            )
        })?;
        let entry = active.get_mut(project_id).ok_or_else(|| {
            ProxyError::new(
                "proxy-not-running",
                "La generación de proxy ya no está activa.",
            )
        })?;
        entry.child = Some(child);
        Ok(())
    }

    pub(crate) fn release(&self, project_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(project_id);
        }
    }

    pub(crate) fn is_running(&self, project_id: &str) -> bool {
        self.active
            .lock()
            .map(|active| active.contains_key(project_id))
            .unwrap_or(false)
    }

    pub(crate) fn cancel(&self, project_id: &str) -> Result<bool, ProxyError> {
        let active = self.active.lock().map_err(|_| {
            ProxyError::new(
                "proxy-state-poisoned",
                "El estado del proxy no está disponible.",
            )
        })?;
        let Some(entry) = active.get(project_id) else {
            return Ok(false);
        };
        entry.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = &entry.child {
            let mut child = child.lock().map_err(|_| {
                ProxyError::new("proxy-process-poisoned", "No se pudo controlar FFmpeg.")
            })?;
            let _ = child.kill();
        }
        Ok(true)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyDiagnostic {
    project_id: String,
    event: String,
}

pub(crate) fn emit_diagnostic(app: &AppHandle, project_id: &str, event: &str) {
    let _ = app.emit(
        "proxy://diagnostic",
        ProxyDiagnostic {
            project_id: project_id.into(),
            event: event.into(),
        },
    );
}

pub(crate) fn emit_progress(
    app: &AppHandle,
    project_id: &str,
    status: ProxyState,
    progress: f64,
    processed_us: u64,
) {
    let _ = app.emit(
        "proxy://progress",
        ProxyProgress {
            project_id: project_id.into(),
            status,
            progress,
            processed_us,
        },
    );
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

fn ffmpeg_has_nvenc() -> bool {
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null());
    hide_console(&mut command);
    command
        .output()
        .ok()
        .filter(|output| output.status.success())
        .is_some_and(|output| String::from_utf8_lossy(&output.stdout).contains("h264_nvenc"))
}

fn validate_nvenc() -> bool {
    let mut command = Command::new("ffmpeg");
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:d=0.05",
            "-frames:v",
            "1",
            "-c:v",
            "h264_nvenc",
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut command);
    command.status().is_ok_and(|status| status.success())
}

pub(crate) fn nvenc_capabilities() -> (bool, bool) {
    let advertised = ffmpeg_has_nvenc();
    (advertised, advertised && validate_nvenc())
}

fn build_ffmpeg_command(
    input: &Path,
    output: &Path,
    width: u32,
    height: u32,
    fps: f64,
    encoder: &str,
) -> Command {
    let mut command = Command::new("ffmpeg");
    let gop = (fps.max(1.0) * 2.0).round() as u32;
    command
        .args(["-y", "-hide_banner", "-nostdin", "-i"])
        .arg(input)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            &format!("scale={width}:{height}:flags=lanczos"),
            "-c:v",
            encoder,
        ]);
    if encoder == "h264_nvenc" {
        command.args(["-preset", "p4", "-cq", "24", "-b:v", "0"]);
    } else {
        command.args(["-preset", "veryfast", "-crf", "23"]);
    }
    command
        .args([
            "-g",
            &gop.to_string(),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "mp4",
        ])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    command
}

pub(crate) enum RunFailure {
    Cancelled,
    Failed(String),
}

pub(crate) fn run_ffmpeg(
    app: &AppHandle,
    manager: &ProxyManager,
    project_id: &str,
    cancelled: &Arc<AtomicBool>,
    input: &Path,
    output: &Path,
    dimensions: (u32, u32),
    fps: f64,
    duration_us: u64,
    encoder: &str,
) -> Result<(), RunFailure> {
    if output.exists() {
        let _ = fs::remove_file(output);
    }
    let mut child = build_ffmpeg_command(input, output, dimensions.0, dimensions.1, fps, encoder)
        .spawn()
        .map_err(|error| RunFailure::Failed(format!("No se pudo iniciar FFmpeg: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| RunFailure::Failed("FFmpeg no entregó progreso.".into()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| RunFailure::Failed("FFmpeg no entregó stderr.".into()))?;
    let child = Arc::new(Mutex::new(child));
    manager
        .attach(project_id, child.clone())
        .map_err(|error| RunFailure::Failed(error.message))?;
    let (sender, receiver) = std::sync::mpsc::channel::<String>();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = sender.send(line);
        }
    });
    let stderr_reader = thread::spawn(move || {
        let mut value = String::new();
        let _ = stderr.read_to_string(&mut value);
        value
    });
    let mut last_percent = -1_i32;
    let exit_status = loop {
        while let Ok(line) = receiver.try_recv() {
            if let Some(value) = line
                .strip_prefix("out_time_us=")
                .and_then(|value| value.parse::<u64>().ok())
            {
                let percent =
                    ((value as f64 / duration_us.max(1) as f64) * 100.0).clamp(0.0, 100.0);
                let rounded = percent.floor() as i32;
                if rounded > last_percent {
                    last_percent = rounded;
                    emit_progress(
                        app,
                        project_id,
                        ProxyState::Generating,
                        percent,
                        value.min(duration_us),
                    );
                }
            }
        }
        let status = child
            .lock()
            .map_err(|_| RunFailure::Failed("No se pudo consultar FFmpeg.".into()))?
            .try_wait()
            .map_err(|error| RunFailure::Failed(format!("No se pudo consultar FFmpeg: {error}")))?;
        if let Some(status) = status {
            break status;
        }
        if cancelled.load(Ordering::SeqCst) {
            let _ = child.lock().map(|mut process| process.kill());
        }
        thread::sleep(Duration::from_millis(35));
    };
    let _stderr = stderr_reader.join().unwrap_or_default();
    if cancelled.load(Ordering::SeqCst) {
        let _ = fs::remove_file(output);
        return Err(RunFailure::Cancelled);
    }
    if !exit_status.success() {
        let _ = fs::remove_file(output);
        return Err(RunFailure::Failed(format!(
            "FFmpeg terminó con código {:?}.",
            exit_status.code()
        )));
    }
    Ok(())
}

pub(crate) fn inspect_proxy(path: &Path) -> Result<(String, u32, u32, ProxyFps), ProxyError> {
    let mut command = Command::new("ffprobe");
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height,avg_frame_rate",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null());
    hide_console(&mut command);
    let output = command.output().map_err(|error| {
        ProxyError::new(
            "proxy-validation-failed",
            format!("No se pudo ejecutar FFprobe: {error}"),
        )
    })?;
    if !output.status.success() {
        return Err(ProxyError::new(
            "proxy-validation-failed",
            "FFprobe rechazó el proxy generado.",
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        ProxyError::new(
            "proxy-validation-failed",
            format!("Respuesta FFprobe inválida: {error}"),
        )
    })?;
    let stream = value
        .get("streams")
        .and_then(|value| value.as_array())
        .and_then(|values| values.first())
        .ok_or_else(|| ProxyError::new("proxy-validation-failed", "El proxy no contiene video."))?;
    let codec = stream
        .get("codec_name")
        .and_then(|value| value.as_str())
        .unwrap_or("h264")
        .to_owned();
    let width = stream
        .get("width")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    let height = stream
        .get("height")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    if width == 0 || height == 0 {
        return Err(ProxyError::new(
            "proxy-validation-failed",
            "El proxy no tiene dimensiones válidas.",
        ));
    }
    let fps_text = stream
        .get("avg_frame_rate")
        .and_then(|value| value.as_str())
        .unwrap_or("0/1");
    let mut parts = fps_text.split('/');
    let numerator = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let denominator = parts
        .next()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1);
    Ok((
        codec,
        width,
        height,
        ProxyFps {
            numerator,
            denominator,
        },
    ))
}
