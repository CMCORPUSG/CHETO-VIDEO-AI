use crate::{
    asset_mix::{audio_mix_graph, seamless_music_loop, AudioAssetInput},
    export::{audio_filters_from, selected_audio_stream},
    project_storage::{AssetDecision, AudioDecision, ProjectStorage},
};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tauri::{AppHandle, Manager};

const MAX_PREVIEW_US: u64 = 20_000_000;
static PREVIEW_TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

fn render(
    source: &Path,
    destination: &Path,
    start_us: u64,
    end_us: u64,
    stream: usize,
    filters: &str,
) -> Result<(), String> {
    let temporary = destination.with_extension(format!(
        "{}.m4a.tmp",
        PREVIEW_TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss"])
        .arg(format!("{:.3}", start_us as f64 / 1_000_000.0))
        .arg("-i")
        .arg(source)
        .arg("-t")
        .arg(format!("{:.3}", (end_us - start_us) as f64 / 1_000_000.0))
        .arg("-map")
        .arg(format!("0:a:{stream}"))
        .args(["-vn", "-c:a", "aac", "-b:a", "160k"]);
    if !filters.is_empty() {
        command.arg("-af").arg(filters);
    }
    command
        .args(["-f", "ipod"])
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
            "No se pudo crear la escucha de audio: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if destination.is_file() {
        let _ = fs::remove_file(&temporary);
        Ok(())
    } else {
        fs::rename(&temporary, destination).map_err(|error| error.to_string())
    }
}

fn render_with_assets(
    source: &Path,
    destination: &Path,
    start_us: u64,
    end_us: u64,
    filters: &str,
    edl: &crate::project_storage::EdlManifest,
) -> Result<(), String> {
    let mut prepared_edl = edl.clone();
    let loop_cache = destination
        .parent()
        .ok_or("Ruta de cache inválida.")?
        .join("music-loop");
    for item in &mut prepared_edl.tracks.assets {
        if item.kind == "music"
            && item.loop_
            && !item.muted
            && item.end_us > start_us
            && item.start_us < end_us
        {
            let (path, cycle_us) = seamless_music_loop(
                Path::new(&item.asset_path),
                item.source_duration_us,
                &loop_cache,
            )?;
            item.asset_path = path.to_string_lossy().into_owned();
            item.source_duration_us = cycle_us;
        }
    }
    let assets: Vec<_> = prepared_edl
        .tracks
        .assets
        .iter()
        .filter(|item| {
            !item.muted
                && item.kind != "overlay"
                && item.end_us > start_us
                && item.start_us < end_us
        })
        .collect();
    if assets.is_empty() {
        return render(
            source,
            destination,
            start_us,
            end_us,
            selected_audio_stream(edl),
            filters,
        );
    }
    let temporary = destination.with_extension(format!(
        "{}.m4a.tmp",
        PREVIEW_TEMP_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss"])
        .arg(format!("{:.6}", start_us as f64 / 1_000_000.0))
        .arg("-i")
        .arg(source);
    let mut inputs = Vec::new();
    for (slot, item) in assets.iter().enumerate() {
        if !Path::new(&item.asset_path).is_file() {
            return Err(format!("Recurso no encontrado: {}", item.asset_path));
        }
        if item.loop_ {
            command.args(["-stream_loop", "-1"]);
        }
        command.arg("-i").arg(&item.asset_path);
        inputs.push(AudioAssetInput {
            index: slot + 1,
            item,
            start_us: item.start_us,
            end_us: item.end_us,
        });
    }
    let graph = audio_mix_graph(&prepared_edl, &inputs, filters, start_us, end_us, true)
        .ok_or("No hay recursos de audio en este tramo.")?;
    command
        .args(["-filter_complex", &graph, "-map", "[aout]", "-t"])
        .arg(format!("{:.6}", (end_us - start_us) as f64 / 1_000_000.0))
        .args(["-c:a", "aac", "-b:a", "160k", "-f", "ipod"])
        .arg(&temporary)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "No se pudo mezclar la escucha: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if destination.is_file() {
        let _ = fs::remove_file(temporary);
        Ok(())
    } else {
        fs::rename(temporary, destination).map_err(|error| error.to_string())
    }
}

fn preview_cache_key(
    source: &Path,
    metadata: &fs::Metadata,
    start_us: u64,
    end_us: u64,
    stream: usize,
    filters: &str,
    processed: bool,
) -> String {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata.modified().ok().hash(&mut hasher);
    start_us.hash(&mut hasher);
    end_us.hash(&mut hasher);
    stream.hash(&mut hasher);
    filters.hash(&mut hasher);
    processed.hash(&mut hasher);
    format!("{:016x}.m4a", hasher.finish())
}

fn prune_cache(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().ends_with(".m4a.tmp"))
            {
                if entry.metadata().ok()?.modified().ok()?.elapsed().ok()?
                    > Duration::from_secs(3600)
                {
                    let _ = fs::remove_file(&path);
                }
                return None;
            }
            if path.extension().is_some_and(|ext| ext == "m4a") {
                Some((entry.metadata().ok()?.modified().ok()?, path))
            } else {
                None
            }
        })
        .collect();
    files.sort_by_key(|(modified, _)| *modified);
    let remove = files.len().saturating_sub(32);
    for (_, path) in files.into_iter().take(remove) {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub async fn render_audio_preview(
    app: AppHandle,
    project_id: String,
    start_us: u64,
    end_us: u64,
    processed: bool,
    audio_decisions: Vec<AudioDecision>,
    asset_decisions: Vec<AssetDecision>,
) -> Result<String, String> {
    let storage = ProjectStorage::from_app(&app).map_err(|error| error.message)?;
    let bundle = storage
        .load_project(&project_id)
        .map_err(|error| error.message)?;
    let duration = bundle
        .source
        .duration_us
        .ok_or("El video no tiene duración válida.")?;
    if audio_decisions.len() > 512
        || audio_decisions
            .iter()
            .any(|item| item.start_us >= item.end_us || item.end_us > duration)
    {
        return Err("Las decisiones de audio no son válidas.".into());
    }
    let mut edl = bundle.edl;
    edl.tracks.audio = audio_decisions;
    edl.tracks.assets = asset_decisions;
    let stream = selected_audio_stream(&edl);
    if stream >= bundle.source.streams.audio as usize {
        return Err("La pista de audio elegida ya no existe.".into());
    }
    if start_us >= end_us || end_us > duration || end_us - start_us > MAX_PREVIEW_US {
        return Err("Selecciona un tramo de audio válido de hasta 20 segundos.".into());
    }
    let source = PathBuf::from(&bundle.source.path);
    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;
    let filters = if processed {
        audio_filters_from(&edl, start_us)
    } else {
        String::new()
    };
    let mut cache_filters = filters.clone();
    if processed {
        for item in &edl.tracks.assets {
            if item.kind == "overlay" {
                continue;
            }
            cache_filters
                .push_str(&serde_json::to_string(item).map_err(|error| error.to_string())?);
            if let Ok(metadata) = fs::metadata(&item.asset_path) {
                cache_filters.push_str(&format!(
                    "{:?}{:?}",
                    metadata.len(),
                    metadata.modified().ok()
                ));
            }
        }
    }
    let directory = storage
        .project_dir(&project_id)
        .map_err(|error| error.message)?
        .join("media")
        .join("audio-preview");
    let destination = directory.join(preview_cache_key(
        &source,
        &metadata,
        start_us,
        end_us,
        stream,
        &cache_filters,
        processed,
    ));
    let work_destination = destination.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        if !work_destination.is_file() {
            if processed
                && edl.tracks.assets.iter().any(|item| {
                    !item.muted
                        && item.kind != "overlay"
                        && item.end_us > start_us
                        && item.start_us < end_us
                })
            {
                render_with_assets(&source, &work_destination, start_us, end_us, &filters, &edl)?;
            } else {
                render(
                    &source,
                    &work_destination,
                    start_us,
                    end_us,
                    stream,
                    &filters,
                )?;
            }
        }
        prune_cache(&directory);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;
    app.asset_protocol_scope()
        .allow_file(&destination)
        .map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_limit_is_twenty_seconds() {
        assert_eq!(MAX_PREVIEW_US, 20_000_000);
    }

    #[test]
    fn preview_cache_key_changes_with_audio_decisions() {
        let source = tempfile::NamedTempFile::new().unwrap();
        let metadata = source.as_file().metadata().unwrap();
        let key = preview_cache_key(
            source.path(),
            &metadata,
            0,
            1_000_000,
            0,
            "volume=3dB",
            true,
        );
        assert_eq!(
            key,
            preview_cache_key(
                source.path(),
                &metadata,
                0,
                1_000_000,
                0,
                "volume=3dB",
                true
            )
        );
        assert_ne!(
            key,
            preview_cache_key(
                source.path(),
                &metadata,
                0,
                1_000_000,
                0,
                "volume=6dB",
                true
            )
        );
        assert_ne!(
            key,
            preview_cache_key(
                source.path(),
                &metadata,
                0,
                1_000_000,
                1,
                "volume=3dB",
                true
            )
        );
    }

    #[test]
    fn processed_preview_changes_real_audio_level() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let directory = tempfile::TempDir::new().unwrap();
        let source = directory.path().join("source.wav");
        let original = directory.path().join("original.m4a");
        let processed = directory.path().join("processed.m4a");
        let status = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "1",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(status.success());
        render(&source, &original, 0, 1_000_000, 0, "").unwrap();
        render(&source, &processed, 0, 1_000_000, 0, "volume=6dB").unwrap();
        let rms = |path: &Path| -> f64 {
            let output = Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(path)
                .args(["-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"])
                .output()
                .unwrap();
            assert!(output.status.success());
            let samples: Vec<f64> = output
                .stdout
                .chunks_exact(2)
                .map(|sample| i16::from_le_bytes([sample[0], sample[1]]) as f64 / 32768.0)
                .collect();
            (samples.iter().map(|value| value * value).sum::<f64>() / samples.len() as f64).sqrt()
        };
        let ratio = rms(&processed) / rms(&original);
        assert!(
            ratio > 1.8 && ratio < 2.2,
            "6 dB must be audible; measured ratio {ratio}"
        );
    }

    #[test]
    fn processed_preview_renders_fades_normalization_and_voice() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let directory = tempfile::TempDir::new().unwrap();
        let source = directory.path().join("source.wav");
        let processed = directory.path().join("processed.m4a");
        let status = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "2",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(status.success());
        let edl: crate::project_storage::EdlManifest = serde_json::from_str(
            r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":2000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[],"camera":[],"broll":[],"audio":[{"id":"in","startUs":0,"endUs":2000000,"operation":"fade_in","parameters":{"durationUs":500000}},{"id":"out","startUs":0,"endUs":2000000,"operation":"fade_out","parameters":{"durationUs":500000}},{"id":"norm","startUs":0,"endUs":2000000,"operation":"normalize","parameters":{}},{"id":"voice","startUs":0,"endUs":2000000,"operation":"voice_focus","parameters":{"amount":0.5}}]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#,
        ).unwrap();
        render(
            &source,
            &processed,
            0,
            2_000_000,
            0,
            &audio_filters_from(&edl, 0),
        )
        .unwrap();
        let output = Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&processed)
            .args(["-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"])
            .output()
            .unwrap();
        assert!(output.status.success());
        let samples: Vec<f64> = output
            .stdout
            .chunks_exact(2)
            .map(|sample| i16::from_le_bytes([sample[0], sample[1]]) as f64 / 32768.0)
            .collect();
        let rms = |start: usize, end: usize| -> f64 {
            (samples[start..end]
                .iter()
                .map(|value| value * value)
                .sum::<f64>()
                / (end - start) as f64)
                .sqrt()
        };
        let middle = rms(43_200, 52_800);
        assert!(middle > 0.01);
        assert!(rms(0, 4_800) < middle * 0.5);
        assert!(rms(91_200, 96_000) < middle * 0.5);
    }
}
