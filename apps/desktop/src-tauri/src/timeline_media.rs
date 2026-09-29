use crate::{
    media_proxy::get_proxy_status, project_storage::ProjectStorage, proxy_ffmpeg::ProxyManager,
    proxy_model::ProxyState,
};
use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    fs::{self, File},
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};

static WAVEFORM_LOCK: Mutex<()> = Mutex::new(());
const WAVEFORM_SAMPLES_PER_SECOND: u64 = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformView {
    pub start_us: u64,
    pub end_us: u64,
    pub peaks: Vec<f32>,
    pub rms: Vec<f32>,
}

fn source_key(path: &Path) -> Result<String, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("No se pudo leer el medio: {error}"))?;
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

fn project_media(app: &AppHandle, project_id: &str) -> Result<(PathBuf, PathBuf), String> {
    let storage = ProjectStorage::from_app(app).map_err(|error| error.message)?;
    let bundle = storage
        .load_project(project_id)
        .map_err(|error| error.message)?;
    let directory = storage
        .project_dir(project_id)
        .map_err(|error| error.message)?;
    Ok((PathBuf::from(bundle.source.path), directory))
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

fn run_thumbnail(source: &Path, destination: &Path, time_us: u64) -> Result<(), String> {
    let temporary = destination.with_extension("jpg.tmp");
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss"])
        .arg(format!("{:.3}", time_us as f64 / 1_000_000.0))
        .arg("-i")
        .arg(source)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=160:-2",
            "-q:v",
            "5",
            "-f",
            "image2",
        ])
        .arg(&temporary)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("No se pudo iniciar FFmpeg: {error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "No se pudo crear una miniatura: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    fs::rename(&temporary, destination)
        .map_err(|error| format!("No se pudo guardar la miniatura: {error}"))
}

#[tauri::command]
pub async fn get_import_thumbnail(
    app: AppHandle,
    path: String,
    time_us: u64,
) -> Result<String, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("El video seleccionado ya no está disponible.".into());
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("import-thumbnails")
        .join(source_key(&source)?);
    let destination = directory.join(format!("frame-{time_us}.jpg"));
    let work_destination = destination.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        if !work_destination.is_file() {
            run_thumbnail(&source, &work_destination, time_us)?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;
    app.asset_protocol_scope()
        .allow_file(&destination)
        .map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn get_timeline_thumbnail(
    app: AppHandle,
    state: State<'_, ProxyManager>,
    project_id: String,
    time_us: u64,
) -> Result<String, String> {
    let status =
        get_proxy_status(app.clone(), state, project_id.clone()).map_err(|error| error.message)?;
    let (original, project_dir) = project_media(&app, &project_id)?;
    let source = if status.state == ProxyState::Available {
        project_dir.join("media").join("proxy.mp4")
    } else {
        original
    };
    let duration = ProjectStorage::from_app(&app)
        .map_err(|error| error.message)?
        .load_project(&project_id)
        .map_err(|error| error.message)?
        .source
        .duration_us
        .unwrap_or(0);
    let time_us = time_us.min(duration.saturating_sub(1_000));
    let cache = project_dir
        .join("media")
        .join("timeline")
        .join(source_key(&source)?);
    let path = cache.join(format!("frame-{time_us}.jpg"));
    let work_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        fs::create_dir_all(&cache)
            .map_err(|error| format!("No se pudo preparar caché visual: {error}"))?;
        if !work_path.is_file() {
            run_thumbnail(&source, &work_path, time_us)?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn build_waveform(source: &Path, destination: &Path, stream_index: u32) -> Result<(), String> {
    let temporary = destination.with_extension("wave.tmp");
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(source)
        .arg("-map")
        .arg(format!("0:a:{stream_index}"))
        .args(["-vn", "-ac", "1", "-ar", "1000", "-f", "s16le", "pipe:1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("No se pudo iniciar FFmpeg: {error}"))?;
    let mut stdout = child.stdout.take().ok_or("FFmpeg no devolvió audio.")?;
    let mut file = File::create(&temporary).map_err(|error| error.to_string())?;
    let mut buffer = [0_u8; 8192];
    let mut previous = None;
    let mut sample_count = 0_u8;
    let mut peak = 0_f32;
    let mut sum_squared = 0_f32;
    let result = (|| -> Result<(), String> {
        loop {
            let read = stdout
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            for byte in &buffer[..read] {
                if let Some(low) = previous.take() {
                    let sample = i16::from_le_bytes([low, *byte]) as f32 / 32768.0;
                    let value = sample.abs();
                    peak = peak.max(value);
                    sum_squared += sample * sample;
                    sample_count += 1;
                    if sample_count == 10 {
                        file.write_all(&[
                            (peak * 255.0).round() as u8,
                            ((sum_squared / 10.0).sqrt() * 255.0).round() as u8,
                        ])
                        .map_err(|error| error.to_string())?;
                        sample_count = 0;
                        peak = 0.0;
                        sum_squared = 0.0;
                    }
                } else {
                    previous = Some(*byte);
                }
            }
        }
        if sample_count > 0 {
            file.write_all(&[
                (peak * 255.0).round() as u8,
                ((sum_squared / sample_count as f32).sqrt() * 255.0).round() as u8,
            ])
            .map_err(|error| error.to_string())?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|error| error.to_string())?;
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if !status.success() {
        let _ = fs::remove_file(&temporary);
        return Err("No se pudo extraer el audio para la forma de onda.".into());
    }
    fs::rename(&temporary, destination).map_err(|error| error.to_string())
}

fn waveform_bins(
    bytes: &[u8],
    base_bucket: u64,
    start_us: u64,
    end_us: u64,
    bins: usize,
) -> WaveformView {
    let count = bins.clamp(1, 2000);
    let duration_us = end_us.saturating_sub(start_us).max(1);
    let mut peaks = Vec::with_capacity(count);
    let mut rms = Vec::with_capacity(count);
    for index in 0..count {
        let start = ((start_us + duration_us * index as u64 / count as u64)
            * WAVEFORM_SAMPLES_PER_SECOND
            / 1_000_000)
            .saturating_sub(base_bucket) as usize;
        let end = ((start_us + duration_us * (index + 1) as u64 / count as u64)
            * WAVEFORM_SAMPLES_PER_SECOND
            / 1_000_000)
            .saturating_sub(base_bucket) as usize;
        let mut peak = 0_u8;
        let mut rms_sum = 0_f32;
        let mut samples = 0_usize;
        for bucket in start..end.max(start + 1) {
            let offset = bucket * 2;
            if offset + 1 >= bytes.len() {
                break;
            }
            peak = peak.max(bytes[offset]);
            let value = bytes[offset + 1] as f32 / 255.0;
            rms_sum += value * value;
            samples += 1;
        }
        peaks.push(peak as f32 / 255.0);
        rms.push(if samples > 0 {
            (rms_sum / samples as f32).sqrt()
        } else {
            0.0
        });
    }
    WaveformView {
        start_us,
        end_us,
        peaks,
        rms,
    }
}

fn read_waveform_window(
    path: &Path,
    start_us: u64,
    end_us: u64,
    bins: usize,
) -> Result<WaveformView, String> {
    let start_bucket = start_us.saturating_mul(WAVEFORM_SAMPLES_PER_SECOND) / 1_000_000;
    let end_bucket = end_us.saturating_mul(WAVEFORM_SAMPLES_PER_SECOND) / 1_000_000 + 1;
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(start_bucket.saturating_mul(2)))
        .map_err(|error| error.to_string())?;
    let mut bytes =
        Vec::with_capacity(end_bucket.saturating_sub(start_bucket).saturating_mul(2) as usize);
    file.take(end_bucket.saturating_sub(start_bucket).saturating_mul(2))
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(waveform_bins(&bytes, start_bucket, start_us, end_us, bins))
}

#[tauri::command]
pub async fn get_timeline_waveform(
    app: AppHandle,
    project_id: String,
    stream_index: u32,
    start_us: u64,
    end_us: u64,
    bins: usize,
) -> Result<WaveformView, String> {
    let (source, project_dir) = project_media(&app, &project_id)?;
    let bundle = ProjectStorage::from_app(&app)
        .map_err(|error| error.message)?
        .load_project(&project_id)
        .map_err(|error| error.message)?;
    if u64::from(stream_index) >= bundle.source.streams.audio {
        return Err("La pista de audio no existe.".into());
    }
    let duration = bundle.source.duration_us.unwrap_or(0);
    if start_us >= end_us || end_us > duration {
        return Err("El rango de la forma de onda no es válido.".into());
    }
    let cache = project_dir
        .join("media")
        .join("timeline")
        .join(source_key(&source)?);
    let path = cache.join(format!("audio-{stream_index}.wave"));
    tauri::async_runtime::spawn_blocking(move || -> Result<WaveformView, String> {
        let _guard = WAVEFORM_LOCK
            .lock()
            .map_err(|_| "La caché de audio no está disponible.")?;
        fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
        if !path.is_file() {
            build_waveform(&source, &path, stream_index)?;
        }
        read_waveform_window(&path, start_us, end_us, bins)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waveform_bins_keep_peaks_and_silence() {
        let data = [0, 0, 255, 128, 20, 10, 0, 0];
        let view = waveform_bins(&data, 0, 0, 40_000, 2);
        assert_eq!(view.peaks, vec![1.0, 20.0 / 255.0]);
        assert!(view.rms[0] > view.rms[1]);
    }

    #[test]
    fn waveform_window_reads_only_requested_buckets() {
        let directory = tempfile::TempDir::new().unwrap();
        let path = directory.path().join("audio.wave");
        fs::write(&path, [0, 0, 50, 20, 240, 120, 10, 5]).unwrap();
        let view = read_waveform_window(&path, 20_000, 40_000, 2).unwrap();
        assert_eq!(view.peaks, vec![240.0 / 255.0, 10.0 / 255.0]);
    }

    #[test]
    fn visual_cache_key_changes_with_source_size() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let before = source_key(file.path()).unwrap();
        fs::write(file.path(), b"new video bytes").unwrap();
        assert_ne!(before, source_key(file.path()).unwrap());
    }

    #[test]
    fn extracts_real_frame_and_audio_from_short_video_when_ffmpeg_is_available() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let directory = tempfile::TempDir::new().unwrap();
        let source = directory.path().join("source.mp4");
        let frame = directory.path().join("frame.jpg");
        let waveform = directory.path().join("audio.wave");
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
                "2",
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(generated.success());
        run_thumbnail(&source, &frame, 500_000).unwrap();
        build_waveform(&source, &waveform, 0).unwrap();
        assert!(fs::metadata(frame).unwrap().len() > 1_000);
        assert!(
            waveform_bins(&fs::read(waveform).unwrap(), 0, 0, 1_000_000, 20)
                .peaks
                .iter()
                .any(|value| *value > 0.01)
        );
    }
}
