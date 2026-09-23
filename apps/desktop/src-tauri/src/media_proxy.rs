use crate::{
    project_storage::ProjectStorage,
    proxy_ffmpeg::{
        emit_diagnostic, emit_progress, inspect_proxy, nvenc_capabilities, run_ffmpeg,
        ProxyManager, RunFailure,
    },
    proxy_model::{
        calculate_proxy_dimensions, proxy_is_valid, select_encoder, PlaybackKind,
        PlaybackPreference, PlaybackSource, ProxyError, ProxyManifest, ProxyOutputSnapshot,
        ProxySourceSnapshot, ProxyState, ProxyStatus, PROXY_FILE, PROXY_SCHEMA_VERSION,
    },
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{BufReader, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const MEDIA_DIR: &str = "media";
const PROXY_NAME: &str = "proxy.mp4";
const PROXY_TEMP_NAME: &str = "proxy.mp4.tmp";
const PROXY_JSON: &str = "proxy.json";

fn proxy_paths(project_dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
    let media = project_dir.join(MEDIA_DIR);
    (
        media.join(PROXY_NAME),
        media.join(PROXY_TEMP_NAME),
        media.join(PROXY_JSON),
    )
}

fn source_snapshot(path: &Path, duration_us: u64) -> Result<ProxySourceSnapshot, ProxyError> {
    let metadata = fs::metadata(path).map_err(|error| {
        ProxyError::new(
            "source-unavailable",
            format!("No se pudo verificar el archivo fuente: {error}"),
        )
    })?;
    let modified_at = metadata
        .modified()
        .ok()
        .map(|value| DateTime::<Utc>::from(value).to_rfc3339_opts(SecondsFormat::Millis, true));
    Ok(ProxySourceSnapshot {
        file_size_bytes: metadata.len(),
        modified_at,
        duration_us,
    })
}

fn read_proxy_manifest(path: &Path) -> Result<Option<ProxyManifest>, ProxyError> {
    if !path.is_file() {
        return Ok(None);
    }
    let file = File::open(path).map_err(|error| {
        ProxyError::new(
            "proxy-metadata-unavailable",
            format!("No se pudo abrir proxy.json: {error}"),
        )
    })?;
    serde_json::from_reader(BufReader::new(file))
        .map(Some)
        .map_err(|error| {
            ProxyError::new(
                "proxy-metadata-invalid",
                format!("proxy.json no es válido: {error}"),
            )
        })
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), ProxyError> {
    let parent = path.parent().ok_or_else(|| {
        ProxyError::new(
            "invalid-proxy-path",
            "La ruta del proxy no tiene directorio padre.",
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        ProxyError::new(
            "proxy-directory-failed",
            format!("No se pudo preparar media/: {error}"),
        )
    })?;
    let temporary = parent.join(format!(".proxy.{}.json.tmp", Uuid::new_v4()));
    let mut file = File::create(&temporary).map_err(|error| {
        ProxyError::new(
            "proxy-metadata-write-failed",
            format!("No se pudo crear metadata temporal: {error}"),
        )
    })?;
    serde_json::to_writer_pretty(&mut file, value).map_err(|error| {
        ProxyError::new(
            "proxy-metadata-write-failed",
            format!("No se pudo serializar proxy.json: {error}"),
        )
    })?;
    file.write_all(b"\n")
        .and_then(|_| file.sync_all())
        .map_err(|error| {
            ProxyError::new(
                "proxy-metadata-write-failed",
                format!("No se pudo sincronizar proxy.json: {error}"),
            )
        })?;
    drop(file);
    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            ProxyError::new(
                "proxy-metadata-replace-failed",
                format!("No se pudo reemplazar proxy.json: {error}"),
            )
        })?;
    }
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        ProxyError::new(
            "proxy-metadata-replace-failed",
            format!("No se pudo activar proxy.json: {error}"),
        )
    })
}

fn remove_temp(path: &Path) {
    if path.exists() {
        let _ = fs::remove_file(path);
    }
}

fn replace_proxy(temp: &Path, destination: &Path) -> Result<(), ProxyError> {
    let backup = destination.with_extension(format!("mp4.{}.bak", Uuid::new_v4()));
    if destination.exists() {
        fs::rename(destination, &backup).map_err(|error| {
            ProxyError::new(
                "proxy-replace-failed",
                format!("No se pudo preparar el proxy anterior: {error}"),
            )
        })?;
    }
    if let Err(error) = fs::rename(temp, destination) {
        if backup.exists() {
            let _ = fs::rename(&backup, destination);
        }
        remove_temp(temp);
        return Err(ProxyError::new(
            "proxy-replace-failed",
            format!("No se pudo activar el proxy: {error}"),
        ));
    }
    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn proxy_status_impl(
    app: &AppHandle,
    manager: &ProxyManager,
    project_id: &str,
) -> Result<ProxyStatus, ProxyError> {
    let storage = ProjectStorage::from_app(app).map_err(|_| {
        ProxyError::new(
            "project-storage-error",
            "No se pudo abrir el almacenamiento del proyecto.",
        )
    })?;
    ProjectStorage::validate_id(project_id, "projectId")
        .map_err(|_| ProxyError::new("invalid-project-id", "projectId no es un UUID válido."))?;
    if manager.is_running(project_id) {
        return Ok(ProxyStatus {
            state: ProxyState::Generating,
            progress: None,
            processed_us: None,
            metadata: None,
            message: None,
        });
    }
    let bundle = storage
        .load_project(project_id)
        .map_err(|_| ProxyError::new("project-not-found", "No se pudo cargar el proyecto."))?;
    let duration_us = bundle.source.duration_us.ok_or_else(|| {
        ProxyError::new(
            "duration-unavailable",
            "source.json no contiene duración válida.",
        )
    })?;
    let current = source_snapshot(Path::new(&bundle.source.path), duration_us)?;
    let project_dir = storage
        .project_dir(project_id)
        .map_err(|_| ProxyError::new("invalid-project-id", "projectId no es válido."))?;
    let (proxy, _, metadata_path) = proxy_paths(&project_dir);
    let Some(metadata) = read_proxy_manifest(&metadata_path)? else {
        return Ok(ProxyStatus {
            state: ProxyState::NotCreated,
            progress: None,
            processed_us: None,
            metadata: None,
            message: None,
        });
    };
    let valid = proxy_is_valid(&metadata, &bundle.source.source_id, &current, &proxy);
    Ok(ProxyStatus {
        state: if valid {
            ProxyState::Available
        } else {
            ProxyState::Stale
        },
        progress: None,
        processed_us: None,
        metadata: Some(metadata),
        message: None,
    })
}

fn create_proxy_impl(
    app: AppHandle,
    manager: ProxyManager,
    project_id: String,
) -> Result<ProxyStatus, ProxyError> {
    ProjectStorage::validate_id(&project_id, "projectId")
        .map_err(|_| ProxyError::new("invalid-project-id", "projectId no es un UUID válido."))?;
    let cancelled = manager.claim(&project_id)?;
    let result = (|| {
        emit_diagnostic(&app, &project_id, "PROXY_STARTED");
        emit_progress(&app, &project_id, ProxyState::Preparing, 0.0, 0);
        let storage = ProjectStorage::from_app(&app).map_err(|_| {
            ProxyError::new(
                "project-storage-error",
                "No se pudo abrir el almacenamiento del proyecto.",
            )
        })?;
        let bundle = storage
            .load_project(&project_id)
            .map_err(|_| ProxyError::new("project-not-found", "No se pudo cargar el proyecto."))?;
        let duration_us = bundle.source.duration_us.ok_or_else(|| {
            ProxyError::new(
                "duration-unavailable",
                "source.json no contiene duración válida.",
            )
        })?;
        let input = PathBuf::from(&bundle.source.path);
        let current = source_snapshot(&input, duration_us)?;
        let width = bundle
            .source
            .video
            .display_width
            .or(bundle.source.video.width)
            .and_then(|value| u32::try_from(value).ok())
            .ok_or_else(|| {
                ProxyError::new(
                    "dimensions-unavailable",
                    "source.json no contiene ancho válido.",
                )
            })?;
        let height = bundle
            .source
            .video
            .display_height
            .or(bundle.source.video.height)
            .and_then(|value| u32::try_from(value).ok())
            .ok_or_else(|| {
                ProxyError::new(
                    "dimensions-unavailable",
                    "source.json no contiene alto válido.",
                )
            })?;
        let dimensions = calculate_proxy_dimensions(width, height).ok_or_else(|| {
            ProxyError::new(
                "dimensions-unavailable",
                "No se pudieron calcular dimensiones de proxy.",
            )
        })?;
        let fps_value = bundle
            .source
            .video
            .fps
            .decimal
            .filter(|value| *value > 0.0)
            .unwrap_or(30.0);
        let project_dir = storage
            .project_dir(&project_id)
            .map_err(|_| ProxyError::new("invalid-project-id", "projectId no es válido."))?;
        let (proxy, temporary, metadata_path) = proxy_paths(&project_dir);
        fs::create_dir_all(proxy.parent().unwrap()).map_err(|error| {
            ProxyError::new(
                "proxy-directory-failed",
                format!("No se pudo preparar media/: {error}"),
            )
        })?;
        remove_temp(&temporary);
        let (advertised, validated) = nvenc_capabilities();
        let mut encoder = select_encoder(advertised, validated);
        emit_diagnostic(
            &app,
            &project_id,
            &format!("PROXY_ENCODER_SELECTED:{encoder}"),
        );
        match run_ffmpeg(
            &app,
            &manager,
            &project_id,
            &cancelled,
            &input,
            &temporary,
            dimensions,
            fps_value,
            duration_us,
            encoder,
        ) {
            Ok(()) => {}
            Err(RunFailure::Cancelled) => {
                emit_diagnostic(&app, &project_id, "PROXY_CANCELLED");
                return Ok(ProxyStatus {
                    state: ProxyState::Cancelled,
                    progress: Some(0.0),
                    processed_us: None,
                    metadata: None,
                    message: Some("Generación cancelada.".into()),
                });
            }
            Err(RunFailure::Failed(_)) if encoder == "h264_nvenc" => {
                emit_diagnostic(&app, &project_id, "PROXY_NVENC_FALLBACK");
                encoder = "libx264";
                match run_ffmpeg(
                    &app,
                    &manager,
                    &project_id,
                    &cancelled,
                    &input,
                    &temporary,
                    dimensions,
                    fps_value,
                    duration_us,
                    encoder,
                ) {
                    Ok(()) => {}
                    Err(RunFailure::Cancelled) => {
                        emit_diagnostic(&app, &project_id, "PROXY_CANCELLED");
                        return Ok(ProxyStatus {
                            state: ProxyState::Cancelled,
                            progress: Some(0.0),
                            processed_us: None,
                            metadata: None,
                            message: Some("Generación cancelada.".into()),
                        });
                    }
                    Err(RunFailure::Failed(message)) => {
                        return Err(ProxyError::new(
                            "proxy-encoding-failed",
                            format!("FFmpeg no pudo crear el proxy: {message}"),
                        ))
                    }
                }
            }
            Err(RunFailure::Failed(message)) => {
                return Err(ProxyError::new(
                    "proxy-encoding-failed",
                    format!("FFmpeg no pudo crear el proxy: {message}"),
                ))
            }
        }
        let (codec, actual_width, actual_height, fps) = match inspect_proxy(&temporary) {
            Ok(metadata) => metadata,
            Err(error) => {
                remove_temp(&temporary);
                return Err(error);
            }
        };
        replace_proxy(&temporary, &proxy)?;
        let proxy_size = fs::metadata(&proxy)
            .map_err(|error| {
                ProxyError::new(
                    "proxy-validation-failed",
                    format!("No se pudo medir el proxy: {error}"),
                )
            })?
            .len();
        let manifest = ProxyManifest {
            schema_version: PROXY_SCHEMA_VERSION,
            source_id: bundle.source.source_id,
            created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            source: current,
            proxy: ProxyOutputSnapshot {
                file: PROXY_FILE.into(),
                codec,
                width: actual_width,
                height: actual_height,
                fps,
                encoder: encoder.into(),
                file_size_bytes: proxy_size,
            },
        };
        if let Err(error) = write_json_atomic(&metadata_path, &manifest) {
            let _ = fs::remove_file(&proxy);
            return Err(error);
        }
        emit_progress(&app, &project_id, ProxyState::Available, 100.0, duration_us);
        emit_diagnostic(&app, &project_id, "PROXY_COMPLETED");
        Ok(ProxyStatus {
            state: ProxyState::Available,
            progress: Some(100.0),
            processed_us: Some(duration_us),
            metadata: Some(manifest),
            message: None,
        })
    })();
    manager.release(&project_id);
    if result.is_err() {
        emit_diagnostic(&app, &project_id, "PROXY_FAILED");
    }
    result
}

#[tauri::command]
pub fn get_proxy_status(
    app: AppHandle,
    state: State<'_, ProxyManager>,
    project_id: String,
) -> Result<ProxyStatus, ProxyError> {
    proxy_status_impl(&app, state.inner(), &project_id)
}

#[tauri::command]
pub async fn create_proxy(
    app: AppHandle,
    state: State<'_, ProxyManager>,
    project_id: String,
) -> Result<ProxyStatus, ProxyError> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || create_proxy_impl(app, manager, project_id))
        .await
        .map_err(|error| {
            ProxyError::new(
                "proxy-task-failed",
                format!("La tarea de proxy falló: {error}"),
            )
        })?
}

#[tauri::command]
pub fn cancel_proxy(
    app: AppHandle,
    state: State<'_, ProxyManager>,
    project_id: String,
) -> Result<ProxyStatus, ProxyError> {
    ProjectStorage::validate_id(&project_id, "projectId")
        .map_err(|_| ProxyError::new("invalid-project-id", "projectId no es un UUID válido."))?;
    if state.cancel(&project_id)? {
        Ok(ProxyStatus {
            state: ProxyState::Cancelled,
            progress: None,
            processed_us: None,
            metadata: None,
            message: Some("Cancelación solicitada.".into()),
        })
    } else {
        proxy_status_impl(&app, state.inner(), &project_id)
    }
}

#[tauri::command]
pub fn delete_proxy(
    app: AppHandle,
    state: State<'_, ProxyManager>,
    project_id: String,
) -> Result<ProxyStatus, ProxyError> {
    if state.is_running(&project_id) {
        return Err(ProxyError::new(
            "proxy-running",
            "Cancela la generación antes de eliminar el proxy.",
        ));
    }
    let storage = ProjectStorage::from_app(&app).map_err(|_| {
        ProxyError::new(
            "project-storage-error",
            "No se pudo abrir el almacenamiento.",
        )
    })?;
    let project_dir = storage
        .project_dir(&project_id)
        .map_err(|_| ProxyError::new("invalid-project-id", "projectId no es válido."))?;
    let (proxy, temporary, metadata) = proxy_paths(&project_dir);
    for path in [proxy, temporary, metadata] {
        if path.exists() {
            fs::remove_file(path).map_err(|error| {
                ProxyError::new(
                    "proxy-delete-failed",
                    format!("No se pudo eliminar el proxy: {error}"),
                )
            })?;
        }
    }
    Ok(ProxyStatus {
        state: ProxyState::NotCreated,
        progress: None,
        processed_us: None,
        metadata: None,
        message: None,
    })
}

#[tauri::command]
pub fn get_playback_source(
    app: AppHandle,
    state: State<'_, ProxyManager>,
    project_id: String,
    preference: PlaybackPreference,
) -> Result<PlaybackSource, ProxyError> {
    let storage = ProjectStorage::from_app(&app).map_err(|_| {
        ProxyError::new(
            "project-storage-error",
            "No se pudo abrir el almacenamiento.",
        )
    })?;
    let bundle = storage
        .load_project(&project_id)
        .map_err(|_| ProxyError::new("project-not-found", "No se pudo cargar el proyecto."))?;
    let duration_us = bundle.source.duration_us.ok_or_else(|| {
        ProxyError::new(
            "duration-unavailable",
            "source.json no contiene duración válida.",
        )
    })?;
    let status = proxy_status_impl(&app, state.inner(), &project_id)?;
    let project_dir = storage
        .project_dir(&project_id)
        .map_err(|_| ProxyError::new("invalid-project-id", "projectId no es válido."))?;
    let proxy_path = proxy_paths(&project_dir).0;
    let use_proxy = match preference {
        PlaybackPreference::Auto => status.state == ProxyState::Available,
        PlaybackPreference::Proxy => true,
        PlaybackPreference::Original => false,
    };
    let (kind, path) = if use_proxy {
        if status.state != ProxyState::Available {
            return Err(ProxyError::new(
                "proxy-unavailable",
                "No existe un proxy válido para este proyecto.",
            ));
        }
        (PlaybackKind::Proxy, proxy_path)
    } else {
        (PlaybackKind::Original, PathBuf::from(bundle.source.path))
    };
    if !path.is_file() {
        return Err(ProxyError::new(
            "playback-source-missing",
            "El archivo de reproducción no existe.",
        ));
    }
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| {
            ProxyError::new(
                "playback-scope-failed",
                format!("No se pudo autorizar el archivo local: {error}"),
            )
        })?;
    emit_diagnostic(&app, &project_id, "PLAYBACK_SOURCE_RESOLVED");
    Ok(PlaybackSource {
        kind,
        path: path.to_string_lossy().into_owned(),
        duration_us,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn project_id_validation_is_reused() {
        assert!(ProjectStorage::validate_id("../escape", "projectId").is_err());
        assert!(
            ProjectStorage::validate_id("8528d0fa-df35-4df0-b386-2201d36d808b", "projectId")
                .is_ok()
        );
    }

    #[test]
    fn temporary_proxy_is_cleaned() {
        let temp = TempDir::new().unwrap();
        let file = temp.path().join(PROXY_TEMP_NAME);
        fs::write(&file, b"incomplete").unwrap();
        remove_temp(&file);
        assert!(!file.exists());
    }

    #[test]
    fn cancellation_does_not_touch_project_manifests() {
        let temp = TempDir::new().unwrap();
        for file in ["project.json", "source.json", "edl.json"] {
            fs::write(temp.path().join(file), file).unwrap();
        }
        let incomplete = temp.path().join(PROXY_TEMP_NAME);
        fs::write(&incomplete, b"partial").unwrap();
        remove_temp(&incomplete);
        for file in ["project.json", "source.json", "edl.json"] {
            assert_eq!(fs::read_to_string(temp.path().join(file)).unwrap(), file);
        }
    }
}
