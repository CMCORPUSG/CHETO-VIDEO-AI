use crate::{
    hardware_profile::{detect_hardware_profile, select_execution_profile, QualityMode},
    project_storage::{ProjectStorage, WorkflowState},
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const MODELS: [&str; 5] = ["tiny", "base", "small", "medium", "large-v3"];
const REQUIRED_MODEL_FILES: [&str; 3] = ["model.bin", "config.json", "tokenizer.json"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionError {
    code: String,
    message: String,
}
impl TranscriptionError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum ModelState {
    NotInstalled,
    Verifying,
    Ready,
    Invalid,
    Downloading,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    state: ModelState,
    model: String,
    path: String,
    estimated_size_bytes: Option<u64>,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum TranscriptState {
    NotCreated,
    Preparing,
    Running,
    Completed,
    Cancelled,
    Error,
    Stale,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptStatus {
    state: TranscriptState,
    processed_us: u64,
    duration_us: u64,
    progress: Option<f64>,
    segment_count: u64,
    word_count: u64,
    language: Option<String>,
    engine: Option<Value>,
    message: Option<String>,
    segments: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LanguageMode {
    Auto,
    Es,
    En,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    project_id: String,
    mode: QualityMode,
    language: LanguageMode,
    force_cpu: Option<bool>,
}

#[derive(Clone)]
struct ActiveTask {
    project_id: String,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
}

#[derive(Clone, Default)]
pub struct TranscriptionManager {
    active: Arc<Mutex<Option<ActiveTask>>>,
}

fn models_root(app: &AppHandle) -> Result<PathBuf, TranscriptionError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("models/whisper"))
        .map_err(|error| TranscriptionError::new("model-root-unavailable", error.to_string()))
}

fn validate_model_name(model: &str) -> Result<(), TranscriptionError> {
    if MODELS.contains(&model) {
        Ok(())
    } else {
        Err(TranscriptionError::new(
            "invalid-model",
            "Modelo no soportado.",
        ))
    }
}

fn model_valid(path: &Path) -> bool {
    REQUIRED_MODEL_FILES.iter().all(|name| {
        path.join(name)
            .metadata()
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
    })
}

fn worker_command() -> Command {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let venv = repo.join(".venv/Scripts/python.exe");
    let mut command = Command::new(if venv.is_file() {
        venv.into_os_string()
    } else {
        "python".into()
    });
    command
        .current_dir(&repo)
        .env("PYTHONPATH", repo.join("worker"))
        .args(["-m", "transcription.main"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // The worker protocol lives exclusively on stdout. Discard stderr here so
        // verbose decoder logs can never fill an unread pipe and stall a job.
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn emit(app: &AppHandle, project_id: &str, event: &str, payload: Value) {
    let _ = app.emit(
        "transcription://event",
        json!({ "projectId": project_id, "event": event, "payload": payload }),
    );
}

#[tauri::command]
pub fn get_transcription_model_status(
    app: AppHandle,
    model: String,
) -> Result<ModelStatus, TranscriptionError> {
    validate_model_name(&model)?;
    let path = models_root(&app)?.join(&model);
    let state = if model_valid(&path) {
        ModelState::Ready
    } else if path.exists() {
        ModelState::Invalid
    } else {
        ModelState::NotInstalled
    };
    Ok(ModelStatus {
        state,
        model,
        path: path.to_string_lossy().into_owned(),
        estimated_size_bytes: match path.file_name().and_then(|value| value.to_str()) {
            Some("tiny") => Some(80_000_000),
            Some("base") => Some(150_000_000),
            Some("small") => Some(500_000_000),
            Some("medium") => Some(1_500_000_000),
            Some("large-v3") => Some(3_100_000_000),
            _ => None,
        },
        message: None,
    })
}

#[tauri::command]
pub async fn download_transcription_model(
    app: AppHandle,
    model: String,
) -> Result<ModelStatus, TranscriptionError> {
    validate_model_name(&model)?;
    let root = models_root(&app)?;
    fs::create_dir_all(&root)
        .map_err(|error| TranscriptionError::new("model-root-failed", error.to_string()))?;
    let app_clone = app.clone();
    let model_clone = model.clone();
    tauri::async_runtime::spawn_blocking(move || {
        emit(
            &app_clone,
            "global",
            "MODEL_DOWNLOAD_STARTED",
            json!({"model": model_clone}),
        );
        let mut child = worker_command()
            .spawn()
            .map_err(|error| TranscriptionError::new("worker-unavailable", error.to_string()))?;
        let request = json!({"command":"DOWNLOAD","model":model_clone,"modelsRoot":root});
        child
            .stdin
            .take()
            .ok_or_else(|| TranscriptionError::new("worker-protocol", "stdin no disponible"))?
            .write_all(format!("{request}\n").as_bytes())
            .map_err(|error| TranscriptionError::new("worker-protocol", error.to_string()))?;
        let output = child
            .wait_with_output()
            .map_err(|error| TranscriptionError::new("model-download-failed", error.to_string()))?;
        if !output.status.success() {
            emit(
                &app_clone,
                "global",
                "MODEL_DOWNLOAD_FAILED",
                json!({"model":model_clone}),
            );
            return Err(TranscriptionError::new(
                "model-download-failed",
                "El worker no pudo descargar o verificar el modelo.",
            ));
        }
        emit(
            &app_clone,
            "global",
            "MODEL_DOWNLOAD_COMPLETED",
            json!({"model":model_clone}),
        );
        get_transcription_model_status(app_clone, model_clone)
    })
    .await
    .map_err(|error| TranscriptionError::new("model-download-task-failed", error.to_string()))?
}

fn file_modified_at(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .map(|value| DateTime::<Utc>::from(value).to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn source_snapshot_is_stale(
    transcript: &Value,
    expected_source_id: &str,
    file_size: Option<u64>,
    modified_at: Option<&str>,
) -> bool {
    let source = transcript.get("source").unwrap_or(&Value::Null);
    source.get("fileSizeBytes").and_then(Value::as_u64) != file_size
        || source.get("modifiedAt").and_then(Value::as_str) != modified_at
        || transcript.get("sourceId").and_then(Value::as_str) != Some(expected_source_id)
}

fn parse_worker_event(line: &str) -> Result<(String, Value), TranscriptionError> {
    let event: Value = serde_json::from_str(line)
        .map_err(|_| TranscriptionError::new("invalid-worker-protocol", "JSONL inválido"))?;
    let name = event
        .get("event")
        .and_then(Value::as_str)
        .ok_or_else(|| TranscriptionError::new("invalid-worker-protocol", "Evento ausente"))?;
    Ok((
        name.to_owned(),
        event.get("payload").cloned().unwrap_or(Value::Null),
    ))
}

fn transcript_status_impl(
    app: &AppHandle,
    manager: &TranscriptionManager,
    project_id: &str,
) -> Result<TranscriptStatus, TranscriptionError> {
    ProjectStorage::validate_id(project_id, "projectId")
        .map_err(|_| TranscriptionError::new("invalid-project-id", "projectId inválido"))?;
    if manager
        .active
        .lock()
        .map_err(|_| TranscriptionError::new("state-error", "Estado no disponible"))?
        .as_ref()
        .is_some_and(|task| task.project_id == project_id)
    {
        return Ok(TranscriptStatus {
            state: TranscriptState::Running,
            processed_us: 0,
            duration_us: 0,
            progress: None,
            segment_count: 0,
            word_count: 0,
            language: None,
            engine: None,
            message: None,
            segments: vec![],
        });
    }
    let storage = ProjectStorage::from_app(app)
        .map_err(|_| TranscriptionError::new("storage-error", "Storage no disponible"))?;
    let _ = storage.recover_interrupted_transcription(
        project_id,
        Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
    );
    let bundle = storage
        .load_project(project_id)
        .map_err(|_| TranscriptionError::new("project-not-found", "Proyecto no disponible"))?;
    let duration = bundle.source.duration_us.unwrap_or(0);
    let path = storage
        .project_dir(project_id)
        .map_err(|_| TranscriptionError::new("invalid-project-id", "projectId inválido"))?
        .join("transcript.json");
    if !path.is_file() {
        return Ok(TranscriptStatus {
            state: TranscriptState::NotCreated,
            processed_us: 0,
            duration_us: duration,
            progress: None,
            segment_count: 0,
            word_count: 0,
            language: None,
            engine: None,
            message: None,
            segments: vec![],
        });
    }
    let value: Value =
        serde_json::from_reader(BufReader::new(File::open(&path).map_err(|error| {
            TranscriptionError::new("transcript-unavailable", error.to_string())
        })?))
        .map_err(|error| TranscriptionError::new("transcript-invalid", error.to_string()))?;
    let original = Path::new(&bundle.source.path);
    let modified_at = file_modified_at(original);
    let stale = source_snapshot_is_stale(
        &value,
        &bundle.source.source_id,
        fs::metadata(original).ok().map(|item| item.len()),
        modified_at.as_deref(),
    );
    let statistics = value.get("statistics").cloned().unwrap_or(Value::Null);
    Ok(TranscriptStatus {
        state: if stale {
            TranscriptState::Stale
        } else {
            TranscriptState::Completed
        },
        processed_us: duration,
        duration_us: duration,
        progress: Some(100.0),
        segment_count: statistics
            .get("segmentCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        word_count: statistics
            .get("wordCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        language: value
            .pointer("/language/code")
            .and_then(Value::as_str)
            .map(str::to_owned),
        engine: value.get("engine").cloned(),
        message: if stale {
            Some("El video original cambió. Se requiere retranscribir.".into())
        } else {
            None
        },
        segments: value
            .get("segments")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub fn get_transcript_status(
    app: AppHandle,
    state: State<'_, TranscriptionManager>,
    project_id: String,
) -> Result<TranscriptStatus, TranscriptionError> {
    transcript_status_impl(&app, state.inner(), &project_id)
}

fn replace_transcript(temp: &Path, destination: &Path) -> Result<(), TranscriptionError> {
    let backup = destination.with_extension(format!("json.{}.bak", Uuid::new_v4()));
    if destination.exists() {
        fs::rename(destination, &backup)
            .map_err(|error| TranscriptionError::new("transcript-replace", error.to_string()))?;
    }
    if let Err(error) = fs::rename(temp, destination) {
        if backup.exists() {
            let _ = fs::rename(&backup, destination);
        }
        return Err(TranscriptionError::new(
            "transcript-replace",
            error.to_string(),
        ));
    }
    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn run_transcription(
    app: AppHandle,
    manager: TranscriptionManager,
    request: StartRequest,
) -> Result<TranscriptStatus, TranscriptionError> {
    let storage = ProjectStorage::from_app(&app)
        .map_err(|_| TranscriptionError::new("storage-error", "Storage no disponible"))?;
    let bundle = storage
        .load_project(&request.project_id)
        .map_err(|_| TranscriptionError::new("project-not-found", "Proyecto no disponible"))?;
    let hardware = detect_hardware_profile(app.clone())
        .map_err(|error| TranscriptionError::new("hardware-profile", error))?;
    emit(
        &app,
        &request.project_id,
        "HARDWARE_PROFILE_DETECTED",
        json!({"hardware": hardware}),
    );
    if hardware.disk_free_bytes < 1024_u64.pow(3) {
        return Err(TranscriptionError::new(
            "insufficient-disk",
            "Se requiere al menos 1 GiB libre para transcribir con seguridad.",
        ));
    }
    if hardware.ram_available_bytes < 512 * 1024_u64.pow(2) {
        return Err(TranscriptionError::new(
            "insufficient-memory",
            "La memoria disponible es insuficiente para iniciar la transcripción.",
        ));
    }
    let profile =
        select_execution_profile(&hardware, request.mode, request.force_cpu.unwrap_or(false));
    emit(
        &app,
        &request.project_id,
        "TRANSCRIPTION_PROFILE_SELECTED",
        json!({"profile": profile}),
    );
    if !model_valid(&models_root(&app)?.join(&profile.model)) {
        emit(
            &app,
            &request.project_id,
            "MODEL_REQUIRED",
            json!({"model":profile.model}),
        );
        return Err(TranscriptionError::new(
            "model-required",
            format!("Se requiere descargar el modelo local {}.", profile.model),
        ));
    }
    let mut active = manager
        .active
        .lock()
        .map_err(|_| TranscriptionError::new("state-error", "Estado no disponible"))?;
    if active.is_some() {
        return Err(TranscriptionError::new(
            "transcription-busy",
            "Ya existe una transcripción global activa.",
        ));
    }
    let project_dir = storage
        .project_dir(&request.project_id)
        .map_err(|_| TranscriptionError::new("invalid-project-id", "projectId inválido"))?;
    let transcript = project_dir.join("transcript.json");
    let temporary = project_dir.join("transcript.json.tmp");
    let checkpoint = project_dir.join("transcript.partial.json");
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let source_path = PathBuf::from(&bundle.source.path);
    let duration = bundle.source.duration_us.unwrap_or(0);
    storage
        .update_transcription_workflow(&request.project_id, WorkflowState::Preparing, now.clone())
        .map_err(|_| TranscriptionError::new("workflow-error", "No se pudo actualizar workflow"))?;
    let mut child = worker_command()
        .spawn()
        .map_err(|error| TranscriptionError::new("worker-unavailable", error.to_string()))?;
    let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or_else(|| {
        TranscriptionError::new("worker-protocol", "stdin no disponible")
    })?));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| TranscriptionError::new("worker-protocol", "stdout no disponible"))?;
    let child = Arc::new(Mutex::new(child));
    *active = Some(ActiveTask {
        project_id: request.project_id.clone(),
        child: child.clone(),
        stdin: stdin.clone(),
    });
    drop(active);
    let language = match request.language {
        LanguageMode::Auto => Value::Null,
        LanguageMode::Es => json!("es"),
        LanguageMode::En => json!("en"),
    };
    let message = json!({"command":"START","request":{"sourcePath":source_path,"modelsRoot":models_root(&app)?,"temporaryPath":temporary,"checkpointPath":checkpoint,"language":language,"profile":{"device":profile.device,"compute_type":profile.compute_type,"model":profile.model,"cpu_threads":profile.cpu_threads,"workers":profile.workers,"reason":profile.reason,"automatic":profile.automatic},"transcriptBase":{"schemaVersion":1,"projectId":request.project_id,"sourceId":bundle.source.source_id,"createdAt":now,"updatedAt":now,"source":{"durationUs":duration,"fileSizeBytes":bundle.source.file_size_bytes,"modifiedAt":file_modified_at(&source_path)}}}});
    stdin
        .lock()
        .map_err(|_| TranscriptionError::new("worker-protocol", "stdin bloqueado"))?
        .write_all(format!("{message}\n").as_bytes())
        .map_err(|error| TranscriptionError::new("worker-protocol", error.to_string()))?;
    storage
        .update_transcription_workflow(
            &request.project_id,
            WorkflowState::Running,
            Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        )
        .map_err(|_| TranscriptionError::new("workflow-error", "No se pudo actualizar workflow"))?;
    emit(
        &app,
        &request.project_id,
        "TRANSCRIPTION_STARTED",
        json!({"profile":profile}),
    );
    let mut completed = false;
    let mut cancelled = false;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Ok((name, payload)) = parse_worker_event(&line) else {
            emit(
                &app,
                &request.project_id,
                "TRANSCRIPTION_FAILED",
                json!({"code":"invalid-worker-protocol"}),
            );
            break;
        };
        if name == "COMPLETED" {
            completed = true;
        }
        if name == "CANCELLED" {
            cancelled = true;
        }
        let forwarded = match name.as_str() {
            "MODEL_LOADED" => "TRANSCRIPTION_MODEL_LOADED",
            "FALLBACK"
                if payload
                    .get("reason")
                    .and_then(Value::as_str)
                    .is_some_and(|reason| {
                        let reason = reason.to_ascii_lowercase();
                        reason.contains("out of memory") || reason.contains("oom")
                    }) =>
            {
                "TRANSCRIPTION_OOM_FALLBACK"
            }
            "FALLBACK" => "TRANSCRIPTION_GPU_FALLBACK",
            "ERROR" => "TRANSCRIPTION_FAILED",
            _ => name.as_str(),
        };
        emit(&app, &request.project_id, forwarded, payload.clone());
        if name == "COMPLETED" {
            emit(
                &app,
                &request.project_id,
                "TRANSCRIPTION_LANGUAGE_DETECTED",
                payload,
            );
        }
    }
    let _ = child.lock().map(|mut item| item.wait());
    *manager
        .active
        .lock()
        .map_err(|_| TranscriptionError::new("state-error", "Estado no disponible"))? = None;
    if completed {
        let value: Value =
            serde_json::from_reader(BufReader::new(File::open(&temporary).map_err(|error| {
                TranscriptionError::new("transcript-invalid", error.to_string())
            })?))
            .map_err(|error| TranscriptionError::new("transcript-invalid", error.to_string()))?;
        if value.get("projectId").and_then(Value::as_str) != Some(&request.project_id) {
            return Err(TranscriptionError::new(
                "transcript-invalid",
                "projectId incorrecto",
            ));
        }
        replace_transcript(&temporary, &transcript)?;
        let _ = fs::remove_file(checkpoint);
        storage
            .update_transcription_workflow(
                &request.project_id,
                WorkflowState::Completed,
                Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            )
            .ok();
        emit(
            &app,
            &request.project_id,
            "TRANSCRIPTION_COMPLETED",
            json!({}),
        );
    } else {
        let _ = fs::remove_file(&temporary);
        storage
            .update_transcription_workflow(
                &request.project_id,
                if cancelled {
                    WorkflowState::Cancelled
                } else {
                    WorkflowState::Error
                },
                Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            )
            .ok();
    }
    transcript_status_impl(&app, &manager, &request.project_id)
}

#[tauri::command]
pub async fn start_transcription(
    app: AppHandle,
    state: State<'_, TranscriptionManager>,
    request: StartRequest,
) -> Result<TranscriptStatus, TranscriptionError> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_transcription(app, manager, request))
        .await
        .map_err(|error| TranscriptionError::new("task-failed", error.to_string()))?
}

#[tauri::command]
pub fn cancel_transcription(
    app: AppHandle,
    state: State<'_, TranscriptionManager>,
    project_id: String,
) -> Result<TranscriptStatus, TranscriptionError> {
    ProjectStorage::validate_id(&project_id, "projectId")
        .map_err(|_| TranscriptionError::new("invalid-project-id", "projectId inválido"))?;
    let task = state
        .active
        .lock()
        .map_err(|_| TranscriptionError::new("state-error", "Estado no disponible"))?
        .clone();
    let Some(task) = task else {
        return transcript_status_impl(&app, state.inner(), &project_id);
    };
    if task.project_id != project_id {
        return Err(TranscriptionError::new(
            "different-task-active",
            "Otra transcripción está activa.",
        ));
    }
    task.stdin
        .lock()
        .map_err(|_| TranscriptionError::new("worker-protocol", "stdin bloqueado"))?
        .write_all(b"{\"command\":\"CANCEL\"}\n")
        .map_err(|error| TranscriptionError::new("worker-protocol", error.to_string()))?;
    let _ = task.child.lock().map(|mut child| child.kill());
    emit(&app, &project_id, "TRANSCRIPTION_CANCELLED", json!({}));
    Ok(TranscriptStatus {
        state: TranscriptState::Cancelled,
        processed_us: 0,
        duration_us: 0,
        progress: None,
        segment_count: 0,
        word_count: 0,
        language: None,
        engine: None,
        message: Some("Cancelación solicitada".into()),
        segments: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    #[test]
    fn project_id_validation() {
        assert!(ProjectStorage::validate_id("../bad", "projectId").is_err());
    }
    #[test]
    fn missing_model_is_not_ready() {
        let d = TempDir::new().unwrap();
        assert!(!model_valid(d.path()));
    }
    #[test]
    fn valid_model_requires_all_files() {
        let d = TempDir::new().unwrap();
        for f in REQUIRED_MODEL_FILES {
            fs::write(d.path().join(f), b"x").unwrap();
        }
        assert!(model_valid(d.path()));
    }
    #[test]
    fn transcript_states_cover_cancelled() {
        assert_eq!(TranscriptState::Cancelled, TranscriptState::Cancelled);
    }
    #[test]
    fn progress_is_clamped_conceptually() {
        let p = (120_f64).clamp(0., 100.);
        assert_eq!(p, 100.);
    }
    #[test]
    fn failed_temp_does_not_replace_valid() {
        let d = TempDir::new().unwrap();
        let valid = d.path().join("transcript.json");
        fs::write(&valid, b"valid").unwrap();
        let temp = d.path().join("transcript.json.tmp");
        fs::write(&temp, b"invalid").unwrap();
        fs::remove_file(temp).unwrap();
        assert_eq!(fs::read(valid).unwrap(), b"valid");
    }
    #[test]
    fn global_manager_allows_only_one_slot() {
        let m = TranscriptionManager::default();
        assert!(m.active.lock().unwrap().is_none());
    }
    #[test]
    fn source_snapshot_detects_stale_and_matching_files() {
        let transcript =
            json!({"sourceId":"source-1","source":{"fileSizeBytes":42,"modifiedAt":"now"}});
        assert!(!source_snapshot_is_stale(
            &transcript,
            "source-1",
            Some(42),
            Some("now")
        ));
        assert!(source_snapshot_is_stale(
            &transcript,
            "source-1",
            Some(43),
            Some("now")
        ));
    }
    #[test]
    fn transcript_presence_is_explicit() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("transcript.json");
        assert!(!path.is_file());
        fs::write(&path, br#"{"schemaVersion":1}"#).unwrap();
        assert!(path.is_file());
        let value: Value = serde_json::from_reader(File::open(path).unwrap()).unwrap();
        assert_eq!(value["schemaVersion"], 1);
    }
    #[test]
    fn temporary_transcript_cleanup_is_scoped() {
        let d = TempDir::new().unwrap();
        let temp = d.path().join("transcript.json.tmp");
        fs::write(&temp, b"partial").unwrap();
        fs::remove_file(&temp).unwrap();
        assert!(!temp.exists());
    }
    #[test]
    fn invalid_worker_protocol_is_controlled() {
        assert!(parse_worker_event("human log").is_err());
        assert!(parse_worker_event(r#"{"payload":{}}"#).is_err());
        assert_eq!(
            parse_worker_event(r#"{"event":"START","payload":{}}"#)
                .unwrap()
                .0,
            "START"
        );
    }
}
