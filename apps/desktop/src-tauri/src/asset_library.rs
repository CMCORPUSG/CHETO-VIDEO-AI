use serde::Serialize;
use serde_json::Value;
use std::{
    collections::hash_map::DefaultHasher,
    fs::{self, File},
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

const MAX_FILES: usize = 5_000;
const AUDIO_EXTENSIONS: &[&str] = &["wav", "mp3", "m4a", "aac", "ogg", "flac"];
const GIF_EXTENSIONS: &[&str] = &["gif"];

#[cfg(test)]
mod utf8_manifest_tests {
    #[test]
    fn builtin_manifest_contains_real_utf8_accents() {
        let text = include_str!("../resources/visual-13d/manifest.json");
        let items: serde_json::Value = serde_json::from_str(text).unwrap();
        let names: Vec<_> = items
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|item| item["name"].as_str())
            .collect();
        assert!(names.iter().any(|name| name.contains("Celebración")));
        assert!(!text.contains('Ã') && !text.contains('Â') && !text.contains('�'));
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetProbe {
    path: String,
    name: String,
    kind: String,
    format: String,
    duration_us: u64,
    sample_rate: Option<u32>,
    channels: Option<u32>,
    size_bytes: u64,
    modified_ms: Option<u128>,
    fingerprint: String,
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}
#[cfg(not(windows))]
fn hide_console(_: &mut Command) {}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn supported(path: &Path) -> bool {
    let ext = extension(path);
    AUDIO_EXTENSIONS.contains(&ext.as_str()) || GIF_EXTENSIONS.contains(&ext.as_str())
}

fn enumerate(folder: &Path) -> Result<Vec<String>, String> {
    if !folder.is_dir() {
        return Err("La carpeta no existe.".into());
    }
    let mut pending = vec![folder.to_path_buf()];
    let mut paths = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.is_file() && supported(&path) {
                paths.push(path.to_string_lossy().into_owned());
                if paths.len() >= MAX_FILES {
                    return Ok(paths);
                }
            }
        }
    }
    paths.sort();
    Ok(paths)
}

fn fingerprint(path: &Path, size: u64) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = DefaultHasher::new();
    size.hash(&mut hasher);
    let mut buffer = [0u8; 65_536];
    let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
    buffer[..read].hash(&mut hasher);
    if size > buffer.len() as u64 {
        file.seek(SeekFrom::End(-(buffer.len() as i64)))
            .map_err(|error| error.to_string())?;
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        buffer[..read].hash(&mut hasher);
    }
    Ok(format!("{:016x}", hasher.finish()))
}

fn probe(path: &Path) -> Result<AssetProbe, String> {
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.is_file() || !supported(&canonical) {
        return Err("Formato de recurso no compatible.".into());
    }
    let ext = extension(&canonical);
    let kind = if GIF_EXTENSIONS.contains(&ext.as_str()) {
        "overlay"
    } else {
        "audio"
    };
    let mut command = Command::new("ffprobe");
    command
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
        ])
        .arg(&canonical)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("No se pudo iniciar FFprobe: {error}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(20) => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("FFprobe tardó demasiado en analizar el recurso.".into());
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "FFprobe rechazó el recurso: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    let streams = value["streams"]
        .as_array()
        .ok_or("FFprobe no devolvió streams.")?;
    let stream = streams
        .iter()
        .find(|item| item["codec_type"] == if kind == "overlay" { "video" } else { "audio" })
        .ok_or("El recurso no contiene el stream esperado.")?;
    if kind == "overlay" && stream["codec_name"] != "gif" {
        return Err("El archivo no contiene GIF compatible.".into());
    }
    let duration = value["format"]["duration"]
        .as_str()
        .or_else(|| stream["duration"].as_str())
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(0.0);
    if kind == "audio" && duration <= 0.0 {
        return Err("FFprobe no pudo medir la duración del audio.".into());
    }
    let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    Ok(AssetProbe {
        path: canonical.to_string_lossy().into_owned(),
        name: canonical
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        kind: kind.into(),
        format: ext,
        duration_us: (duration * 1_000_000.0).round() as u64,
        sample_rate: stream["sample_rate"]
            .as_str()
            .and_then(|value| value.parse().ok()),
        channels: stream["channels"].as_u64().map(|value| value as u32),
        size_bytes: metadata.len(),
        modified_ms: metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_millis()),
        fingerprint: fingerprint(&canonical, metadata.len())?,
    })
}

#[tauri::command]
pub async fn enumerate_library_folder(folder: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || enumerate(Path::new(&folder)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn probe_library_asset(path: String) -> Result<AssetProbe, String> {
    tauri::async_runtime::spawn_blocking(move || probe(Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_asset_preview(app: AppHandle, path: String) -> Result<String, String> {
    let source = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !source.is_file() || !supported(&source) {
        return Err("Recurso no encontrado o formato incompatible.".into());
    }
    if extension(&source) == "gif" {
        app.asset_protocol_scope()
            .allow_file(&source)
            .map_err(|error| error.to_string())?;
        return Ok(source.to_string_lossy().into_owned());
    }
    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("library-preview");
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata.modified().ok().hash(&mut hasher);
    let destination = cache.join(format!("{:016x}.m4a", hasher.finish()));
    let work = destination.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
        if work.is_file() {
            return Ok(());
        }
        let temporary = work.with_extension("tmp.m4a");
        let mut command = Command::new("ffmpeg");
        command
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(&source)
            .args([
                "-t", "20", "-vn", "-c:a", "aac", "-b:a", "160k", "-f", "ipod",
            ])
            .arg(&temporary)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        let output = command.output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            let _ = fs::remove_file(&temporary);
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        fs::rename(temporary, work).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    app.asset_protocol_scope()
        .allow_file(&destination)
        .map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_builtin_assets(app: AppHandle) -> Result<Vec<Value>, String> {
    let manifest: Vec<Value> =
        serde_json::from_str(include_str!("../resources/visual-13d/manifest.json"))
            .map_err(|error| error.to_string())?;
    let mut result = Vec::with_capacity(manifest.len());
    for mut item in manifest {
        let relative = item["path"]
            .as_str()
            .ok_or("Manifest de recursos inválido.")?;
        if !relative.starts_with("visual-13d/") || relative.contains("..") {
            return Err("Ruta de recurso incluido inválida.".into());
        }
        let bundled = app
            .path()
            .resolve(format!("resources/{relative}"), BaseDirectory::Resource)
            .map_err(|error| error.to_string())?;
        let path = if bundled.is_file() {
            bundled
        } else {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join(relative)
        };
        if !path.is_file() {
            return Err(format!("Recurso incluido no encontrado: {relative}"));
        }
        item["path"] = Value::String(path.to_string_lossy().into_owned());
        result.push(item);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_supported_formats() {
        assert!(supported(Path::new("effect.WAV")));
        assert!(supported(Path::new("animation.gif")));
        assert!(!supported(Path::new("animation.webp")));
        assert!(!supported(Path::new("program.exe")));
    }
    #[test]
    fn duplicate_sample_uses_content() {
        let directory = tempfile::TempDir::new().unwrap();
        let a = directory.path().join("a.wav");
        let b = directory.path().join("b.wav");
        fs::write(&a, b"same").unwrap();
        fs::write(&b, b"same").unwrap();
        assert_eq!(fingerprint(&a, 4).unwrap(), fingerprint(&b, 4).unwrap());
        fs::write(&b, b"else").unwrap();
        assert_ne!(fingerprint(&a, 4).unwrap(), fingerprint(&b, 4).unwrap());
    }
}
