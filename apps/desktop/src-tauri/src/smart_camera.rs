use crate::project_storage::{CameraDecision, EdlManifest, ProjectStorage, WorkflowState};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{ErrorKind, Read},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const FILE_NAME: &str = "smart_camera.json";
const WIDTH: usize = 160;
const HEIGHT: usize = 90;
const MAX_ZOOM: f64 = 1.5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartCameraError {
    code: String,
    message: String,
}
impl SmartCameraError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CameraProfile {
    Conservative,
    Normal,
    Dynamic,
}

/// Contexto de contenido para que los umbrales puedan evolucionar sin
/// acoplar Encuadre a una webcam ni cambiar el comportamiento de gameplay.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContentMode {
    Auto,
    Software,
    Gameplay,
    Presentation,
    General,
}

impl Default for ContentMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CameraSuggestionType {
    Zoom,
    Focus,
    Reset,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionStatus {
    Pending,
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisStatus {
    Completed,
    Cancelled,
    Stale,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraSuggestion {
    id: String,
    suggestion_type: CameraSuggestionType,
    start_us: u64,
    end_us: u64,
    duration_us: u64,
    zoom: f64,
    center_x: f64,
    center_y: f64,
    transition_us: u64,
    confidence: f64,
    reason: String,
    status: SuggestionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CameraStatistics {
    total: usize,
    zoom: usize,
    focus: usize,
    reset: usize,
    pending: usize,
    accepted: usize,
    rejected: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SourceSnapshot {
    file_size_bytes: u64,
    modified_at: Option<String>,
    duration_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmartCameraDocument {
    schema_version: u32,
    project_id: String,
    source_id: String,
    created_at: String,
    updated_at: String,
    status: AnalysisStatus,
    profile: CameraProfile,
    #[serde(default)]
    content_mode: ContentMode,
    source: SourceSnapshot,
    statistics: CameraStatistics,
    suggestions: Vec<CameraSuggestion>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRequest {
    project_id: String,
    suggestion_id: String,
    status: SuggestionStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    document: SmartCameraDocument,
    edl: EdlManifest,
    applied_count: usize,
}

#[derive(Debug, Clone, Copy)]
struct Config {
    sample_interval_us: u64,
    change_threshold: f64,
    minimum_duration_us: u64,
    hold_duration_us: u64,
    minimum_interval_us: u64,
    transition_us: u64,
    zoom: f64,
    focus_distance: f64,
    max_suggestions: usize,
}

fn config_for(profile: CameraProfile) -> Config {
    match profile {
        CameraProfile::Conservative => Config {
            sample_interval_us: 3_000_000,
            change_threshold: 0.040,
            minimum_duration_us: 2_000_000,
            hold_duration_us: 6_000_000,
            minimum_interval_us: 8_000_000,
            transition_us: 800_000,
            zoom: 1.15,
            focus_distance: 0.18,
            max_suggestions: 256,
        },
        CameraProfile::Normal => Config {
            sample_interval_us: 2_000_000,
            change_threshold: 0.028,
            minimum_duration_us: 1_500_000,
            hold_duration_us: 6_000_000,
            minimum_interval_us: 6_000_000,
            transition_us: 700_000,
            zoom: 1.22,
            focus_distance: 0.14,
            max_suggestions: 512,
        },
        CameraProfile::Dynamic => Config {
            sample_interval_us: 1_500_000,
            change_threshold: 0.020,
            minimum_duration_us: 1_200_000,
            hold_duration_us: 5_000_000,
            minimum_interval_us: 4_000_000,
            transition_us: 600_000,
            zoom: 1.28,
            focus_distance: 0.11,
            max_suggestions: 768,
        },
    }
}

fn effective_config(profile: CameraProfile, content_mode: ContentMode) -> Config {
    let mut settings = config_for(profile);
    // Auto/general/gameplay intentionally retain the validated conservative
    // detector. Software/presentation are separate policy lanes for future
    // cursor/UI/narration signals; their visual detector is only moderately
    // more responsive and still retains the same anti-jitter constraints.
    if matches!(
        content_mode,
        ContentMode::Software | ContentMode::Presentation
    ) {
        settings.sample_interval_us = settings
            .sample_interval_us
            .saturating_sub(500_000)
            .max(1_000_000);
        settings.change_threshold *= 0.90;
        settings.zoom = settings.zoom.min(1.35);
        settings.max_suggestions = settings.max_suggestions.min(768);
    }
    settings
}

#[derive(Clone)]
struct ActiveAnalysis {
    project_id: String,
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
pub struct SmartCameraManager {
    active: Arc<Mutex<Option<ActiveAnalysis>>>,
}

fn emit(app: &AppHandle, project_id: &str, stage: &str, processed_us: u64, duration_us: u64) {
    let _ = app.emit("smart-camera://progress", serde_json::json!({
        "projectId": project_id, "stage": stage, "processedUs": processed_us,
        "durationUs": duration_us, "progress": if duration_us > 0 { Some((processed_us as f64 / duration_us as f64 * 100.0).clamp(0.0, 100.0)) } else { None }
    }));
}

fn file_modified_at(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .map(|value| DateTime::<Utc>::from(value).to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn valid(item: &CameraSuggestion, duration_us: u64, minimum_us: u64) -> bool {
    item.end_us > item.start_us
        && item.end_us <= duration_us
        && item.duration_us == item.end_us - item.start_us
        && item.duration_us >= minimum_us
        && item.zoom.is_finite()
        && (1.0..=MAX_ZOOM).contains(&item.zoom)
        && item.center_x.is_finite()
        && (0.0..=1.0).contains(&item.center_x)
        && item.center_y.is_finite()
        && (0.0..=1.0).contains(&item.center_y)
        && item.confidence.is_finite()
        && (0.0..=1.0).contains(&item.confidence)
}

fn overlaps(left: &CameraSuggestion, right: &CameraSuggestion) -> bool {
    left.start_us < right.end_us && right.start_us < left.end_us
}

fn id(kind: CameraSuggestionType, start_us: u64, end_us: u64) -> String {
    Uuid::new_v5(
        &Uuid::NAMESPACE_OID,
        format!("smart-camera:{kind:?}:{start_us}:{end_us}").as_bytes(),
    )
    .to_string()
}

fn proposal(
    kind: CameraSuggestionType,
    start_us: u64,
    end_us: u64,
    zoom: f64,
    center_x: f64,
    center_y: f64,
    transition_us: u64,
    confidence: f64,
    reason: &str,
) -> CameraSuggestion {
    CameraSuggestion {
        id: id(kind, start_us, end_us),
        suggestion_type: kind,
        start_us,
        end_us,
        duration_us: end_us.saturating_sub(start_us),
        zoom,
        center_x,
        center_y,
        transition_us,
        confidence: confidence.clamp(0.0, 1.0),
        reason: reason.into(),
        status: SuggestionStatus::Pending,
    }
}

fn frame_change(previous: &[u8], current: &[u8]) -> (f64, f64, f64) {
    let mut total = 0_u64;
    let mut weighted = 0_u64;
    let mut x_sum = 0_f64;
    let mut y_sum = 0_f64;
    for (index, (&left, &right)) in previous.iter().zip(current).enumerate() {
        let difference = left.abs_diff(right) as u64;
        total += difference;
        if difference >= 18 {
            weighted += difference;
            x_sum += (index % WIDTH) as f64 * difference as f64;
            y_sum += (index / WIDTH) as f64 * difference as f64;
        }
    }
    let score = total as f64 / (previous.len() as f64 * 255.0);
    if weighted == 0 {
        return (score, 0.5, 0.5);
    }
    (
        score,
        (x_sum / weighted as f64 / (WIDTH - 1) as f64).clamp(0.0, 1.0),
        (y_sum / weighted as f64 / (HEIGHT - 1) as f64).clamp(0.0, 1.0),
    )
}

fn consolidate(
    mut items: Vec<CameraSuggestion>,
    minimum_interval_us: u64,
) -> Vec<CameraSuggestion> {
    items.sort_by(|a, b| {
        let a_priority = match a.suggestion_type {
            CameraSuggestionType::Focus => 2,
            CameraSuggestionType::Zoom => 1,
            CameraSuggestionType::Reset => 0,
        };
        let b_priority = match b.suggestion_type {
            CameraSuggestionType::Focus => 2,
            CameraSuggestionType::Zoom => 1,
            CameraSuggestionType::Reset => 0,
        };
        b.confidence
            .total_cmp(&a.confidence)
            .then_with(|| b.duration_us.cmp(&a.duration_us))
            .then_with(|| b_priority.cmp(&a_priority))
            .then_with(|| a.start_us.cmp(&b.start_us))
    });
    let mut result: Vec<CameraSuggestion> = Vec::new();
    for item in items {
        let conflict = result.iter().any(|kept| {
            let interval_gap = if item.start_us >= kept.end_us {
                item.start_us - kept.end_us
            } else if kept.start_us >= item.end_us {
                kept.start_us - item.end_us
            } else {
                0
            };
            overlaps(kept, &item)
                || (item.suggestion_type != CameraSuggestionType::Reset
                    && kept.suggestion_type != CameraSuggestionType::Reset
                    && interval_gap < minimum_interval_us)
        });
        if conflict {
            continue;
        }
        result.push(item);
    }
    result.sort_by_key(|item| item.start_us);
    result
}

fn statistics(items: &[CameraSuggestion]) -> CameraStatistics {
    let mut value = CameraStatistics {
        total: items.len(),
        ..Default::default()
    };
    for item in items {
        match item.suggestion_type {
            CameraSuggestionType::Zoom => value.zoom += 1,
            CameraSuggestionType::Focus => value.focus += 1,
            CameraSuggestionType::Reset => value.reset += 1,
        }
        match item.status {
            SuggestionStatus::Pending => value.pending += 1,
            SuggestionStatus::Accepted => value.accepted += 1,
            SuggestionStatus::Rejected => value.rejected += 1,
        }
    }
    value
}

fn source_stale(document: &SmartCameraDocument, source_id: &str, path: &Path) -> bool {
    document.source_id != source_id
        || fs::metadata(path).ok().map(|m| m.len()) != Some(document.source.file_size_bytes)
        || file_modified_at(path) != document.source.modified_at
}

fn spawn_ffmpeg(source: &Path, settings: Config) -> Result<Child, SmartCameraError> {
    let seconds = settings.sample_interval_us as f64 / 1_000_000.0;
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
        .arg(source)
        .args([
            "-map",
            "0:v:0",
            "-vf",
            &format!("fps=1/{seconds:.3},scale={WIDTH}:{HEIGHT}:flags=bilinear,format=gray"),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "gray",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(|e| {
        SmartCameraError::new(
            "ffmpeg-unavailable",
            format!("No se pudo iniciar FFmpeg: {e}"),
        )
    })
}

fn analyze_frames(
    mut child: Child,
    manager: &SmartCameraManager,
    app: &AppHandle,
    project_id: &str,
    profile: CameraProfile,
    content_mode: ContentMode,
    duration_us: u64,
) -> Result<Vec<CameraSuggestion>, SmartCameraError> {
    let settings = effective_config(profile, content_mode);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| SmartCameraError::new("ffmpeg-pipe", "FFmpeg no expuso muestras"))?;
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = manager
            .active
            .lock()
            .map_err(|_| SmartCameraError::new("state-error", "Estado no disponible"))?;
        if active.is_some() {
            drop(active);
            let _ = child.lock().map(|mut process| process.kill());
            return Err(SmartCameraError::new(
                "smart-camera-busy",
                "Ya existe un análisis Smart Camera activo",
            ));
        }
        *active = Some(ActiveAnalysis {
            project_id: project_id.into(),
            child: child.clone(),
            cancelled: cancelled.clone(),
        });
    }
    let mut reader = stdout;
    let mut current = vec![0_u8; WIDTH * HEIGHT];
    let mut previous: Option<Vec<u8>> = None;
    let mut frame_index = 0_u64;
    let mut next_allowed = 0_u64;
    let mut candidate: Option<(u64, f64, f64, f64)> = None;
    let mut suggestions = Vec::new();
    let mut read_error = None;
    loop {
        match reader.read_exact(&mut current) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::UnexpectedEof => break,
            Err(error) => {
                read_error = Some(error);
                break;
            }
        }
        let timestamp = frame_index
            .saturating_mul(settings.sample_interval_us)
            .min(duration_us);
        emit(
            app,
            project_id,
            "analyzing_visual_changes",
            timestamp,
            duration_us,
        );
        if let Some(before) = &previous {
            let (score, center_x, center_y) = frame_change(before, &current);
            if score >= settings.change_threshold && timestamp >= next_allowed {
                let Some((candidate_timestamp, candidate_score, candidate_x, candidate_y)) =
                    candidate.take()
                else {
                    candidate = Some((timestamp, score, center_x, center_y));
                    previous = Some(current.clone());
                    frame_index += 1;
                    continue;
                };
                let spatial_drift =
                    ((center_x - candidate_x).powi(2) + (center_y - candidate_y).powi(2)).sqrt();
                if spatial_drift > 0.12 {
                    candidate = Some((timestamp, score, center_x, center_y));
                    previous = Some(current.clone());
                    frame_index += 1;
                    continue;
                }
                let stable_x = (center_x + candidate_x) / 2.0;
                let stable_y = (center_y + candidate_y) / 2.0;
                let stable_score = (score + candidate_score) / 2.0;
                let end = timestamp
                    .saturating_add(settings.hold_duration_us)
                    .min(duration_us);
                if end.saturating_sub(candidate_timestamp) >= settings.minimum_duration_us {
                    // A long or noisy source must not create an unbounded
                    // review queue. Keep the stream moving so cancellation
                    // and progress remain responsive after the cap.
                    if suggestions.len().saturating_add(2) > settings.max_suggestions {
                        candidate = None;
                        previous = Some(current.clone());
                        frame_index += 1;
                        continue;
                    }
                    let distance = ((stable_x - 0.5).powi(2) + (stable_y - 0.5).powi(2)).sqrt();
                    let kind = if distance >= settings.focus_distance {
                        CameraSuggestionType::Focus
                    } else {
                        CameraSuggestionType::Zoom
                    };
                    let confidence = (0.70
                        + ((stable_score - settings.change_threshold) / settings.change_threshold)
                            .min(1.0)
                            * 0.25)
                        .min(0.97);
                    suggestions.push(proposal(
                        kind,
                        candidate_timestamp,
                        end,
                        settings.zoom,
                        stable_x,
                        stable_y,
                        settings.transition_us,
                        confidence,
                        if kind == CameraSuggestionType::Focus {
                            "Actividad visual concentrada y estable fuera de la zona central."
                        } else {
                            "Cambio sostenido de la región principal durante varias muestras."
                        },
                    ));
                    let reset_end = end.saturating_add(settings.transition_us).min(duration_us);
                    if reset_end > end {
                        suggestions.push(proposal(
                            CameraSuggestionType::Reset,
                            end,
                            reset_end,
                            1.0,
                            0.5,
                            0.5,
                            settings.transition_us,
                            confidence,
                            "Retorno seguro a la vista completa al terminar el enfoque.",
                        ));
                    }
                    next_allowed = reset_end.saturating_add(settings.minimum_interval_us);
                }
            } else {
                candidate = None;
            }
        }
        previous = Some(current.clone());
        frame_index += 1;
    }
    let status = child
        .lock()
        .map_err(|_| SmartCameraError::new("process-error", "Proceso no disponible"))?
        .wait()
        .map_err(|e| SmartCameraError::new("ffmpeg-failed", e.to_string()))?;
    manager.active.lock().ok().map(|mut active| *active = None);
    if cancelled.load(Ordering::SeqCst) {
        return Err(SmartCameraError::new(
            "cancelled",
            "Análisis Smart Camera cancelado",
        ));
    }
    if let Some(error) = read_error {
        return Err(SmartCameraError::new("ffmpeg-read", error.to_string()));
    }
    if !status.success() {
        return Err(SmartCameraError::new(
            "ffmpeg-failed",
            "FFmpeg no pudo analizar el video",
        ));
    }
    Ok(consolidate(suggestions, settings.minimum_interval_us))
}

fn accepted_decisions(
    document: &SmartCameraDocument,
    duration_us: u64,
) -> Result<Vec<CameraDecision>, SmartCameraError> {
    let settings = effective_config(document.profile, document.content_mode);
    let mut accepted: Vec<&CameraSuggestion> = document
        .suggestions
        .iter()
        .filter(|item| item.status == SuggestionStatus::Accepted)
        .collect();
    accepted.sort_by_key(|item| item.start_us);
    for (index, item) in accepted.iter().enumerate() {
        let minimum = if item.suggestion_type == CameraSuggestionType::Reset {
            1
        } else {
            settings.minimum_duration_us
        };
        if !valid(item, duration_us, minimum) {
            return Err(SmartCameraError::new(
                "invalid-camera-range",
                "Una propuesta aceptada contiene parámetros inválidos",
            ));
        }
        if index > 0 && overlaps(accepted[index - 1], item) {
            return Err(SmartCameraError::new(
                "overlapping-camera",
                "Las propuestas aceptadas se superponen",
            ));
        }
    }
    Ok(accepted
        .into_iter()
        .map(|item| CameraDecision {
            id: item.id.clone(),
            start_us: item.start_us,
            end_us: item.end_us,
            mode: match item.suggestion_type {
                CameraSuggestionType::Zoom => "zoom",
                CameraSuggestionType::Focus => "focus",
                CameraSuggestionType::Reset => "reset",
            }
            .into(),
            zoom: Some(item.zoom),
            center_x: Some(item.center_x),
            center_y: Some(item.center_y),
            easing: Some("ease_in_out".into()),
            reason: Some(item.reason.clone()),
            confidence: Some(item.confidence),
            transition_us: Some(item.transition_us),
        })
        .collect())
}

fn merge_decisions(
    existing: &mut Vec<CameraDecision>,
    decisions: Vec<CameraDecision>,
) -> Result<usize, SmartCameraError> {
    let mut applied = 0;
    for decision in decisions {
        if existing.iter().any(|item| item.id == decision.id) {
            continue;
        }
        if existing
            .iter()
            .any(|item| item.start_us < decision.end_us && decision.start_us < item.end_us)
        {
            return Err(SmartCameraError::new(
                "camera-conflict",
                "Una propuesta entra en conflicto con un movimiento existente",
            ));
        }
        existing.push(decision);
        applied += 1;
    }
    existing.sort_by_key(|item| item.start_us);
    Ok(applied)
}

fn analyze_impl(
    app: &AppHandle,
    manager: &SmartCameraManager,
    project_id: &str,
    profile: CameraProfile,
    content_mode: ContentMode,
) -> Result<SmartCameraDocument, SmartCameraError> {
    ProjectStorage::validate_id(project_id, "projectId")
        .map_err(|_| SmartCameraError::new("invalid-project-id", "projectId inválido"))?;
    let storage = ProjectStorage::from_app(app)
        .map_err(|_| SmartCameraError::new("storage-error", "Storage no disponible"))?;
    let bundle = storage
        .load_project(project_id)
        .map_err(|_| SmartCameraError::new("project-not-found", "Proyecto no disponible"))?;
    let source = Path::new(&bundle.source.path);
    let metadata = fs::metadata(source).map_err(|_| {
        SmartCameraError::new("source-unavailable", "El video original no está disponible")
    })?;
    if metadata.len() != bundle.source.file_size_bytes
        || file_modified_at(source) != bundle.source.modified_at
    {
        return Err(SmartCameraError::new(
            "source-stale",
            "El video original cambió; vuelve a importar o localizar la fuente",
        ));
    }
    let duration_us = bundle.source.duration_us.unwrap_or(0);
    if duration_us == 0 {
        return Err(SmartCameraError::new(
            "duration-unavailable",
            "La duración del video no está disponible",
        ));
    }
    if manager
        .active
        .lock()
        .map_err(|_| SmartCameraError::new("state-error", "Estado no disponible"))?
        .is_some()
    {
        return Err(SmartCameraError::new(
            "smart-camera-busy",
            "Ya existe un análisis Smart Camera activo",
        ));
    }
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let _ = storage.update_smart_camera_workflow(project_id, WorkflowState::Preparing, now.clone());
    emit(app, project_id, "extracting_samples", 0, duration_us);
    let child = spawn_ffmpeg(source, effective_config(profile, content_mode))?;
    let _ = storage.update_smart_camera_workflow(project_id, WorkflowState::Running, now.clone());
    let suggestions = analyze_frames(
        child,
        manager,
        app,
        project_id,
        profile,
        content_mode,
        duration_us,
    )?;
    emit(
        app,
        project_id,
        "consolidating_movements",
        duration_us,
        duration_us,
    );
    let dir = storage
        .project_dir(project_id)
        .map_err(|_| SmartCameraError::new("invalid-project-id", "projectId inválido"))?;
    let created_at = storage
        .read_json::<SmartCameraDocument>(&dir.join(FILE_NAME))
        .ok()
        .map(|d| d.created_at)
        .unwrap_or_else(|| now.clone());
    let document = SmartCameraDocument {
        schema_version: 1,
        project_id: project_id.into(),
        source_id: bundle.source.source_id.clone(),
        created_at,
        updated_at: now.clone(),
        status: AnalysisStatus::Completed,
        profile,
        content_mode,
        source: SourceSnapshot {
            file_size_bytes: metadata.len(),
            modified_at: file_modified_at(source),
            duration_us,
        },
        statistics: statistics(&suggestions),
        suggestions,
    };
    emit(app, project_id, "saving", duration_us, duration_us);
    storage
        .write_json(&dir.join(FILE_NAME), &document)
        .map_err(|_| {
            SmartCameraError::new("write-failed", "No se pudo guardar smart_camera.json")
        })?;
    let _ = storage.update_smart_camera_workflow(project_id, WorkflowState::Completed, now);
    emit(app, project_id, "completed", duration_us, duration_us);
    Ok(document)
}

#[tauri::command]
pub async fn analyze_smart_camera(
    app: AppHandle,
    state: State<'_, SmartCameraManager>,
    project_id: String,
    profile: CameraProfile,
    content_mode: Option<ContentMode>,
) -> Result<SmartCameraDocument, SmartCameraError> {
    let manager = state.inner().clone();
    let app_clone = app.clone();
    let project_clone = project_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        analyze_impl(
            &app_clone,
            &manager,
            &project_clone,
            profile,
            content_mode.unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| SmartCameraError::new("task-failed", e.to_string()))?;
    if result
        .as_ref()
        .err()
        .is_some_and(|error| error.code != "cancelled")
    {
        if let Ok(storage) = ProjectStorage::from_app(&app) {
            let _ = storage.update_smart_camera_workflow(
                &project_id,
                WorkflowState::Error,
                Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            );
        }
        if let Ok(mut active) = state.active.lock() {
            *active = None;
        }
        emit(&app, &project_id, "error", 0, 0);
    }
    result
}

#[tauri::command]
pub fn cancel_smart_camera(
    app: AppHandle,
    state: State<'_, SmartCameraManager>,
    project_id: String,
) -> Result<bool, SmartCameraError> {
    let active = state
        .active
        .lock()
        .map_err(|_| SmartCameraError::new("state-error", "Estado no disponible"))?
        .clone();
    let Some(active) = active else {
        return Ok(false);
    };
    if active.project_id != project_id {
        return Err(SmartCameraError::new(
            "different-task-active",
            "Otro proyecto está siendo analizado",
        ));
    }
    active.cancelled.store(true, Ordering::SeqCst);
    let _ = active.child.lock().map(|mut child| child.kill());
    if let Ok(storage) = ProjectStorage::from_app(&app) {
        let _ = storage.update_smart_camera_workflow(
            &project_id,
            WorkflowState::Cancelled,
            Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        );
    }
    emit(&app, &project_id, "cancelled", 0, 0);
    Ok(true)
}

#[tauri::command]
pub fn get_smart_camera(
    app: AppHandle,
    project_id: String,
) -> Result<Option<SmartCameraDocument>, SmartCameraError> {
    let storage = ProjectStorage::from_app(&app)
        .map_err(|_| SmartCameraError::new("storage-error", "Storage no disponible"))?;
    let bundle = storage
        .load_project(&project_id)
        .map_err(|_| SmartCameraError::new("project-not-found", "Proyecto no disponible"))?;
    let path = storage
        .project_dir(&project_id)
        .map_err(|_| SmartCameraError::new("invalid-project-id", "projectId inválido"))?
        .join(FILE_NAME);
    if !path.is_file() {
        return Ok(None);
    }
    let mut document: SmartCameraDocument = storage.read_json(&path).map_err(|_| {
        SmartCameraError::new("smart-camera-invalid", "smart_camera.json está corrupto")
    })?;
    if document.schema_version != 1 || document.project_id != project_id {
        return Err(SmartCameraError::new(
            "smart-camera-invalid",
            "smart_camera.json no corresponde al proyecto",
        ));
    }
    if source_stale(
        &document,
        &bundle.source.source_id,
        Path::new(&bundle.source.path),
    ) {
        document.status = AnalysisStatus::Stale;
        document.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        storage
            .write_json(&path, &document)
            .map_err(|_| SmartCameraError::new("write-failed", "No se pudo marcar stale"))?;
    }
    Ok(Some(document))
}

#[tauri::command]
pub fn review_smart_camera(
    app: AppHandle,
    request: ReviewRequest,
) -> Result<SmartCameraDocument, SmartCameraError> {
    let storage = ProjectStorage::from_app(&app)
        .map_err(|_| SmartCameraError::new("storage-error", "Storage no disponible"))?;
    let bundle = storage
        .load_project(&request.project_id)
        .map_err(|_| SmartCameraError::new("project-not-found", "Proyecto no disponible"))?;
    let path = storage
        .project_dir(&request.project_id)
        .map_err(|_| SmartCameraError::new("invalid-project-id", "projectId inválido"))?
        .join(FILE_NAME);
    let mut document: SmartCameraDocument = storage.read_json(&path).map_err(|_| {
        SmartCameraError::new("smart-camera-missing", "No existe análisis Smart Camera")
    })?;
    if document.status == AnalysisStatus::Stale
        || source_stale(
            &document,
            &bundle.source.source_id,
            Path::new(&bundle.source.path),
        )
    {
        return Err(SmartCameraError::new(
            "smart-camera-stale",
            "El análisis está desactualizado",
        ));
    }
    let duration = bundle.source.duration_us.unwrap_or(0);
    let minimum = effective_config(document.profile, document.content_mode).minimum_duration_us;
    let item = document
        .suggestions
        .iter_mut()
        .find(|item| item.id == request.suggestion_id)
        .ok_or_else(|| SmartCameraError::new("suggestion-not-found", "Propuesta no encontrada"))?;
    if request.status == SuggestionStatus::Accepted
        && !valid(
            item,
            duration,
            if item.suggestion_type == CameraSuggestionType::Reset {
                1
            } else {
                minimum
            },
        )
    {
        return Err(SmartCameraError::new(
            "invalid-camera-range",
            "La propuesta no es válida",
        ));
    }
    item.status = request.status;
    document.statistics = statistics(&document.suggestions);
    document.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    storage
        .write_json(&path, &document)
        .map_err(|_| SmartCameraError::new("write-failed", "No se pudo guardar la revisión"))?;
    Ok(document)
}

#[tauri::command]
pub fn apply_smart_camera_to_edl(
    app: AppHandle,
    project_id: String,
) -> Result<ApplyResult, SmartCameraError> {
    let storage = ProjectStorage::from_app(&app)
        .map_err(|_| SmartCameraError::new("storage-error", "Storage no disponible"))?;
    let mut bundle = storage
        .load_project(&project_id)
        .map_err(|_| SmartCameraError::new("project-not-found", "Proyecto no disponible"))?;
    let dir = storage
        .project_dir(&project_id)
        .map_err(|_| SmartCameraError::new("invalid-project-id", "projectId inválido"))?;
    let document: SmartCameraDocument = storage.read_json(&dir.join(FILE_NAME)).map_err(|_| {
        SmartCameraError::new("smart-camera-missing", "No existe análisis Smart Camera")
    })?;
    if document.status == AnalysisStatus::Stale
        || source_stale(
            &document,
            &bundle.source.source_id,
            Path::new(&bundle.source.path),
        )
    {
        return Err(SmartCameraError::new(
            "smart-camera-stale",
            "El análisis está desactualizado",
        ));
    }
    let decisions = accepted_decisions(&document, bundle.source.duration_us.unwrap_or(0))?;
    let cuts_before = bundle.edl.tracks.cuts.clone();
    let applied = merge_decisions(&mut bundle.edl.tracks.camera, decisions)?;
    debug_assert_eq!(bundle.edl.tracks.cuts, cuts_before);
    bundle.edl.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    storage
        .write_json(&dir.join("edl.json"), &bundle.edl)
        .map_err(|_| SmartCameraError::new("edl-write-failed", "No se pudo actualizar el EDL"))?;
    let _ = storage.update_smart_camera_workflow(
        &project_id,
        WorkflowState::Completed,
        bundle.edl.updated_at.clone(),
    );
    Ok(ApplyResult {
        document,
        edl: bundle.edl,
        applied_count: applied,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    fn item(kind: CameraSuggestionType, start: u64, end: u64, zoom: f64) -> CameraSuggestion {
        proposal(kind, start, end, zoom, 0.5, 0.5, 500_000, 0.9, "test")
    }
    fn document(items: Vec<CameraSuggestion>) -> SmartCameraDocument {
        SmartCameraDocument {
            schema_version: 1,
            project_id: Uuid::new_v4().to_string(),
            source_id: Uuid::new_v4().to_string(),
            created_at: "now".into(),
            updated_at: "now".into(),
            status: AnalysisStatus::Completed,
            profile: CameraProfile::Dynamic,
            content_mode: ContentMode::Auto,
            source: SourceSnapshot {
                file_size_bytes: 1,
                modified_at: None,
                duration_us: 10_000_000,
            },
            statistics: statistics(&items),
            suggestions: items,
        }
    }
    #[test]
    fn valid_proposal_and_microseconds() {
        let value = item(CameraSuggestionType::Zoom, 1_000_000, 3_000_000, 1.2);
        assert!(valid(&value, 5_000_000, 1_000_000));
        assert_eq!(value.duration_us, 2_000_000);
    }
    #[test]
    fn invalid_range_and_short_duration() {
        assert!(!valid(
            &item(CameraSuggestionType::Zoom, 3_000_000, 2_000_000, 1.2),
            5_000_000,
            1
        ));
        assert!(!valid(
            &item(CameraSuggestionType::Zoom, 0, 10, 1.2),
            5_000_000,
            100
        ));
    }
    #[test]
    fn zoom_and_centers_are_bounded() {
        assert!(!valid(
            &item(CameraSuggestionType::Zoom, 0, 2_000_000, 0.9),
            3_000_000,
            1
        ));
        let mut x = item(CameraSuggestionType::Focus, 0, 2_000_000, 1.2);
        x.center_x = 1.1;
        assert!(!valid(&x, 3_000_000, 1));
        x.center_x = 0.5;
        x.center_y = -0.1;
        assert!(!valid(&x, 3_000_000, 1));
    }
    #[test]
    fn reset_returns_to_full_view() {
        let reset = item(CameraSuggestionType::Reset, 1_000_000, 1_500_000, 1.0);
        assert_eq!(
            (reset.zoom, reset.center_x, reset.center_y),
            (1.0, 0.5, 0.5)
        );
    }
    #[test]
    fn frame_change_finds_activity_center() {
        let a = vec![0; WIDTH * HEIGHT];
        let mut b = a.clone();
        b[10 * WIDTH + 140] = 255;
        let (_, x, y) = frame_change(&a, &b);
        assert!(x > 0.8 && y < 0.2);
    }
    #[test]
    fn overlap_and_anti_jitter_are_consolidated_deterministically() {
        let a = item(CameraSuggestionType::Zoom, 0, 2_000_000, 1.2);
        let mut b = item(CameraSuggestionType::Focus, 1_000_000, 3_000_000, 1.2);
        b.confidence = 0.95;
        let c = item(CameraSuggestionType::Zoom, 3_000_000, 5_000_000, 1.2);
        let result = consolidate(vec![c, b, a], 2_000_000);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].start_us, 1_000_000);
    }
    #[test]
    fn accepted_only_and_idempotent_ids() {
        let mut a = item(CameraSuggestionType::Zoom, 0, 2_000_000, 1.2);
        a.status = SuggestionStatus::Accepted;
        let mut r = item(CameraSuggestionType::Reset, 2_000_000, 2_500_000, 1.0);
        r.status = SuggestionStatus::Rejected;
        let p = item(CameraSuggestionType::Focus, 3_000_000, 5_000_000, 1.2);
        let decisions = accepted_decisions(&document(vec![a.clone(), r, p]), 10_000_000).unwrap();
        assert_eq!(decisions.len(), 1);
        assert_eq!(a.id, id(CameraSuggestionType::Zoom, 0, 2_000_000));
    }
    #[test]
    fn statuses_and_profiles() {
        let mut values = vec![
            item(CameraSuggestionType::Zoom, 0, 2_000_000, 1.2),
            item(CameraSuggestionType::Focus, 3_000_000, 5_000_000, 1.2),
            item(CameraSuggestionType::Reset, 5_000_000, 5_500_000, 1.0),
        ];
        values[0].status = SuggestionStatus::Accepted;
        values[1].status = SuggestionStatus::Rejected;
        let stats = statistics(&values);
        assert_eq!((stats.accepted, stats.rejected, stats.pending), (1, 1, 1));
        assert!(
            config_for(CameraProfile::Conservative).change_threshold
                > config_for(CameraProfile::Dynamic).change_threshold
        );
    }

    #[test]
    fn content_modes_keep_gameplay_conservative_and_prepare_software_lane() {
        let gameplay = effective_config(CameraProfile::Normal, ContentMode::Gameplay);
        let automatic = effective_config(CameraProfile::Normal, ContentMode::Auto);
        let software = effective_config(CameraProfile::Normal, ContentMode::Software);
        assert_eq!(gameplay.sample_interval_us, automatic.sample_interval_us);
        assert_eq!(gameplay.change_threshold, automatic.change_threshold);
        assert!(software.sample_interval_us <= gameplay.sample_interval_us);
        assert!(software.change_threshold < gameplay.change_threshold);
        assert!(software.zoom <= 1.35);
        assert!(gameplay.max_suggestions < 1_000);
        assert!(software.max_suggestions <= 768);
    }

    #[test]
    fn content_mode_is_backward_compatible_when_document_field_is_missing() {
        let json = serde_json::json!({
            "schemaVersion": 1,
            "projectId": "project",
            "sourceId": "source",
            "createdAt": "now",
            "updatedAt": "now",
            "status": "completed",
            "profile": "normal",
            "source": {"fileSizeBytes": 1, "modifiedAt": null, "durationUs": 10},
            "statistics": {"total": 0, "zoom": 0, "focus": 0, "reset": 0, "pending": 0, "accepted": 0, "rejected": 0},
            "suggestions": []
        });
        let document: SmartCameraDocument = serde_json::from_value(json).unwrap();
        assert_eq!(document.content_mode, ContentMode::Auto);
    }
    #[test]
    fn temporal_order_is_stable() {
        let values = consolidate(
            vec![
                item(CameraSuggestionType::Zoom, 5_000_000, 7_000_000, 1.2),
                item(CameraSuggestionType::Zoom, 0, 2_000_000, 1.2),
            ],
            1_000_000,
        );
        assert!(values[0].start_us < values[1].start_us);
    }
    #[test]
    fn persistence_corruption_and_missing_source_are_controlled() {
        let d = TempDir::new().unwrap();
        let storage = ProjectStorage::new(d.path().into());
        let path = d.path().join(FILE_NAME);
        let value = document(vec![]);
        storage.write_json(&path, &value).unwrap();
        assert_eq!(
            storage.read_json::<SmartCameraDocument>(&path).unwrap(),
            value
        );
        fs::write(&path, b"broken").unwrap();
        assert!(storage.read_json::<SmartCameraDocument>(&path).is_err());
        assert!(fs::metadata(d.path().join("missing.mp4")).is_err());
    }
    #[test]
    fn source_stale_and_valid() {
        let d = TempDir::new().unwrap();
        let path = d.path().join("video.mp4");
        fs::write(&path, b"x").unwrap();
        let mut value = document(vec![]);
        value.source.file_size_bytes = 1;
        value.source.modified_at = file_modified_at(&path);
        let source_id = value.source_id.clone();
        assert!(!source_stale(&value, &source_id, &path));
        assert!(source_stale(&value, "other", &path));
    }
    #[test]
    fn applying_twice_is_idempotent_and_cuts_stay_unchanged() {
        let mut accepted = item(CameraSuggestionType::Zoom, 0, 2_000_000, 1.2);
        accepted.status = SuggestionStatus::Accepted;
        let decisions = accepted_decisions(&document(vec![accepted]), 10_000_000).unwrap();
        let cuts = vec![(500_000_u64, 750_000_u64)];
        let before = cuts.clone();
        let mut camera = Vec::new();
        assert_eq!(merge_decisions(&mut camera, decisions.clone()).unwrap(), 1);
        assert_eq!(merge_decisions(&mut camera, decisions).unwrap(), 0);
        assert_eq!(camera.len(), 1);
        assert_eq!(cuts, before);
    }
}
