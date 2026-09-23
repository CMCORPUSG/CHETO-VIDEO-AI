use crate::project_storage::{CutDecision, EdlManifest, ProjectStorage, WorkflowState};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::BufReader,
    path::Path,
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const SMART_CUT_FILE: &str = "smart_cut.json";
const TRANSCRIPT_FILE: &str = "transcript.json";

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Transcript {
    source_id: String,
    source: TranscriptSource,
    segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptSource {
    file_size_bytes: u64,
    modified_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptSegment {
    start_us: Option<u64>,
    end_us: Option<u64>,
    text: String,
    words: Vec<TranscriptWord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptWord {
    start_us: Option<u64>,
    end_us: Option<u64>,
    text: String,
    probability: Option<f64>,
}

#[derive(Debug, Clone, Copy)]
struct AnalysisConfig {
    silence_threshold_us: u64,
    minimum_cut_us: u64,
    speech_guard_us: u64,
    maximum_reform_gap_us: u64,
    filler_probability: f64,
    repetition_confidence: f64,
    false_start_confidence: f64,
}

fn config(profile: SmartCutProfile) -> AnalysisConfig {
    match profile {
        SmartCutProfile::Conservative => AnalysisConfig {
            silence_threshold_us: 1_500_000,
            minimum_cut_us: 400_000,
            speech_guard_us: 180_000,
            maximum_reform_gap_us: 900_000,
            filler_probability: 0.75,
            repetition_confidence: 0.88,
            false_start_confidence: 0.82,
        },
        SmartCutProfile::Normal => AnalysisConfig {
            silence_threshold_us: 1_200_000,
            minimum_cut_us: 300_000,
            speech_guard_us: 150_000,
            maximum_reform_gap_us: 1_200_000,
            filler_probability: 0.60,
            repetition_confidence: 0.76,
            false_start_confidence: 0.70,
        },
        SmartCutProfile::Aggressive => AnalysisConfig {
            silence_threshold_us: 1_000_000,
            minimum_cut_us: 180_000,
            speech_guard_us: 100_000,
            maximum_reform_gap_us: 1_500_000,
            filler_probability: 0.45,
            repetition_confidence: 0.64,
            false_start_confidence: 0.60,
        },
    }
}

fn emit(app: &AppHandle, project_id: &str, stage: &str, completed: u8, total: u8) {
    let _ = app.emit(
        "smart-cut://progress",
        serde_json::json!({
            "projectId": project_id,
            "stage": stage,
            "completedSteps": completed,
            "totalSteps": total
        }),
    );
}

fn file_modified_at(path: &Path) -> Option<String> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .map(|value| DateTime::<Utc>::from(value).to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn normalize_token(value: &str) -> String {
    value
        .trim()
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_lowercase()
}

fn tokens(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .map(normalize_token)
        .filter(|value| !value.is_empty())
        .collect()
}

fn common_prefix(left: &[String], right: &[String]) -> usize {
    left.iter()
        .zip(right)
        .take_while(|(left, right)| left == right)
        .count()
}

fn ordered_similarity(left: &[String], right: &[String]) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let mut cursor = 0;
    let mut matched = 0;
    for token in left {
        if let Some(offset) = right[cursor..].iter().position(|item| item == token) {
            cursor += offset + 1;
            matched += 1;
            if cursor >= right.len() {
                break;
            }
        }
    }
    matched as f64 / left.len() as f64
}

fn suggestion_id(kind: SuggestionType, start_us: u64, end_us: u64) -> String {
    Uuid::new_v5(
        &Uuid::NAMESPACE_OID,
        format!("smart-cut:{kind:?}:{start_us}:{end_us}").as_bytes(),
    )
    .to_string()
}

fn candidate(
    kind: SuggestionType,
    start_us: u64,
    end_us: u64,
    confidence: f64,
    reason: &str,
    duration_us: u64,
) -> Option<SmartCutSuggestion> {
    if end_us <= start_us || end_us > duration_us {
        return None;
    }
    Some(SmartCutSuggestion {
        id: suggestion_id(kind, start_us, end_us),
        suggestion_type: kind,
        start_us,
        end_us,
        duration_us: end_us - start_us,
        confidence: confidence.clamp(0.0, 1.0),
        reason: reason.into(),
        status: SuggestionStatus::Pending,
    })
}

fn detect_silences(
    segments: &[TranscriptSegment],
    settings: AnalysisConfig,
    duration_us: u64,
) -> Vec<SmartCutSuggestion> {
    segments
        .windows(2)
        .filter_map(|pair| {
            let speech_end = pair[0].end_us?;
            let speech_start = pair[1].start_us?;
            let gap = speech_start.checked_sub(speech_end)?;
            if gap < settings.silence_threshold_us {
                return None;
            }
            let start = speech_end.saturating_add(settings.speech_guard_us);
            let end = speech_start.saturating_sub(settings.speech_guard_us);
            if end.saturating_sub(start) < settings.minimum_cut_us {
                return None;
            }
            let confidence = (0.78 + (gap as f64 / 6_000_000.0)).min(0.98);
            candidate(
                SuggestionType::Silence,
                start,
                end,
                confidence,
                "Silencio prolongado entre dos segmentos de voz; se conservan márgenes de habla.",
                duration_us,
            )
        })
        .collect()
}

fn detect_fillers(
    segments: &[TranscriptSegment],
    settings: AnalysisConfig,
    duration_us: u64,
) -> Vec<SmartCutSuggestion> {
    let unambiguous: HashSet<&str> = ["eh", "ehh", "em", "mmm", "uh", "um", "erm"]
        .into_iter()
        .collect();
    let ambiguous: HashSet<&str> = ["este", "bueno"].into_iter().collect();
    let mut result = Vec::new();
    for segment in segments {
        let segment_tokens = tokens(&segment.text);
        for word in &segment.words {
            let token = normalize_token(&word.text);
            let is_ambiguous_standalone = ambiguous.contains(token.as_str())
                && segment_tokens.len() == 1
                && segment_tokens.first() == Some(&token);
            if !unambiguous.contains(token.as_str()) && !is_ambiguous_standalone {
                continue;
            }
            let (Some(start), Some(end)) = (word.start_us, word.end_us) else {
                continue;
            };
            let probability = word.probability.unwrap_or(0.0);
            if probability < settings.filler_probability
                || end.saturating_sub(start) < settings.minimum_cut_us
                || end.saturating_sub(start) > 1_000_000
            {
                continue;
            }
            if let Some(item) = candidate(
                SuggestionType::Filler,
                start,
                end,
                (0.72 + probability * 0.22).min(0.96),
                if is_ambiguous_standalone {
                    "Muletilla ambigua aislada como segmento independiente."
                } else {
                    "Muletilla breve con timestamps y confianza suficientes."
                },
                duration_us,
            ) {
                result.push(item);
            }
        }
    }
    result
}

fn detect_reforms(
    segments: &[TranscriptSegment],
    settings: AnalysisConfig,
    duration_us: u64,
) -> Vec<SmartCutSuggestion> {
    let mut result = Vec::new();
    for pair in segments.windows(2) {
        let (Some(start), Some(end), Some(next_start)) =
            (pair[0].start_us, pair[0].end_us, pair[1].start_us)
        else {
            continue;
        };
        if next_start.saturating_sub(end) > settings.maximum_reform_gap_us
            || end.saturating_sub(start) < settings.minimum_cut_us
        {
            continue;
        }
        let left = tokens(&pair[0].text);
        let right = tokens(&pair[1].text);
        if left.len() < 2 || right.len() < 3 || right.len() <= left.len() {
            continue;
        }
        let prefix = common_prefix(&left, &right);
        let similarity = ordered_similarity(&left, &right);
        if prefix >= 2 {
            let confidence = (0.72 + prefix as f64 / left.len() as f64 * 0.25).min(0.98);
            if confidence >= settings.repetition_confidence {
                if let Some(item) = candidate(
                    SuggestionType::Repetition,
                    start,
                    end,
                    confidence,
                    "Inicio repetido inmediatamente antes de una versión más completa.",
                    duration_us,
                ) {
                    result.push(item);
                }
            }
            continue;
        }
        let incomplete = !pair[0].text.trim_end().ends_with(['.', '!', '?']);
        let confidence = (0.58 + similarity * 0.34).min(0.94);
        if incomplete && similarity >= 0.60 && confidence >= settings.false_start_confidence {
            if let Some(item) = candidate(
                SuggestionType::FalseStart,
                start,
                end,
                confidence,
                "Frase incompleta seguida de una reformulación cercana y más extensa.",
                duration_us,
            ) {
                result.push(item);
            }
        }
    }
    result
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

#[cfg(test)]
fn analyze_transcript(
    transcript: &Transcript,
    profile: SmartCutProfile,
    duration_us: u64,
) -> Vec<SmartCutSuggestion> {
    let settings = config(profile);
    let mut suggestions = detect_silences(&transcript.segments, settings, duration_us);
    suggestions.extend(detect_fillers(&transcript.segments, settings, duration_us));
    suggestions.extend(detect_reforms(&transcript.segments, settings, duration_us));
    consolidate(suggestions)
}

fn read_transcript(path: &Path) -> Result<Transcript, SmartCutError> {
    let file = File::open(path).map_err(|_| {
        SmartCutError::new(
            "transcript-required",
            "Smart Cut requiere una transcripción válida. Transcribe el proyecto primero.",
        )
    })?;
    serde_json::from_reader(BufReader::new(file)).map_err(|error| {
        SmartCutError::new(
            "transcript-invalid",
            format!("La transcripción no es válida: {error}"),
        )
    })
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
    let project_dir = storage
        .project_dir(project_id)
        .map_err(|_| SmartCutError::new("invalid-project-id", "projectId inválido"))?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let _ = storage.update_smart_cut_workflow(project_id, WorkflowState::Preparing, now.clone());
    emit(app, project_id, "preparing", 0, 5);
    let transcript = read_transcript(&project_dir.join(TRANSCRIPT_FILE))?;
    emit(app, project_id, "analyzing_transcript", 1, 5);
    let source_path = Path::new(&bundle.source.path);
    let source_metadata = fs::metadata(source_path).map_err(|_| {
        SmartCutError::new(
            "source-unavailable",
            "El video original no está disponible en su ubicación guardada.",
        )
    })?;
    if transcript.source_id != bundle.source.source_id
        || transcript.source.file_size_bytes != bundle.source.file_size_bytes
        || transcript.source.file_size_bytes != source_metadata.len()
        || transcript.source.modified_at != file_modified_at(source_path)
    {
        return Err(SmartCutError::new(
            "transcript-stale",
            "La transcripción no corresponde al archivo original actual.",
        ));
    }
    let duration_us = bundle.source.duration_us.unwrap_or(0);
    if duration_us == 0 {
        return Err(SmartCutError::new(
            "duration-unavailable",
            "La duración de la fuente no está disponible.",
        ));
    }
    let _ = storage.update_smart_cut_workflow(project_id, WorkflowState::Running, now.clone());
    emit(app, project_id, "analyzing_silences", 2, 5);
    let settings = config(profile);
    let mut suggestions = detect_silences(&transcript.segments, settings, duration_us);
    suggestions.extend(detect_fillers(&transcript.segments, settings, duration_us));
    emit(app, project_id, "detecting_repetitions", 3, 5);
    suggestions.extend(detect_reforms(&transcript.segments, settings, duration_us));
    let suggestions = consolidate(suggestions);
    emit(app, project_id, "consolidating_suggestions", 4, 5);
    let created_at = storage
        .read_json::<SmartCutDocument>(&project_dir.join(SMART_CUT_FILE))
        .ok()
        .map(|document| document.created_at)
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
            file_size_bytes: bundle.source.file_size_bytes,
            modified_at: file_modified_at(source_path),
            duration_us,
        },
        statistics: statistics(&suggestions),
        suggestions,
    };
    emit(app, project_id, "saving", 4, 5);
    storage
        .write_json(&project_dir.join(SMART_CUT_FILE), &document)
        .map_err(|_| {
            SmartCutError::new("smart-cut-write-failed", "No se pudo guardar Smart Cut")
        })?;
    let _ = storage.update_smart_cut_workflow(project_id, WorkflowState::Completed, now);
    emit(app, project_id, "completed", 5, 5);
    Ok(document)
}

#[tauri::command]
pub fn analyze_smart_cut(
    app: AppHandle,
    project_id: String,
    profile: SmartCutProfile,
) -> Result<SmartCutDocument, SmartCutError> {
    let result = analyze_impl(&app, &project_id, profile);
    if result.is_err() {
        if let Ok(storage) = ProjectStorage::from_app(&app) {
            let _ = storage.update_smart_cut_workflow(
                &project_id,
                WorkflowState::Error,
                Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            );
        }
        emit(&app, &project_id, "error", 0, 5);
    }
    result
}

#[tauri::command]
pub fn get_smart_cut(
    app: AppHandle,
    project_id: String,
) -> Result<Option<SmartCutDocument>, SmartCutError> {
    ProjectStorage::validate_id(&project_id, "projectId")
        .map_err(|_| SmartCutError::new("invalid-project-id", "projectId inválido"))?;
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
    let mut document: SmartCutDocument = storage.read_json(&path).map_err(|_| {
        SmartCutError::new(
            "smart-cut-invalid",
            "smart_cut.json está corrupto o no es válido",
        )
    })?;
    if document.schema_version != 1 || document.project_id != project_id {
        return Err(SmartCutError::new(
            "smart-cut-invalid",
            "smart_cut.json no corresponde al proyecto",
        ));
    }
    if document_is_stale(
        &document,
        &bundle.source.source_id,
        Path::new(&bundle.source.path),
    ) {
        document.status = AnalysisStatus::Stale;
        document.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        storage
            .write_json(&path, &document)
            .map_err(|_| SmartCutError::new("smart-cut-write-failed", "No se pudo marcar stale"))?;
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
            "El análisis está desactualizado; vuelve a analizar.",
        ));
    }
    let duration_us = bundle.source.duration_us.unwrap_or(0);
    let minimum_cut_us = config(document.profile).minimum_cut_us;
    let suggestion = document
        .suggestions
        .iter_mut()
        .find(|item| item.id == request.suggestion_id)
        .ok_or_else(|| SmartCutError::new("suggestion-not-found", "Sugerencia no encontrada"))?;
    if request.status == SuggestionStatus::Accepted
        && !validate_range(suggestion, duration_us, minimum_cut_us)
    {
        return Err(SmartCutError::new(
            "invalid-cut-range",
            "La sugerencia contiene un rango inválido y no puede aceptarse.",
        ));
    }
    suggestion.status = request.status;
    document.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    document.statistics = statistics(&document.suggestions);
    storage.write_json(&path, &document).map_err(|_| {
        SmartCutError::new("smart-cut-write-failed", "No se pudo guardar la revisión")
    })?;
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
    let project_dir = storage
        .project_dir(&project_id)
        .map_err(|_| SmartCutError::new("invalid-project-id", "projectId inválido"))?;
    let document: SmartCutDocument = storage
        .read_json(&project_dir.join(SMART_CUT_FILE))
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
            "El análisis está desactualizado y no puede aplicarse.",
        ));
    }
    let duration_us = bundle.source.duration_us.unwrap_or(0);
    let accepted = accepted_cut_decisions(&document, duration_us)?;
    let mut applied_count = 0;
    for cut in accepted {
        if bundle.edl.tracks.cuts.iter().any(|item| item.id == cut.id) {
            continue;
        }
        if bundle
            .edl
            .tracks
            .cuts
            .iter()
            .any(|item| item.start_us < cut.end_us && cut.start_us < item.end_us)
        {
            return Err(SmartCutError::new(
                "edl-cut-conflict",
                "Una sugerencia entra en conflicto con un corte existente del EDL.",
            ));
        }
        bundle.edl.tracks.cuts.push(cut);
        applied_count += 1;
    }
    bundle.edl.tracks.cuts.sort_by_key(|cut| cut.start_us);
    bundle.edl.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    storage
        .write_json(&project_dir.join("edl.json"), &bundle.edl)
        .map_err(|_| SmartCutError::new("edl-write-failed", "No se pudo actualizar el EDL"))?;
    let _ = storage.update_smart_cut_workflow(
        &project_id,
        WorkflowState::Completed,
        bundle.edl.updated_at.clone(),
    );
    Ok(ApplySmartCutResult {
        document,
        edl: bundle.edl,
        applied_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn word(text: &str, start: u64, end: u64, probability: f64) -> TranscriptWord {
        TranscriptWord {
            start_us: Some(start),
            end_us: Some(end),
            text: text.into(),
            probability: Some(probability),
        }
    }

    fn segment(start: u64, end: u64, text: &str, words: Vec<TranscriptWord>) -> TranscriptSegment {
        TranscriptSegment {
            start_us: Some(start),
            end_us: Some(end),
            text: text.into(),
            words,
        }
    }

    fn transcript(segments: Vec<TranscriptSegment>) -> Transcript {
        Transcript {
            source_id: Uuid::new_v4().to_string(),
            source: TranscriptSource {
                file_size_bytes: 10,
                modified_at: None,
            },
            segments,
        }
    }

    fn test_document(suggestions: Vec<SmartCutSuggestion>) -> SmartCutDocument {
        SmartCutDocument {
            schema_version: 1,
            project_id: Uuid::new_v4().to_string(),
            source_id: Uuid::new_v4().to_string(),
            created_at: "now".into(),
            updated_at: "now".into(),
            profile: SmartCutProfile::Aggressive,
            status: AnalysisStatus::Completed,
            source: SmartCutSource {
                file_size_bytes: 1,
                modified_at: None,
                duration_us: 2_000_000,
            },
            statistics: statistics(&suggestions),
            suggestions,
        }
    }

    #[test]
    fn valid_silence_is_detected_but_short_pause_is_not() {
        let long = transcript(vec![
            segment(0, 1_000_000, "hola", vec![]),
            segment(3_000_000, 4_000_000, "mundo", vec![]),
        ]);
        assert_eq!(
            analyze_transcript(&long, SmartCutProfile::Normal, 5_000_000).len(),
            1
        );
        let short = transcript(vec![
            segment(0, 1_000_000, "hola", vec![]),
            segment(1_500_000, 2_000_000, "mundo", vec![]),
        ]);
        assert!(analyze_transcript(&short, SmartCutProfile::Normal, 3_000_000).is_empty());
    }

    #[test]
    fn standalone_filler_is_detected() {
        let value = transcript(vec![segment(
            0,
            500_000,
            "eh",
            vec![word("eh", 0, 500_000, 0.95)],
        )]);
        assert_eq!(
            analyze_transcript(&value, SmartCutProfile::Normal, 1_000_000)[0].suggestion_type,
            SuggestionType::Filler
        );
    }

    #[test]
    fn immediate_repetition_removes_first_version() {
        let value = transcript(vec![
            segment(0, 700_000, "vamos a crear", vec![]),
            segment(800_000, 2_000_000, "vamos a crear un proyecto", vec![]),
        ]);
        assert_eq!(
            analyze_transcript(&value, SmartCutProfile::Normal, 3_000_000)[0].suggestion_type,
            SuggestionType::Repetition
        );
    }

    #[test]
    fn abandoned_false_start_is_detected() {
        let value = transcript(vec![
            segment(0, 900_000, "ahora vamos a configurar el", vec![]),
            segment(
                1_000_000,
                2_500_000,
                "vamos a configurar correctamente el proyecto",
                vec![],
            ),
        ]);
        assert_eq!(
            analyze_transcript(&value, SmartCutProfile::Normal, 3_000_000)[0].suggestion_type,
            SuggestionType::FalseStart
        );
    }

    #[test]
    fn ranges_use_integer_microseconds_and_invalid_range_is_rejected() {
        let valid = candidate(SuggestionType::Silence, 1, 400_001, 0.9, "x", 1_000_000).unwrap();
        assert_eq!(valid.duration_us, 400_000);
        assert!(validate_range(&valid, 1_000_000, 300_000));
        assert!(candidate(SuggestionType::Silence, 5, 5, 0.9, "x", 10).is_none());
    }

    #[test]
    fn overlap_keeps_highest_confidence() {
        let low = candidate(SuggestionType::Filler, 100, 500, 0.7, "x", 1_000).unwrap();
        let high = candidate(SuggestionType::Repetition, 200, 600, 0.95, "x", 1_000).unwrap();
        let result = consolidate(vec![low, high.clone()]);
        assert_eq!(result, vec![high]);
    }

    #[test]
    fn source_stale_is_detected() {
        let d = TempDir::new().unwrap();
        let source = d.path().join("source.mp4");
        fs::write(&source, b"video").unwrap();
        let document = SmartCutDocument {
            schema_version: 1,
            project_id: Uuid::new_v4().to_string(),
            source_id: "old".into(),
            created_at: "now".into(),
            updated_at: "now".into(),
            profile: SmartCutProfile::Normal,
            status: AnalysisStatus::Completed,
            source: SmartCutSource {
                file_size_bytes: 5,
                modified_at: file_modified_at(&source),
                duration_us: 10,
            },
            statistics: SmartCutStatistics::default(),
            suggestions: vec![],
        };
        assert!(document_is_stale(&document, "new", &source));
    }

    #[test]
    fn statuses_and_statistics_are_persisted() {
        let mut items =
            vec![candidate(SuggestionType::Silence, 0, 400, 0.9, "x", 1_000).unwrap(); 3];
        items[0].status = SuggestionStatus::Accepted;
        items[1].status = SuggestionStatus::Rejected;
        items[2].status = SuggestionStatus::Pending;
        let result = statistics(&items);
        assert_eq!(
            (result.accepted, result.rejected, result.pending),
            (1, 1, 1)
        );
    }

    #[test]
    fn only_accepted_passes_to_edl() {
        let mut accepted =
            candidate(SuggestionType::Silence, 0, 400_000, 0.9, "x", 2_000_000).unwrap();
        accepted.status = SuggestionStatus::Accepted;
        let mut rejected = candidate(
            SuggestionType::Filler,
            500_000,
            900_000,
            0.9,
            "x",
            2_000_000,
        )
        .unwrap();
        rejected.status = SuggestionStatus::Rejected;
        let pending = candidate(
            SuggestionType::Filler,
            1_000_000,
            1_400_000,
            0.9,
            "x",
            2_000_000,
        )
        .unwrap();
        let cuts =
            accepted_cut_decisions(&test_document(vec![accepted, rejected, pending]), 2_000_000)
                .unwrap();
        assert_eq!(cuts.len(), 1);
        assert_eq!(cuts[0].action, "remove");
    }

    #[test]
    fn profiles_change_thresholds_conservatively() {
        assert!(
            config(SmartCutProfile::Conservative).silence_threshold_us
                > config(SmartCutProfile::Normal).silence_threshold_us
        );
        assert!(
            config(SmartCutProfile::Normal).silence_threshold_us
                > config(SmartCutProfile::Aggressive).silence_threshold_us
        );
    }

    #[test]
    fn missing_and_corrupt_transcript_are_controlled() {
        let d = TempDir::new().unwrap();
        assert_eq!(
            read_transcript(&d.path().join("missing.json"))
                .unwrap_err()
                .code,
            "transcript-required"
        );
        let corrupt = d.path().join("transcript.json");
        fs::write(&corrupt, b"not json").unwrap();
        assert_eq!(
            read_transcript(&corrupt).unwrap_err().code,
            "transcript-invalid"
        );
    }

    #[test]
    fn smart_cut_json_round_trips_and_corruption_errors() {
        let d = TempDir::new().unwrap();
        let storage = ProjectStorage::new(d.path().into());
        let path = d.path().join("smart_cut.json");
        let document = SmartCutDocument {
            schema_version: 1,
            project_id: Uuid::new_v4().to_string(),
            source_id: Uuid::new_v4().to_string(),
            created_at: "now".into(),
            updated_at: "now".into(),
            profile: SmartCutProfile::Normal,
            status: AnalysisStatus::Completed,
            source: SmartCutSource {
                file_size_bytes: 1,
                modified_at: None,
                duration_us: 1_000,
            },
            statistics: SmartCutStatistics::default(),
            suggestions: vec![],
        };
        storage.write_json(&path, &document).unwrap();
        assert_eq!(
            storage.read_json::<SmartCutDocument>(&path).unwrap(),
            document
        );
        fs::write(&path, b"broken").unwrap();
        assert!(storage.read_json::<SmartCutDocument>(&path).is_err());
    }
}
