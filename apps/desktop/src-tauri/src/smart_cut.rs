use crate::project_storage::{CutDecision, EdlManifest, ProjectStorage, WorkflowState};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
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
    #[serde(default)]
    candidates_detected: usize,
    #[serde(default)]
    candidates_rejected: usize,
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
    #[serde(default)]
    diagnostics: Vec<SilenceDiagnostic>,
    #[serde(default)]
    detector_version: String,
    #[serde(default)]
    rule_version: String,
    #[serde(default)]
    audio_stream: usize,
    #[serde(default)]
    sample_rate: Option<u64>,
    #[serde(default)]
    channels: Option<u64>,
    #[serde(default)]
    analysis_duration_ms: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
struct SilenceDiagnostic {
    threshold_db: i32,
    raw_silence_count: usize,
    raw_silence_duration_ms: u64,
    too_short: usize,
    unsafe_count: usize,
    candidate_count: usize,
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

struct DetectedSilences {
    suggestions: Vec<SmartCutSuggestion>,
    intervals: usize,
    rejected: usize,
    raw_duration_ms: u64,
    too_short: usize,
    unsafe_count: usize,
}

fn detect_silences(
    source: &Path,
    settings: AnalysisConfig,
    duration_us: u64,
    threshold_db: i32,
    audio_stream: usize,
) -> Result<DetectedSilences, SmartCutError> {
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(source)
        .arg("-map")
        .arg(format!("0:a:{audio_stream}"))
        .arg("-vn")
        .args([
            "-af",
            &format!("silencedetect=n={threshold_db}dB:d=0.200"),
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
    let mut intervals = 0;
    let mut rejected = 0;
    let mut raw_duration_ms = 0;
    let mut too_short = 0;
    let mut unsafe_count = 0;
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
                intervals += 1;
                raw_duration_ms += value.saturating_sub(start) / 1_000;
                if value.saturating_sub(start) < settings.silence_threshold_us {
                    too_short += 1;
                    rejected += 1;
                    continue;
                }
                let cut_start = start.saturating_add(settings.speech_guard_us);
                let cut_end = value
                    .saturating_sub(settings.speech_guard_us)
                    .min(duration_us);
                if cut_end.saturating_sub(cut_start) >= settings.minimum_cut_us {
                    let confidence = (0.76 + (cut_end - cut_start) as f64 / 8_000_000.0).min(0.98);
                    if let Some(item) = candidate(cut_start, cut_end, confidence, duration_us) {
                        result.push(item);
                    } else {
                        rejected += 1;
                        unsafe_count += 1;
                    }
                } else {
                    rejected += 1;
                    unsafe_count += 1;
                }
            }
        }
    }
    result.sort_by_key(|item| item.start_us);
    Ok(DetectedSilences {
        suggestions: result,
        intervals,
        rejected,
        raw_duration_ms,
        too_short,
        unsafe_count,
    })
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
    for item in &accepted {
        if !validate_range(item, duration_us, minimum) {
            return Err(SmartCutError::new(
                "invalid-cut-range",
                "Una sugerencia aceptada contiene un rango inválido.",
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
            automation: Some(crate::project_storage::DecisionAutomation {
                key: item.id.clone(),
                detector: "smart_cut".into(),
                detector_version: "ffmpeg-silencedetect-qa4-v2".into(),
                rule_version: Some("13d-qa4-cut-v1".into()),
                origin: "automatic".into(),
                confidence: Some(item.confidence),
                manual_action: None,
            }),
        })
        .collect())
}

fn merge_cut_decisions(
    existing: &mut Vec<CutDecision>,
    decisions: Vec<CutDecision>,
    resolutions: &HashMap<String, String>,
) -> Result<usize, SmartCutError> {
    use crate::conflicts::{classify_cut, overlap_us, timecode, ConflictClass};
    let mut working = existing.clone();
    let mut applied = 0;
    for mut decision in decisions {
        if working.iter().any(|item| item.id == decision.id) {
            continue;
        }
        let overlaps: Vec<_> = working
            .iter()
            .filter(|item| {
                classify_cut(
                    decision.start_us,
                    decision.end_us,
                    item.start_us,
                    item.end_us,
                    item.action == "remove",
                ) != ConflictClass::New
            })
            .cloned()
            .collect();
        let classes: Vec<_> = overlaps
            .iter()
            .map(|item| {
                classify_cut(
                    decision.start_us,
                    decision.end_us,
                    item.start_us,
                    item.end_us,
                    item.action == "remove",
                )
            })
            .collect();
        if classes
            .iter()
            .any(|class| matches!(class, ConflictClass::Conflict | ConflictClass::Overlap))
        {
            match resolutions.get(&decision.id).map(String::as_str) {
                Some("keep_existing") => continue,
                Some("merge") if overlaps.iter().all(|item| item.action == "remove") => {}
                Some("replace") => {
                    working.retain(|item| !overlaps.iter().any(|overlap| overlap.id == item.id));
                    working.push(decision);
                    applied += 1;
                    continue;
                }
                _ => {
                    let conflict = overlaps
                        .iter()
                        .zip(classes.iter())
                        .find(|(_, class)| {
                            matches!(class, ConflictClass::Conflict | ConflictClass::Overlap)
                        })
                        .map(|(item, _)| item)
                        .unwrap();
                    return Err(SmartCutError::new("edit-conflict", format!(
                        "Revisa el corte {}–{}: se solapa {:.3} s con el corte existente {}–{}. El EDL no cambió.",
                        timecode(decision.start_us), timecode(decision.end_us),
                        overlap_us(decision.start_us, decision.end_us, conflict.start_us, conflict.end_us) as f64 / 1_000_000.0,
                        timecode(conflict.start_us), timecode(conflict.end_us)
                    )));
                }
            }
        }
        if classes
            .iter()
            .any(|class| matches!(class, ConflictClass::Duplicate | ConflictClass::Contained))
        {
            continue;
        }
        if let Some(first) = overlaps.first() {
            decision.id = first.id.clone();
            decision.start_us = overlaps
                .iter()
                .fold(decision.start_us, |start, item| start.min(item.start_us));
            decision.end_us = overlaps
                .iter()
                .fold(decision.end_us, |end, item| end.max(item.end_us));
            working.retain(|item| !overlaps.iter().any(|overlap| overlap.id == item.id));
        }
        working.push(decision);
        applied += 1;
    }
    working.sort_by_key(|item| item.start_us);
    *existing = working;
    Ok(applied)
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
    let audio_stream = crate::export::selected_audio_stream(&bundle.edl);
    if audio_stream >= bundle.source.streams.audio as usize {
        return Err(SmartCutError::new(
            "audio-stream",
            "El stream de audio seleccionado no existe",
        ));
    }
    let analysis_started = std::time::Instant::now();
    let settings = config(profile);
    let detection = detect_silences(source_path, settings, duration_us, -35, audio_stream)?;
    let mut diagnostics = vec![SilenceDiagnostic {
        threshold_db: -35,
        raw_silence_count: detection.intervals,
        raw_silence_duration_ms: detection.raw_duration_ms,
        too_short: detection.too_short,
        unsafe_count: detection.unsafe_count,
        candidate_count: detection.suggestions.len(),
    }];
    for threshold_db in [-40, -45] {
        let measured = detect_silences(
            source_path,
            settings,
            duration_us,
            threshold_db,
            audio_stream,
        )?;
        diagnostics.push(SilenceDiagnostic {
            threshold_db,
            raw_silence_count: measured.intervals,
            raw_silence_duration_ms: measured.raw_duration_ms,
            too_short: measured.too_short,
            unsafe_count: measured.unsafe_count,
            candidate_count: measured.suggestions.len(),
        });
    }
    let analysis_duration_ms = analysis_started.elapsed().as_millis() as u64;
    eprintln!("SMART_CUT_AUDIO projectId={project_id} audioStream={audio_stream} sampleRate={:?} channels={:?} durationMs={} analysisDurationMs={analysis_duration_ms} silenceThresholdDb=-35 minimumSilenceMs={} rawSilenceCount={} rawSilenceDurationMs={} candidateCount={}", bundle.source.audio.sample_rate, bundle.source.audio.channels, duration_us / 1_000, settings.silence_threshold_us / 1_000, detection.intervals, detection.raw_duration_ms, detection.suggestions.len());
    let candidates_detected = detection.suggestions.len();
    let pre_consolidation = detection.suggestions.len();
    let suggestions = consolidate(detection.suggestions);
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
        statistics: SmartCutStatistics {
            candidates_detected,
            candidates_rejected: detection.rejected
                + pre_consolidation.saturating_sub(suggestions.len()),
            ..statistics(&suggestions)
        },
        diagnostics,
        detector_version: "ffmpeg-silencedetect-qa4-v2".into(),
        rule_version: "13d-qa4-cut-v1".into(),
        audio_stream,
        sample_rate: bundle.source.audio.sample_rate,
        channels: bundle.source.audio.channels,
        analysis_duration_ms,
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
    if document.project_id != request.project_id
        || document.status == AnalysisStatus::Stale
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
pub fn review_all_smart_cut_suggestions(
    app: AppHandle,
    project_id: String,
    status: SuggestionStatus,
) -> Result<SmartCutDocument, SmartCutError> {
    let storage = ProjectStorage::from_app(&app)
        .map_err(|_| SmartCutError::new("storage-error", "Storage no disponible"))?;
    let bundle = storage
        .load_project(&project_id)
        .map_err(|_| SmartCutError::new("project-not-found", "Proyecto no disponible"))?;
    let path = storage
        .project_dir(&project_id)
        .map_err(|_| SmartCutError::new("invalid-project-id", "projectId inválido"))?
        .join(SMART_CUT_FILE);
    let mut document: SmartCutDocument = storage
        .read_json(&path)
        .map_err(|_| SmartCutError::new("smart-cut-missing", "No existe análisis Smart Cut"))?;
    if document.project_id != project_id
        || document.status == AnalysisStatus::Stale
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
    if status == SuggestionStatus::Accepted
        && document.suggestions.iter().any(|item| {
            !validate_range(
                item,
                bundle.source.duration_us.unwrap_or(0),
                config(document.profile).minimum_cut_us,
            )
        })
    {
        return Err(SmartCutError::new(
            "invalid-cut-range",
            "Hay propuestas con un rango inválido",
        ));
    }
    let mut working = bundle.edl.tracks.cuts.clone();
    document.suggestions.sort_by_key(|item| item.start_us);
    for item in &mut document.suggestions {
        if status == SuggestionStatus::Accepted {
            use crate::conflicts::{classify_cut, ConflictClass};
            let duplicate = working.iter().any(|existing| {
                existing.id == item.id
                    || matches!(
                        classify_cut(
                            item.start_us,
                            item.end_us,
                            existing.start_us,
                            existing.end_us,
                            existing.action == "remove"
                        ),
                        ConflictClass::Duplicate | ConflictClass::Contained
                    )
            });
            item.status = if duplicate {
                SuggestionStatus::Rejected
            } else {
                SuggestionStatus::Accepted
            };
            if !duplicate {
                working.push(CutDecision {
                    id: item.id.clone(),
                    start_us: item.start_us,
                    end_us: item.end_us,
                    action: "remove".into(),
                    reason: None,
                    confidence: Some(item.confidence),
                    automation: Some(crate::project_storage::DecisionAutomation {
                        key: item.id.clone(),
                        detector: "smart_cut".into(),
                        detector_version: "ffmpeg-silencedetect-qa4-v2".into(),
                        rule_version: Some("13d-qa4-cut-v1".into()),
                        origin: "automatic".into(),
                        confidence: Some(item.confidence),
                        manual_action: None,
                    }),
                });
            }
        } else {
            item.status = status;
        }
    }
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
    resolutions: HashMap<String, String>,
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
    if document.project_id != project_id || document.status == AnalysisStatus::Stale {
        return Err(SmartCutError::new(
            "smart-cut-stale",
            "El análisis está desactualizado",
        ));
    }
    let decisions = accepted_cut_decisions(&document, bundle.source.duration_us.unwrap_or(0))?;
    let applied = merge_cut_decisions(&mut bundle.edl.tracks.cuts, decisions, &resolutions)?;
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
    fn controlled_speech_silence_speech_fixture_produces_two_candidates() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("speech-silence.wav");
        let mut command = Command::new("ffmpeg");
        command.args(["-y", "-hide_banner", "-loglevel", "error"]);
        for (kind, duration) in [
            ("sine=frequency=440:sample_rate=48000", "1"),
            ("anullsrc=r=48000:cl=mono", "1.8"),
            ("sine=frequency=440:sample_rate=48000", "1"),
            ("anullsrc=r=48000:cl=mono", "1.8"),
            ("sine=frequency=440:sample_rate=48000", "1"),
        ] {
            command.args(["-f", "lavfi", "-t", duration, "-i", kind]);
        }
        let generated = command
            .args([
                "-filter_complex",
                "[0:a][1:a][2:a][3:a][4:a]concat=n=5:v=0:a=1[out]",
                "-map",
                "[out]",
                "-c:a",
                "pcm_s16le",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        let detected =
            detect_silences(&source, config(SmartCutProfile::Normal), 6_600_000, -35, 0).unwrap();
        assert_eq!(detected.intervals, 2);
        assert_eq!(detected.rejected, 0);
        assert_eq!(detected.suggestions.len(), 2);
    }

    #[test]
    fn continuous_audio_can_produce_zero_silence_candidates() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("continuous.wav");
        let status = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=5",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(status.success());
        let detected =
            detect_silences(&source, config(SmartCutProfile::Normal), 5_000_000, -35, 0).unwrap();
        assert_eq!(detected.intervals, 0);
        assert!(detected.suggestions.is_empty());
    }

    #[test]
    fn detects_minute_long_silence_after_first_minute_without_truncation() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("long-gap.wav");
        let generated = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-t",
                "65",
                "-i",
                "sine=frequency=440:sample_rate=16000",
                "-f",
                "lavfi",
                "-t",
                "60",
                "-i",
                "anullsrc=r=16000:cl=mono",
                "-f",
                "lavfi",
                "-t",
                "5",
                "-i",
                "sine=frequency=440:sample_rate=16000",
                "-filter_complex",
                "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
                "-map",
                "[out]",
                "-c:a",
                "pcm_s16le",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        let detected = detect_silences(
            &source,
            config(SmartCutProfile::Normal),
            130_000_000,
            -35,
            0,
        )
        .unwrap();
        assert_eq!(detected.suggestions.len(), 1);
        let cut = &detected.suggestions[0];
        assert!(cut.start_us >= 65_000_000 && cut.start_us <= 65_500_000);
        assert!(cut.duration_us > 59_000_000);
        assert!(cut.end_us < 125_000_000);
    }
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
    #[test]
    fn applying_contained_and_overlapping_cuts_is_idempotent() {
        let make = |id: &str, start_us, end_us| CutDecision {
            id: id.into(),
            start_us,
            end_us,
            action: "remove".into(),
            reason: None,
            confidence: None,
            automation: None,
        };
        let mut existing = vec![make("old", 42_800_000, 45_500_000)];
        let decisions = vec![
            make("inside", 43_000_000, 45_260_000),
            make("extend", 45_000_000, 46_000_000),
        ];
        let resolutions = HashMap::from([("extend".into(), "merge".into())]);
        assert_eq!(
            merge_cut_decisions(&mut existing, decisions.clone(), &resolutions).unwrap(),
            1
        );
        assert_eq!(existing.len(), 1);
        assert_eq!(
            (existing[0].start_us, existing[0].end_us),
            (42_800_000, 46_000_000)
        );
        assert_eq!(
            merge_cut_decisions(&mut existing, decisions, &Default::default()).unwrap(),
            0
        );
    }

    #[test]
    fn cut_batch_conflict_is_atomic_and_duplicate_is_skipped() {
        let make = |id: &str, start_us, end_us| CutDecision {
            id: id.into(),
            start_us,
            end_us,
            action: "remove".into(),
            reason: None,
            confidence: None,
            automation: None,
        };
        let original = vec![make("old", 10_000_000, 15_000_000)];
        let mut existing = original.clone();
        let decisions = vec![
            make("new", 1_000_000, 2_000_000),
            make("overlap", 12_000_000, 18_000_000),
        ];
        assert!(
            merge_cut_decisions(&mut existing, decisions.clone(), &Default::default()).is_err()
        );
        assert_eq!(existing, original);
        let resolutions = HashMap::from([("overlap".into(), "keep_existing".into())]);
        assert_eq!(
            merge_cut_decisions(&mut existing, decisions, &resolutions).unwrap(),
            1
        );
        assert_eq!(existing.len(), 2);
        assert_eq!(
            merge_cut_decisions(
                &mut existing,
                vec![make("repeat", 10_050_000, 15_040_000)],
                &Default::default()
            )
            .unwrap(),
            0
        );
    }
}
