use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

const DETECTION_TIMEOUT: Duration = Duration::from_secs(3);
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCommandError {
    code: String,
    message: String,
    stderr: Option<String>,
}

impl MediaCommandError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), stderr: None }
    }

    fn with_stderr(code: &str, message: impl Into<String>, stderr: String) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            stderr: (!stderr.trim().is_empty()).then(|| stderr.trim().to_owned()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfprobeStatus {
    available: bool,
    detail: Option<String>,
    executable: String,
    version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSnapshot {
    file_name: String,
    last_modified_ms: Option<u64>,
    path: String,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProbeResponse {
    elapsed_ms: u64,
    raw_json: String,
    source: SourceSnapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCheck {
    changed: bool,
    exists: bool,
    last_modified_ms: Option<u64>,
    size_bytes: Option<u64>,
}

struct ProcessOutput {
    exit_code: Option<i32>,
    stderr: String,
    stdout: String,
}

fn read_pipe(mut pipe: impl Read) -> Result<String, std::io::Error> {
    let mut output = String::new();
    pipe.read_to_string(&mut output)?;
    Ok(output)
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}

fn run_with_timeout(mut command: Command, timeout: Duration) -> Result<ProcessOutput, MediaCommandError> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_console_window(&mut command);
    let mut child = command.spawn().map_err(|error| {
        MediaCommandError::new("ffprobe-unavailable", format!("No se pudo iniciar FFprobe: {error}"))
    })?;
    let stdout_pipe = child.stdout.take().ok_or_else(|| {
        MediaCommandError::new("ffprobe-output-failed", "No se pudo capturar stdout de FFprobe.")
    })?;
    let stderr_pipe = child.stderr.take().ok_or_else(|| {
        MediaCommandError::new("ffprobe-output-failed", "No se pudo capturar stderr de FFprobe.")
    })?;
    let stdout_reader = thread::spawn(move || read_pipe(stdout_pipe));
    let stderr_reader = thread::spawn(move || read_pipe(stderr_pipe));
    let started = Instant::now();

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(MediaCommandError::new(
                    "ffprobe-timeout",
                    format!("FFprobe excedió el tiempo límite de {} segundos.", timeout.as_secs()),
                ));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(MediaCommandError::new(
                    "ffprobe-wait-failed",
                    format!("No se pudo esperar la finalización de FFprobe: {error}"),
                ));
            }
        }
    };

    let stdout = stdout_reader.join().map_err(|_| {
        MediaCommandError::new("ffprobe-output-failed", "Falló el lector de stdout de FFprobe.")
    })?.map_err(|error| {
        MediaCommandError::new("ffprobe-output-failed", format!("No se pudo leer la salida de FFprobe: {error}"))
    })?;
    let stderr = stderr_reader.join().map_err(|_| {
        MediaCommandError::new("ffprobe-output-failed", "Falló el lector de stderr de FFprobe.")
    })?.map_err(|error| {
        MediaCommandError::new("ffprobe-output-failed", format!("No se pudo leer el error de FFprobe: {error}"))
    })?;

    Ok(ProcessOutput { exit_code: status.code(), stderr, stdout })
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|duration| duration.as_millis() as u64)
}

fn inspect_source(path: &Path) -> Result<SourceSnapshot, MediaCommandError> {
    if !path.is_absolute() {
        return Err(MediaCommandError::new("invalid-path", "La ruta seleccionada no es absoluta."));
    }
    let metadata = fs::metadata(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound { "source-missing" } else { "source-inaccessible" };
        MediaCommandError::new(code, format!("No se puede acceder al archivo fuente: {error}"))
    })?;
    if !metadata.is_file() {
        return Err(MediaCommandError::new("invalid-source", "La ruta seleccionada no es un archivo."));
    }
    if metadata.len() == 0 {
        return Err(MediaCommandError::new("empty-source", "El archivo está vacío."));
    }
    let file_name = path.file_name().and_then(|name| name.to_str()).ok_or_else(|| {
        MediaCommandError::new("invalid-file-name", "El nombre del archivo no es Unicode válido.")
    })?;
    Ok(SourceSnapshot {
        file_name: file_name.to_owned(),
        last_modified_ms: modified_ms(&metadata),
        path: path.to_string_lossy().into_owned(),
        size_bytes: metadata.len(),
    })
}

#[tauri::command]
pub fn detect_ffprobe() -> FfprobeStatus {
    let mut command = Command::new("ffprobe");
    command.arg("-version");
    match run_with_timeout(command, DETECTION_TIMEOUT) {
        Ok(output) if output.exit_code == Some(0) => {
            let version = output.stdout.lines().next().map(str::trim).filter(|line| !line.is_empty()).map(str::to_owned);
            FfprobeStatus { available: true, detail: None, executable: "ffprobe".into(), version }
        }
        Ok(output) => FfprobeStatus {
            available: false,
            detail: Some(if output.stderr.trim().is_empty() { "FFprobe respondió con error.".into() } else { output.stderr.trim().into() }),
            executable: "ffprobe".into(),
            version: None,
        },
        Err(error) => FfprobeStatus {
            available: false,
            detail: Some(error.message),
            executable: "ffprobe".into(),
            version: None,
        },
    }
}

#[tauri::command]
pub async fn probe_media(path: String) -> Result<NativeProbeResponse, MediaCommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let path_buf = PathBuf::from(&path);
        let source = inspect_source(&path_buf)?;
        let started = Instant::now();
        let mut command = Command::new("ffprobe");
        command.args(["-v", "error", "-show_format", "-show_streams", "-of", "json"]);
        command.arg(&path_buf);
        let output = run_with_timeout(command, PROBE_TIMEOUT)?;
        if output.exit_code != Some(0) {
            return Err(MediaCommandError::with_stderr(
                "invalid-media",
                "FFprobe no pudo leer el archivo. Puede estar dañado, no ser un video válido o no tener permisos.",
                output.stderr,
            ));
        }
        if output.stdout.trim().is_empty() {
            return Err(MediaCommandError::new("empty-metadata", "FFprobe no devolvió metadata."));
        }
        Ok(NativeProbeResponse {
            elapsed_ms: started.elapsed().as_millis() as u64,
            raw_json: output.stdout,
            source,
        })
    })
    .await
    .map_err(|error| MediaCommandError::new("probe-task-failed", format!("Falló la tarea de metadata: {error}")))?
}

#[tauri::command]
pub fn check_media_source(
    path: String,
    expected_size_bytes: u64,
    expected_last_modified_ms: Option<u64>,
) -> SourceCheck {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            let current_modified = modified_ms(&metadata);
            let changed = metadata.len() != expected_size_bytes
                || expected_last_modified_ms.zip(current_modified).is_some_and(|(expected, current)| expected != current);
            SourceCheck {
                changed,
                exists: true,
                last_modified_ms: current_modified,
                size_bytes: Some(metadata.len()),
            }
        }
        _ => SourceCheck { changed: false, exists: false, last_modified_ms: None, size_bytes: None },
    }
}
