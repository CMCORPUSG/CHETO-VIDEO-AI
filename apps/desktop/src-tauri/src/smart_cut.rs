use crate::project_storage::{CutDecision, EdlManifest, ProjectStorage, WorkflowState};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::Path,
    process::{Command, Stdio},
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const SMART_CUT_FILE: &str = "smart_cut.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartCutError {
    code: String,
    message: String,
}
impl SmartCutError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SmartCutProfile {
    Conservative,
    Normal,
    Aggressive,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionType {
    Silence,
    Filler,
    Repetition,
    FalseStart,
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
    Stale,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmartCutSuggestion {
    id: String,
    suggestion_type: SuggestionType,
    start_us: u64,
    end_us: u64,
    duration_us: u64,
    confidence: f64,
    reason: String,
    status: SuggestionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SmartCutStatistics {
    total: usize,
    silence: usize,
    filler: usize,
    repetition: usize,
    false_start: usize,
    pending: usize,
    accepted: usize,
    rejected: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SmartCutSource {
    file_size_bytes: u64,
    modified_at: Option<String>,
    duration_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmartCutDocument {
    schema_version: u32,
    project_id: String,
    source_id: String,
    created_at: String,
    updated_at: String,
    profile: SmartCutProfile,
    status: AnalysisStatus,
    source: SmartCutSource,
    statistics: SmartCutStatistics,
    suggestions: Vec<SmartCutSuggestion>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSuggestionRequest {
    project_id: String,
    suggestion_id: String,
    status: SuggestionStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplySmartCutResult {
    document: SmartCutDocument,
    edl: EdlManifest,
    applied_count: usize,
}

#[derive(Debug, Clone, Copy)]
struct AnalysisConfig {
    silence_threshold_us: u64,
    minimum_cut_us: u64,
    speech_guard_us: u64,
}

fn config(profile: SmartCutProfile) -> AnalysisConfig {
    match profile {
        SmartCutProfile::Conservative => AnalysisConfig {
            silence_threshold_us: 1_500_000,
            minimum_cut_us: 400_000,
            speech_guard_us: 180_000,
        },
        SmartCutProfile::Normal => AnalysisConfig {
            silence_threshold_us: 1_200_000,
            minimum_cut_us: 300_000,
            speech_guard_us: 150_000,
        },
        SmartCutProfile::Aggressive => AnalysisConfig {
            silence_threshold_us: 1_000_000,
            minimum_cut_us: 180_000,
            speech_guard_us: 100_000,
        },
    }
}

fn emit(app: &AppHandle, project_id: &str, stage: &str, completed: u8, total: u8) {
    let _ = app.emit("smart-cut://progress", serde_json::json!({"projectId": project_id, "stage": stage, "completedSteps": completed, "totalSteps": total}));
}

fn file_modified_at(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .map(|value| DateTime::<Utc>::from(value).to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn suggestion_id(kind: SuggestionType, start_us: u64, end_us: u64) -> String {
    Uuid::new_v5(
        &Uuid::NAMESPACE_OID,
        format!("smart-cut:{kind:?}:{start_us}:{end_us}").as_bytes(),
    )
    .to_string()
}

fn candidate(
    start_us: u64,
    end_us: u64,
    confidence: f64,
    duration_us: u64,
) -> Option<SmartCutSuggestion> {
    if end_us <= start_us || end_us > duration_us {
        return None;
    }
    Some(SmartCutSuggestion {
        id: suggestion_id(SuggestionType::Silence, start_us, end_us),
        suggestion_type: SuggestionType::Silence,
        start_us,
        end_us,
        duration_us: end_us - start_us,
        confidence: confidence.clamp(0.0, 1.0),
        reason: "Silencio prolongado detectado en el audio; revisa antes de aplicar.".into(),
        status: SuggestionStatus::Pending,
    })
}

fn parse_seconds(value: &str) -> Option<u64> {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .map(|v| (v * 1_000_000.0).round() as u64)
}

fn detect_silences(
    source: &Path,
    settings: AnalysisConfig,
    duration_us: u64,
) -> Result<Vec<SmartCutSuggestion>, SmartCutError> {
    let threshold = settings.silence_threshold_us as f64 / 1_000_000.0;
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(source)
        .args([
            "-af",
            &format!("silencedetect=n=-35dB:d={threshold:.3}"),
            "-f",
            "null",
            "-",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|error| {
        SmartCutError::new(
            "ffmpeg-unavailable",
            format!("No se pudo iniciar FFmpeg: {error}"),
        )
    })?;
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .ok_or_else(|| SmartCutError::new("ffmpeg-pipe", "FFmpeg no expuso diagnóstico"))?
        .read_to_string(&mut stderr)
        .map_err(|error| SmartCutError::new("ffmpeg-read", error.to_string()))?;
    let status = child
        .wait()
        .map_err(|error| SmartCutError::new("ffmpeg-failed", error.to_string()))?;
    if !status.success() {
        return Err(SmartCutError::new(
            "ffmpeg-failed",
            "FFmpeg no pudo analizar el audio",
        ));
    }
    let mut silence_start = None;
    let mut result = Vec::new();
    for line in stderr.lines() {
        if let Some(value) = line.split("silence_start:").nth(1).and_then(parse_seconds) {
            silence_start = Some(value);
        }
        if let Some(value) = line
            .split("silence_end:")
            .nth(1)
            .and_then(|part| part.split_whitespace().next())
            .and_then(parse_seconds)
        {
            if let Some(start) = silence_start.take() {
                let cut_start = start.saturating_add(settings.speech_guard_us);
                let cut_end = value
                    .saturating_sub(settings.speech_guard_us)
                    .min(duration_us);
                if cut_end.saturating_sub(cut_start) >= settings.minimum_cut_us {
                    let confidence = (0.76 + (cut_end - cut_start) as f64 / 8_000_000.0).min(0.98);
                    if let Some(item) = candidate(cut_start, cut_end, confidence, duration_us) {
                        result.push(item);
                    }
                }
            }
        }
    }
    result.sort_by_key(|item| item.start_us);
    Ok(result)
}

fn overlaps(left: &SmartCutSuggestion, right: &SmartCutSuggestion) -> bool {
    left.start_us < right.end_us && right.start_us < left.end_us
}
fn consolidate(mut suggestions: Vec<SmartCutSuggestion>) -> Vec<SmartCutSuggestion> {
    suggestions.sort_by(|left, right| {
        right
            .confidence
            .total_cmp(&left.confidence)
            .then(left.start_us.cmp(&right.start_us))
    });
    let mut selected = Vec::new();
    for suggestion in suggestions {
        if !selected.iter().any(|item| overlaps(item, &suggestion)) {
            selected.push(suggestion);
        }
    }
    selected.sort_by_key(|item| item.start_us);
    selected
}
fn statistics(suggestions: &[SmartCutSuggestion]) -> SmartCutStatistics {
    let mut result = SmartCutStatistics {
        total: suggestions.len(),
        ..Default::default()
    };
    for item in suggestions {
        match item.suggestion_type {
            SuggestionType::Silence => result.silence += 1,
            SuggestionType::Filler => result.filler += 1,
            SuggestionType::Repetition => result.repetition += 1,
            SuggestionType::FalseStart => result.false_start += 1,
        }
        match item.status {
            SuggestionStatus::Pending => result.pending += 1,
            SuggestionStatus::Accepted => result.accepted += 1,
            SuggestionStatus::Rejected => result.rejected += 1,
        }
    }
    result
}

fn document_is_stale(document: &SmartCutDocument, source_id: &str, source_path: &Path) -> bool {
    document.source_id != source_id
        || fs::metadata(source_path).ok().map(|item| item.len())
            != Some(document.source.file_size_bytes)
        || file_modified_at(source_path) != document.source.modified_at
}
fn validate_range(item: &SmartCutSuggestion, duration_us: u64, minimum_cut_us: u64) -> bool {
    item.end_us > item.start_us
        && item.end_us <= duration_us
        && item.duration_us == item.end_us - item.start_us
        && item.duration_us >= minimum_cut_us
}
fn accepted_cut_decisions(
    document: &SmartCutDocument,
    duration_us: u64,
) -> Result<Vec<CutDecision>, SmartCutError> {
    let minimum = config(document.profile).minimum_cut_us;
    let mut accepted: Vec<&SmartCutSuggestion> = document
        .suggestions
        .iter()
        .filter(|item| item.status == SuggestionStatus::Accepted)
        .collect();
    accepted.sort_by_key(|item| item.start_us);
    for (index, item) in accepted.iter().enumerate() {
        if !validate_range(item, duration_us, minimum) {
            return Err(SmartCutError::new(
                "invalid-cut-range",
                "Una sugerencia aceptada contiene un rango inválido.",
            ));
        }
        if index > 0 && overlaps(accepted[index - 1], item) {
            return Err(SmartCutError::new(
                "overlapping-cuts",
                "Las sugerencias aceptadas contienen rangos superpuestos.",
            ));
        }
    }
    Ok(accepted
        .into_iter()
        .map(|item| CutDecision {
            id: item.id.clone(),
            start_us: item.start_us,
            end_us: item.end_us,
            action: "remove".into(),
            reason: Some(format!("Smart Cut: {}", item.reason)),
            confidence: Some(item.confidence),
        })
        .collect())
}

fn analyze_impl(
    app: &AppHandle,
    project_id: &str,
    profile: SmartCutProfile,
) -> Result<SmartCutDocument, SmartCutError> {
    ProjectStorage::validate_id(project_id, "projectId")
        .map_err(|_| SmartCutError::new("invalid-project-id", "projectId inválido"))?;
    let storage = ProjectStorage::from_app(app)
        .map_err(|_| SmartCutError::new("storage-error", "Storage no disponible"))?;
    let bundle = storage
        .load_project(project_id)
        .map_err(|_| SmartCutError::new("project-not-found", "Proyecto no disponible"))?;
    let source_path = Path::new(&bundle.source.path);
    let metadata = fs::metadata(source_path).map_err(|_| {
        SmartCutError::new(
            "source-unavailable",
            "El video original no está disponible en su ubicación guardada.",
        )
    })?;
    if metadata.len() != bundle.source.file_size_bytes
        || file_modified_at(source_path) != bundle.source.modified_at
    {
        return Err(SmartCutError::new(
            "source-stale",
            "El video original cambió; vuelve a localizar la fuente.",
        ));
    }
    let duration_us = bundle.source.duration_us.unwrap_or(0);
    if duration_us == 0 {
        return Err(SmartCutError::new(
            "duration-unavailable",
            "La duración de la fuente no está disponible.",
        ));
    }
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let _ = storage.update_smart_cut_workflow(project_id, WorkflowState::Preparing, now.clone());
    emit(app, project_id, "preparing", 0, 5);
    emit(app, project_id, "analyzing_silences", 2, 5);
    let suggestions = consolidate(detect_silences(source_path, config(profile), duration_us)?);
    emit(app, project_id, "consolidating_suggestions", 4, 5);
    let dir = storage
        .project_dir(project_id)
        .map_err(|_| SmartCutError::new("invalid-project-id", "projectId inválido"))?;
    let created_at = storage
        .read_json::<SmartCutDocument>(&dir.join(SMART_CUT_FILE))
        .ok()
        .map(|doc| doc.created_at)
        .unwrap_or_else(|| now.clone());
    let document = SmartCutDocument {
        schema_version: 1,
        project_id: project_id.into(),
        source_id: bundle.source.source_id.clone(),
        created_at,
        updated_at: now.clone(),
        profile,
        status: AnalysisStatus::Completed,
        source: SmartCutSource {
            file_size_bytes: metadata.len(),
            modified_at: file_modified_at(source_path),
            duration_us,
        },
        statistics: statistics(&suggestions),
        suggestions,
    };
    storage
        .write_json(&dir.join(SMART_CUT_FILE), &document)
        .map_err(|_| {
            SmartCutError::new("smart-cut-write-failed", "No se pudo guardar Smart Cut")
        })?;
    let _ = storage.update_smart_cut_workflow(project_id, WorkflowState::Completed, now);
    emit(app, project_id, "completed", 5, 5);
    Ok(document)
}

#[tauri::command]
pub async fn analyze_smart_cut(
    app: AppHandle,
    project_id: String,
    profile: SmartCutProfile,
) -> Result<SmartCutDocument, SmartCutError> {
    tauri::async_runtime::spawn_blocking(move || analyze_impl(&app, &project_id, profile))
        .await
        .map_err(|error| SmartCutError::new("task-failed", error.to_string()))?
}

#[tauri::command]
pub fn get_smart_cut(
    app: AppHandle,
    project_id: String,
) -> Result<Option<SmartCutDocument>, SmartCutError> {
    let storage = ProjectStorage::from_app(&app)
        .map_err(|_| SmartCutError::new("storage-error", "Storage no disponible"))?;
    let bundle = storage
        .load_project(&project_id)
        .map_err(|_| SmartCutError::new("project-not-found", "Proyecto no disponible"))?;
    let path = storage
        .project_dir(&project_id)
        .map_err(|_| SmartCutError::new("invalid-project-id", "projectId inválido"))?
        .join(SMART_CUT_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    let mut document: SmartCutDocument = storage
        .read_json(&path)
        .map_err(|_| SmartCutError::new("smart-cut-invalid", "smart_cut.json está corrupto"))?;
    if document_is_stale(
        &document,
        &bundle.source.source_id,
        Path::new(&bundle.source.path),
    ) {
        document.status = AnalysisStatus::Stale;
        storage.write_json(&path, &document).ok();
    }
    Ok(Some(document))
}

#[tauri::command]
pub fn review_smart_cut_suggestion(
    app: AppHandle,
    request: ReviewSuggestionRequest,
) -> Result<SmartCutDocument, SmartCutError> {
    let storage = ProjectStorage::from_app(&app)
        .map_err(|_| SmartCutError::new("storage-error", "Storage no disponible"))?;
    let bundle = storage
        .load_project(&request.project_id)
        .map_err(|_| SmartCutError::new("project-not-found", "Proyecto no disponible"))?;
    let path = storage
        .project_dir(&request.project_id)
        .map_err(|_| SmartCutError::new("invalid-project-id", "projectId inválido"))?
        .join(SMART_CUT_FILE);
    let mut document: SmartCutDocument = storage
        .read_json(&path)
        .map_err(|_| SmartCutError::new("smart-cut-missing", "No existe análisis Smart Cut"))?;
    if document.status == AnalysisStatus::Stale
        || document_is_stale(
            &document,
            &bundle.source.source_id,
            Path::new(&bundle.source.path),
        )
    {
        return Err(SmartCutError::new(
            "smart-cut-stale",
            "El análisis está desactualizado",
        ));
    }
    let item = document
        .suggestions
        .iter_mut()
        .find(|item| item.id == request.suggestion_id)
        .ok_or_else(|| SmartCutError::new("suggestion-not-found", "Propuesta no encontrada"))?;
    if request.status == SuggestionStatus::Accepted
        && !validate_range(
            item,
            bundle.source.duration_us.unwrap_or(0),
            config(document.profile).minimum_cut_us,
        )
    {
        return Err(SmartCutError::new(
            "invalid-cut-range",
            "La propuesta no es válida",
        ));
    }
    item.status = request.status;
    document.statistics = statistics(&document.suggestions);
    document.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    storage
        .write_json(&path, &document)
        .map_err(|_| SmartCutError::new("write-failed", "No se pudo guardar la revisión"))?;
    Ok(document)
}

#[tauri::command]
pub fn apply_smart_cut_to_edl(
    app: AppHandle,
    project_id: String,
) -> Result<ApplySmartCutResult, SmartCutError> {
    let storage = ProjectStorage::from_app(&app)
        .map_err(|_| SmartCutError::new("storage-error", "Storage no disponible"))?;
    let mut bundle = storage
        .load_project(&project_id)
        .map_err(|_| SmartCutError::new("project-not-found", "Proyecto no disponible"))?;
    let dir = storage
        .project_dir(&project_id)
        .map_err(|_| SmartCutError::new("invalid-project-id", "projectId inválido"))?;
    let document: SmartCutDocument = storage
        .read_json(&dir.join(SMART_CUT_FILE))
        .map_err(|_| SmartCutError::new("smart-cut-missing", "No existe análisis Smart Cut"))?;
    if document.status == AnalysisStatus::Stale {
        return Err(SmartCutError::new(
            "smart-cut-stale",
            "El análisis está desactualizado",
        ));
    }
    let decisions = accepted_cut_decisions(&document, bundle.source.duration_us.unwrap_or(0))?;
    let mut applied = 0;
    for decision in decisions {
        if bundle
            .edl
            .tracks
            .cuts
            .iter()
            .any(|item| item.id == decision.id)
        {
            continue;
        }
        if bundle
            .edl
            .tracks
            .cuts
            .iter()
            .any(|item| item.start_us < decision.end_us && decision.start_us < item.end_us)
        {
            return Err(SmartCutError::new(
                "cut-conflict",
                "Una propuesta entra en conflicto con un corte existente",
            ));
        }
        bundle.edl.tracks.cuts.push(decision);
        applied += 1;
    }
    bundle.edl.tracks.cuts.sort_by_key(|item| item.start_us);
    bundle.edl.updated_at = Utc::now().to_rfc3339();
    storage
        .write_json(&dir.join("edl.json"), &bundle.edl)
        .map_err(|_| SmartCutError::new("edl-write-failed", "No se pudo actualizar el EDL"))?;
    Ok(ApplySmartCutResult {
        document,
        edl: bundle.edl,
        applied_count: applied,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profiles_are_ordered() {
        assert!(
            config(SmartCutProfile::Conservative).silence_threshold_us
                > config(SmartCutProfile::Aggressive).silence_threshold_us
        );
    }
    #[test]
    fn silence_parser_uses_integer_microseconds() {
        assert_eq!(parse_seconds("1.234"), Some(1_234_000));
    }
    #[test]
    fn candidate_rejects_invalid_ranges() {
        assert!(candidate(3, 2, 0.9, 10).is_none());
    }
    #[test]
    fn consolidation_keeps_highest_confidence_overlap() {
        let mut low = candidate(0, 3_000_000, 0.7, 5_000_000).unwrap();
        let high = candidate(1_000_000, 2_000_000, 0.9, 5_000_000).unwrap();
        low.status = SuggestionStatus::Accepted;
        let values = consolidate(vec![low, high]);
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].confidence, 0.9);
    }
}
