use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashSet;
use std::{
    fs::{self, File, OpenOptions},
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const PROJECT_SCHEMA_VERSION: u32 = 1;
const SOURCE_SCHEMA_VERSION: u32 = 1;
const EDL_SCHEMA_VERSION: u32 = 1;
const PROJECT_FILE: &str = "project.json";
const SOURCE_FILE: &str = "source.json";
const EDL_FILE: &str = "edl.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStorageError {
    pub(crate) code: String,
    pub(crate) message: String,
}

impl ProjectStorageError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSourceReference {
    source_id: String,
    file_name: String,
    original_path: String,
    source_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EdlReference {
    schema_version: u32,
    file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkflowState {
    NotStarted,
    Preparing,
    Running,
    Completed,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStatus {
    ingest: WorkflowState,
    scene_analysis: WorkflowState,
    smart_cut: WorkflowState,
    smart_camera: WorkflowState,
    broll: WorkflowState,
    render: WorkflowState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    schema_version: u32,
    project_id: String,
    name: String,
    created_at: String,
    updated_at: String,
    source: ProjectSourceReference,
    edl: EdlReference,
    workflow: WorkflowStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FpsSnapshot {
    pub(crate) numerator: Option<u64>,
    pub(crate) denominator: Option<u64>,
    pub(crate) decimal: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceVideoSnapshot {
    pub(crate) codec: Option<String>,
    pub(crate) codec_long_name: Option<String>,
    pub(crate) width: Option<u64>,
    pub(crate) height: Option<u64>,
    pub(crate) display_width: Option<u64>,
    pub(crate) display_height: Option<u64>,
    pub(crate) fps: FpsSnapshot,
    pub(crate) pixel_format: Option<String>,
    pub(crate) bit_rate: Option<u64>,
    pub(crate) rotation: i32,
    pub(crate) display_aspect_ratio: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceAudioSnapshot {
    present: bool,
    codec: Option<String>,
    codec_long_name: Option<String>,
    pub(crate) sample_rate: Option<u64>,
    pub(crate) channels: Option<u64>,
    channel_layout: Option<String>,
    bit_rate: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamCounts {
    total: u64,
    video: u64,
    pub(crate) audio: u64,
    data: u64,
    other: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContainerSnapshot {
    display_name: String,
    raw_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceManifest {
    pub(crate) schema_version: u32,
    pub(crate) source_id: String,
    pub(crate) path: String,
    pub(crate) file_name: String,
    pub(crate) extension: String,
    pub(crate) file_size_bytes: u64,
    pub(crate) modified_at: Option<String>,
    pub(crate) duration_us: Option<u64>,
    pub(crate) container: ContainerSnapshot,
    pub(crate) video: SourceVideoSnapshot,
    pub(crate) audio: SourceAudioSnapshot,
    pub(crate) streams: StreamCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CutDecision {
    pub(crate) id: String,
    pub(crate) start_us: u64,
    pub(crate) end_us: u64,
    pub(crate) action: String,
    pub(crate) reason: Option<String>,
    pub(crate) confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) automation: Option<DecisionAutomation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraDecision {
    pub(crate) id: String,
    pub(crate) start_us: u64,
    pub(crate) end_us: u64,
    pub(crate) mode: String,
    pub(crate) zoom: Option<f64>,
    pub(crate) center_x: Option<f64>,
    pub(crate) center_y: Option<f64>,
    pub(crate) easing: Option<String>,
    pub(crate) reason: Option<String>,
    pub(crate) confidence: Option<f64>,
    #[serde(default)]
    pub(crate) transition_us: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) automation: Option<DecisionAutomation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrollDecision {
    id: String,
    start_us: u64,
    end_us: u64,
    media_type: String,
    source: String,
    asset_path: Option<String>,
    reason: Option<String>,
    confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDecision {
    pub(crate) id: String,
    pub(crate) start_us: u64,
    pub(crate) end_us: u64,
    pub(crate) operation: String,
    pub(crate) parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetDecision {
    pub(crate) id: String,
    pub(crate) asset_id: String,
    pub(crate) asset_path: String,
    pub(crate) source_duration_us: u64,
    pub(crate) kind: String,
    pub(crate) start_us: u64,
    pub(crate) end_us: u64,
    pub(crate) gain_db: f64,
    pub(crate) fade_in_us: u64,
    pub(crate) fade_out_us: u64,
    #[serde(rename = "loop")]
    pub(crate) loop_: bool,
    pub(crate) ducking: bool,
    pub(crate) duck_db: f64,
    pub(crate) attack_ms: u64,
    pub(crate) release_ms: u64,
    pub(crate) position_x: f64,
    pub(crate) position_y: f64,
    pub(crate) scale: f64,
    pub(crate) opacity: f64,
    pub(crate) muted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) preview_input_offset_us: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) automation: Option<DecisionAutomation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecisionAutomation {
    pub(crate) key: String,
    pub(crate) detector: String,
    pub(crate) detector_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) rule_version: Option<String>,
    pub(crate) origin: String,
    pub(crate) confidence: Option<f64>,
    pub(crate) manual_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitleDecision {
    pub(crate) id: String,
    pub(crate) preset_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) instance_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) template_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) parameters: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) template_snapshot: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) layer_overrides: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) layout_overrides: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description_text: Option<String>,
    pub(crate) text: String,
    pub(crate) secondary_text: String,
    pub(crate) start_us: u64,
    pub(crate) end_us: u64,
    pub(crate) position_x: f64,
    pub(crate) position_y: f64,
    pub(crate) anchor: String,
    pub(crate) scale: f64,
    pub(crate) font: String,
    pub(crate) font_weight: u32,
    pub(crate) font_size: f64,
    pub(crate) color: String,
    pub(crate) accent_color: String,
    pub(crate) alignment: String,
    pub(crate) tracking: f64,
    pub(crate) line_height: f64,
    pub(crate) opacity: f64,
    pub(crate) safe_area: f64,
    pub(crate) animation_in_us: u64,
    pub(crate) animation_out_us: u64,
    pub(crate) easing: String,
    pub(crate) background: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransitionDecision {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) at_us: u64,
    pub(crate) duration_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EdlTracks {
    pub(crate) cuts: Vec<CutDecision>,
    pub(crate) camera: Vec<CameraDecision>,
    broll: Vec<BrollDecision>,
    pub(crate) audio: Vec<AudioDecision>,
    #[serde(default)]
    pub(crate) assets: Vec<AssetDecision>,
    #[serde(default)]
    pub(crate) titles: Vec<TitleDecision>,
    #[serde(default)]
    pub(crate) transitions: Vec<TransitionDecision>,
}

impl EdlTracks {
    fn is_empty(&self) -> bool {
        self.cuts.is_empty()
            && self.camera.is_empty()
            && self.broll.is_empty()
            && self.audio.is_empty()
            && self.assets.is_empty()
            && self.titles.is_empty()
            && self.transitions.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EdlTimebase {
    unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EdlOutput {
    aspect_ratio_mode: String,
    resolution_mode: String,
    fps_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EdlManifest {
    #[serde(default)]
    pub(crate) manual_trim: Option<ManualTrim>,
    #[serde(default)]
    pub(crate) manual_split_points_us: Vec<u64>,
    pub(crate) audio_on_timeline: Option<bool>,
    #[serde(default)]
    pub(crate) automation: Option<AutomationSettings>,
    schema_version: u32,
    pub(crate) project_id: String,
    pub(crate) source_id: String,
    timebase: EdlTimebase,
    pub(crate) source_duration_us: Option<u64>,
    pub(crate) source_on_timeline: Option<bool>,
    pub(crate) tracks: EdlTracks,
    output: EdlOutput,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManualTrim {
    pub(crate) source_in_us: u64,
    pub(crate) source_out_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSettings {
    pub(crate) mode: String,
    pub(crate) rules_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBundle {
    pub(crate) project: ProjectManifest,
    pub(crate) source: SourceManifest,
    pub(crate) edl: EdlManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeProjectRequest {
    project: ProjectManifest,
    source: SourceManifest,
    edl: EdlManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStorageInfo {
    initialized: bool,
    projects_path: String,
}

pub(crate) struct ProjectStorage {
    projects_root: PathBuf,
}

impl ProjectStorage {
    pub(crate) fn new(projects_root: PathBuf) -> Self {
        Self { projects_root }
    }

    pub(crate) fn from_app(app: &AppHandle) -> Result<Self, ProjectStorageError> {
        let app_data = app.path().app_data_dir().map_err(|error| {
            ProjectStorageError::new(
                "app-data-unavailable",
                format!("No se pudo resolver el directorio de datos: {error}"),
            )
        })?;
        Ok(Self::new(app_data.join("projects")))
    }

    fn initialize(&self) -> Result<ProjectStorageInfo, ProjectStorageError> {
        fs::create_dir_all(&self.projects_root).map_err(|error| {
            ProjectStorageError::new(
                "storage-initialization-failed",
                format!("No se pudo preparar el almacenamiento de proyectos: {error}"),
            )
        })?;
        Ok(ProjectStorageInfo {
            initialized: true,
            projects_path: self.projects_root.to_string_lossy().into_owned(),
        })
    }

    pub(crate) fn validate_id(value: &str, label: &str) -> Result<(), ProjectStorageError> {
        Uuid::parse_str(value).map_err(|_| {
            ProjectStorageError::new(
                "invalid-project-id",
                format!("{label} no es un UUID válido."),
            )
        })?;
        Ok(())
    }

    pub(crate) fn project_dir(&self, project_id: &str) -> Result<PathBuf, ProjectStorageError> {
        Self::validate_id(project_id, "projectId")?;
        Ok(self.projects_root.join(project_id))
    }

    fn manifest_exists(&self, project_id: &str) -> Result<bool, ProjectStorageError> {
        let path = self.project_dir(project_id)?.join(PROJECT_FILE);
        Ok(path.is_file() || !Self::backup_candidates(&path).is_empty())
    }

    fn validate_bundle(
        bundle: &ProjectBundle,
        require_empty_edl: bool,
    ) -> Result<(), ProjectStorageError> {
        Self::validate_id(&bundle.project.project_id, "projectId")?;
        Self::validate_id(&bundle.source.source_id, "sourceId")?;
        if bundle.project.schema_version != PROJECT_SCHEMA_VERSION
            || bundle.source.schema_version != SOURCE_SCHEMA_VERSION
            || bundle.edl.schema_version != EDL_SCHEMA_VERSION
        {
            return Err(ProjectStorageError::new(
                "unsupported-schema",
                "El schema del proyecto no está soportado.",
            ));
        }
        if bundle.project.project_id != bundle.edl.project_id
            || bundle.project.source.source_id != bundle.source.source_id
            || bundle.source.source_id != bundle.edl.source_id
        {
            return Err(ProjectStorageError::new(
                "id-mismatch",
                "Los IDs del proyecto, fuente y EDL no coinciden.",
            ));
        }
        if bundle.project.source.source_json != SOURCE_FILE || bundle.project.edl.file != EDL_FILE {
            return Err(ProjectStorageError::new(
                "invalid-reference",
                "Las referencias internas del proyecto no son válidas.",
            ));
        }
        if bundle.edl.timebase.unit != "microseconds" {
            return Err(ProjectStorageError::new(
                "invalid-timebase",
                "La unidad temporal debe ser microseconds.",
            ));
        }
        if require_empty_edl && !bundle.edl.tracks.is_empty() {
            return Err(ProjectStorageError::new(
                "non-empty-edl",
                "Un EDL nuevo debe comenzar vacío.",
            ));
        }
        Ok(())
    }

    fn initialize_project(
        &self,
        request: InitializeProjectRequest,
    ) -> Result<ProjectBundle, ProjectStorageError> {
        let bundle = ProjectBundle {
            project: request.project,
            source: request.source,
            edl: request.edl,
        };
        Self::validate_bundle(&bundle, true)?;
        self.initialize()?;
        let project_dir = self.project_dir(&bundle.project.project_id)?;
        if self.manifest_exists(&bundle.project.project_id)? {
            return self.load_project(&bundle.project.project_id);
        }
        fs::create_dir_all(&project_dir).map_err(|error| {
            ProjectStorageError::new(
                "project-directory-failed",
                format!("No se pudo crear el directorio del proyecto: {error}"),
            )
        })?;
        self.write_json(&project_dir.join(SOURCE_FILE), &bundle.source)?;
        self.write_json(&project_dir.join(EDL_FILE), &bundle.edl)?;
        self.write_json(&project_dir.join(PROJECT_FILE), &bundle.project)?;
        Ok(bundle)
    }

    pub(crate) fn load_project(
        &self,
        project_id: &str,
    ) -> Result<ProjectBundle, ProjectStorageError> {
        let project_dir = self.project_dir(project_id)?;
        let bundle = ProjectBundle {
            project: self.read_json(&project_dir.join(PROJECT_FILE))?,
            source: self.read_json(&project_dir.join(SOURCE_FILE))?,
            edl: self.read_json(&project_dir.join(EDL_FILE))?,
        };
        Self::validate_bundle(&bundle, false)?;
        Ok(bundle)
    }

    pub(crate) fn update_smart_cut_workflow(
        &self,
        project_id: &str,
        state: WorkflowState,
        updated_at: String,
    ) -> Result<ProjectBundle, ProjectStorageError> {
        let mut bundle = self.load_project(project_id)?;
        bundle.project.workflow.smart_cut = state;
        bundle.project.updated_at = updated_at;
        self.write_json(
            &self.project_dir(project_id)?.join(PROJECT_FILE),
            &bundle.project,
        )?;
        Ok(bundle)
    }

    pub(crate) fn update_smart_camera_workflow(
        &self,
        project_id: &str,
        state: WorkflowState,
        updated_at: String,
    ) -> Result<ProjectBundle, ProjectStorageError> {
        let mut bundle = self.load_project(project_id)?;
        bundle.project.workflow.smart_camera = state;
        bundle.project.updated_at = updated_at;
        self.write_json(
            &self.project_dir(project_id)?.join(PROJECT_FILE),
            &bundle.project,
        )?;
        Ok(bundle)
    }

    fn save_project(
        &self,
        manifest: ProjectManifest,
    ) -> Result<ProjectManifest, ProjectStorageError> {
        Self::validate_id(&manifest.project_id, "projectId")?;
        if manifest.schema_version != PROJECT_SCHEMA_VERSION
            || manifest.source.source_json != SOURCE_FILE
            || manifest.edl.file != EDL_FILE
        {
            return Err(ProjectStorageError::new(
                "invalid-project-manifest",
                "project.json no es válido.",
            ));
        }
        let project_dir = self.project_dir(&manifest.project_id)?;
        if !project_dir.is_dir() {
            return Err(ProjectStorageError::new(
                "project-not-found",
                "El proyecto no existe en disco.",
            ));
        }
        self.write_json(&project_dir.join(PROJECT_FILE), &manifest)?;
        Ok(manifest)
    }

    fn save_edl(&self, edl: EdlManifest) -> Result<EdlManifest, ProjectStorageError> {
        Self::validate_id(&edl.project_id, "projectId")?;
        Self::validate_id(&edl.source_id, "sourceId")?;
        if edl.schema_version != EDL_SCHEMA_VERSION || edl.timebase.unit != "microseconds" {
            return Err(ProjectStorageError::new(
                "invalid-edl",
                "edl.json no es válido.",
            ));
        }
        let existing = self.load_project(&edl.project_id)?;
        if existing.source.source_id != edl.source_id {
            return Err(ProjectStorageError::new(
                "id-mismatch",
                "El sourceId del EDL no coincide con el proyecto.",
            ));
        }
        let project_dir = self.project_dir(&edl.project_id)?;
        self.write_json(&project_dir.join(EDL_FILE), &edl)?;
        Ok(edl)
    }

    fn update_source(&self, bundle: ProjectBundle) -> Result<ProjectBundle, ProjectStorageError> {
        Self::validate_bundle(&bundle, false)?;
        let existing = self.load_project(&bundle.project.project_id)?;
        if existing.source.source_id != bundle.source.source_id {
            return Err(ProjectStorageError::new(
                "id-mismatch",
                "No se puede sustituir el sourceId de un proyecto existente.",
            ));
        }
        let project_dir = self.project_dir(&bundle.project.project_id)?;
        self.write_json(&project_dir.join(SOURCE_FILE), &bundle.source)?;
        self.write_json(&project_dir.join(EDL_FILE), &bundle.edl)?;
        self.write_json(&project_dir.join(PROJECT_FILE), &bundle.project)?;
        Ok(bundle)
    }

    pub(crate) fn write_json<T: Serialize>(
        &self,
        destination: &Path,
        value: &T,
    ) -> Result<(), ProjectStorageError> {
        let parent = destination.parent().ok_or_else(|| {
            ProjectStorageError::new(
                "invalid-storage-path",
                "La ruta de almacenamiento no tiene directorio padre.",
            )
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            ProjectStorageError::new(
                "storage-write-failed",
                format!("No se pudo crear el directorio de destino: {error}"),
            )
        })?;
        let file_name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("manifest");
        let temporary = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
        let backup = parent.join(format!(".{file_name}.{}.bak", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| {
                ProjectStorageError::new(
                    "storage-write-failed",
                    format!("No se pudo crear el archivo temporal: {error}"),
                )
            })?;
        let write_result = (|| -> Result<(), ProjectStorageError> {
            {
                let mut writer = BufWriter::new(&mut file);
                serde_json::to_writer_pretty(&mut writer, value).map_err(|error| {
                    ProjectStorageError::new(
                        "serialization-failed",
                        format!("No se pudo serializar el JSON: {error}"),
                    )
                })?;
                writer.write_all(b"\n").map_err(|error| {
                    ProjectStorageError::new(
                        "storage-write-failed",
                        format!("No se pudo finalizar el JSON: {error}"),
                    )
                })?;
                writer.flush().map_err(|error| {
                    ProjectStorageError::new(
                        "storage-write-failed",
                        format!("No se pudo vaciar el archivo temporal: {error}"),
                    )
                })?;
            }
            file.sync_all().map_err(|error| {
                ProjectStorageError::new(
                    "storage-write-failed",
                    format!("No se pudo sincronizar el archivo temporal: {error}"),
                )
            })?;
            Ok(())
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        drop(file);

        if destination.exists() {
            fs::rename(destination, &backup).map_err(|error| {
                let _ = fs::remove_file(&temporary);
                ProjectStorageError::new(
                    "storage-replace-failed",
                    format!("No se pudo preparar el reemplazo seguro: {error}"),
                )
            })?;
        }
        if let Err(error) = fs::rename(&temporary, destination) {
            if backup.exists() {
                let _ = fs::rename(&backup, destination);
            }
            let _ = fs::remove_file(&temporary);
            return Err(ProjectStorageError::new(
                "storage-replace-failed",
                format!("No se pudo reemplazar el JSON: {error}"),
            ));
        }
        if backup.exists() {
            let _ = fs::remove_file(backup);
        }
        Ok(())
    }

    pub(crate) fn read_json<T: DeserializeOwned>(
        &self,
        path: &Path,
    ) -> Result<T, ProjectStorageError> {
        let original = File::open(path)
            .map_err(|error| {
                ProjectStorageError::new(
                    "project-file-unavailable",
                    format!(
                        "No se pudo abrir {}: {error}",
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or("JSON")
                    ),
                )
            })
            .and_then(|file| {
                serde_json::from_reader(BufReader::new(file)).map_err(|error| {
                    ProjectStorageError::new(
                        "corrupt-json",
                        format!(
                            "{} contiene JSON inválido: {error}",
                            path.file_name()
                                .and_then(|name| name.to_str())
                                .unwrap_or("El archivo")
                        ),
                    )
                })
            });
        if original.is_ok() {
            return original;
        }
        for candidate in Self::backup_candidates(path) {
            if let Ok(file) = File::open(&candidate) {
                if let Ok(value) = serde_json::from_reader(BufReader::new(file)) {
                    return Ok(value);
                }
            }
        }
        original
    }

    fn backup_candidates(path: &Path) -> Vec<PathBuf> {
        let Some(parent) = path.parent() else {
            return Vec::new();
        };
        let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
            return Vec::new();
        };
        let prefix = format!(".{name}.");
        let mut candidates: Vec<_> = fs::read_dir(parent)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let file_name = entry.file_name();
                let file_name = file_name.to_str()?;
                if !file_name.starts_with(&prefix) || !file_name.ends_with(".bak") {
                    return None;
                }
                let modified = entry.metadata().ok()?.modified().ok()?;
                Some((entry.path(), modified))
            })
            .collect();
        candidates.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
        candidates.into_iter().map(|(path, _)| path).collect()
    }
}

#[tauri::command]
pub fn initialize_project_storage(
    app: AppHandle,
) -> Result<ProjectStorageInfo, ProjectStorageError> {
    ProjectStorage::from_app(&app)?.initialize()
}

#[tauri::command]
pub fn project_manifest_exists(
    app: AppHandle,
    project_id: String,
) -> Result<bool, ProjectStorageError> {
    ProjectStorage::from_app(&app)?.manifest_exists(&project_id)
}

#[tauri::command]
pub fn initialize_project_manifest(
    app: AppHandle,
    request: InitializeProjectRequest,
) -> Result<ProjectBundle, ProjectStorageError> {
    ProjectStorage::from_app(&app)?.initialize_project(request)
}

#[tauri::command]
pub fn load_project_bundle(
    app: AppHandle,
    project_id: String,
) -> Result<ProjectBundle, ProjectStorageError> {
    ProjectStorage::from_app(&app)?.load_project(&project_id)
}

#[tauri::command]
pub fn save_project_manifest(
    app: AppHandle,
    manifest: ProjectManifest,
) -> Result<ProjectManifest, ProjectStorageError> {
    ProjectStorage::from_app(&app)?.save_project(manifest)
}

#[tauri::command]
pub fn save_project_edl(
    app: AppHandle,
    edl: EdlManifest,
) -> Result<EdlManifest, ProjectStorageError> {
    ProjectStorage::from_app(&app)?.save_edl(edl)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReanalysisPlan {
    project_id: String,
    edl_revision: String,
    automatic_camera_count: usize,
    preserved_camera_count: usize,
    legacy_unclassified_camera_count: usize,
    smart_cut_document_present: bool,
    smart_camera_document_present: bool,
}

fn smart_camera_suggestion_ids(path: &Path) -> HashSet<String> {
    let Ok(bytes) = fs::read(path) else {
        return HashSet::new();
    };
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return HashSet::new();
    };
    json.get("suggestions")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter_map(|value| {
            value
                .get("id")
                .and_then(|id| id.as_str())
                .map(str::to_owned)
        })
        .collect()
}

fn matches_legacy_smart_camera_id(item: &CameraDecision) -> bool {
    let kind = match item.mode.as_str() {
        "zoom" => "Zoom",
        "focus" => "Focus",
        "reset" => "Reset",
        _ => return false,
    };
    let id = Uuid::new_v5(
        &Uuid::NAMESPACE_OID,
        format!("smart-camera:{kind}:{}:{}", item.start_us, item.end_us).as_bytes(),
    )
    .to_string();
    item.id == id || item.id.starts_with(&format!("{id}-trim-"))
}

fn is_automatic_camera(item: &CameraDecision, suggestion_ids: &HashSet<String>) -> bool {
    match item.automation.as_ref() {
        Some(meta) if meta.origin == "manual" => false,
        Some(meta) => meta.origin == "automatic" && meta.detector == "smart_camera",
        None => {
            suggestion_ids
                .iter()
                .any(|id| item.id == *id || item.id.starts_with(&format!("{id}-trim-")))
                || matches_legacy_smart_camera_id(item)
        }
    }
}

fn reanalysis_plan_for(bundle: &ProjectBundle, dir: &Path) -> ReanalysisPlan {
    let ids = smart_camera_suggestion_ids(&dir.join("smart_camera.json"));
    let automatic_camera_count = bundle
        .edl
        .tracks
        .camera
        .iter()
        .filter(|item| is_automatic_camera(item, &ids))
        .count();
    let legacy_unclassified_camera_count = bundle
        .edl
        .tracks
        .camera
        .iter()
        .filter(|item| item.automation.is_none() && !is_automatic_camera(item, &ids))
        .count();
    ReanalysisPlan {
        project_id: bundle.project.project_id.clone(),
        edl_revision: bundle.edl.updated_at.clone(),
        automatic_camera_count,
        preserved_camera_count: bundle.edl.tracks.camera.len() - automatic_camera_count,
        legacy_unclassified_camera_count,
        smart_cut_document_present: dir.join("smart_cut.json").is_file(),
        smart_camera_document_present: dir.join("smart_camera.json").is_file(),
    }
}

#[tauri::command]
pub fn preview_reanalysis_cleanup(
    app: AppHandle,
    project_id: String,
) -> Result<ReanalysisPlan, ProjectStorageError> {
    let storage = ProjectStorage::from_app(&app)?;
    let bundle = storage.load_project(&project_id)?;
    let dir = storage.project_dir(&project_id)?;
    Ok(reanalysis_plan_for(&bundle, &dir))
}

#[tauri::command]
pub fn apply_reanalysis_cleanup(
    app: AppHandle,
    project_id: String,
    expected_revision: String,
) -> Result<ReanalysisPlan, ProjectStorageError> {
    let storage = ProjectStorage::from_app(&app)?;
    let mut bundle = storage.load_project(&project_id)?;
    if bundle.edl.updated_at != expected_revision {
        return Err(ProjectStorageError::new(
            "edl-stale",
            "El EDL cambió; revisa el plan antes de reanalizar.",
        ));
    }
    let dir = storage.project_dir(&project_id)?;
    let plan = reanalysis_plan_for(&bundle, &dir);
    let ids = smart_camera_suggestion_ids(&dir.join("smart_camera.json"));
    storage.write_json(
        &dir.join(format!("edl.pre-reanalysis.{}.json", Uuid::new_v4())),
        &bundle.edl,
    )?;
    bundle
        .edl
        .tracks
        .camera
        .retain(|item| !is_automatic_camera(item, &ids));
    let next = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    bundle.edl.updated_at = if next <= expected_revision {
        (chrono::DateTime::parse_from_rfc3339(&expected_revision)
            .map_err(|_| ProjectStorageError::new("edl-revision", "Revisión EDL inválida"))?
            + chrono::Duration::milliseconds(1))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    } else {
        next
    };
    storage.save_edl(bundle.edl)?;
    for file in ["smart_cut.json", "smart_camera.json"] {
        let path = dir.join(file);
        if path.exists() {
            fs::remove_file(path).map_err(|error| {
                ProjectStorageError::new(
                    "cleanup-failed",
                    format!("No se pudo invalidar {file}: {error}"),
                )
            })?;
        }
    }
    Ok(plan)
}

#[tauri::command]
pub fn update_project_source(
    app: AppHandle,
    bundle: ProjectBundle,
) -> Result<ProjectBundle, ProjectStorageError> {
    ProjectStorage::from_app(&app)?.update_source(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_request(project_id: &str, source_id: &str, name: &str) -> InitializeProjectRequest {
        let timestamp = "2026-09-23T12:00:00.000Z".to_owned();
        InitializeProjectRequest {
            project: ProjectManifest {
                schema_version: 1,
                project_id: project_id.to_owned(),
                name: name.to_owned(),
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                source: ProjectSourceReference {
                    source_id: source_id.to_owned(),
                    file_name: "video real.mp4".into(),
                    original_path: "D:\\Videos\\video real.mp4".into(),
                    source_json: SOURCE_FILE.into(),
                },
                edl: EdlReference {
                    schema_version: 1,
                    file: EDL_FILE.into(),
                },
                workflow: WorkflowStatus {
                    ingest: WorkflowState::Completed,
                    scene_analysis: WorkflowState::NotStarted,
                    smart_cut: WorkflowState::NotStarted,
                    smart_camera: WorkflowState::NotStarted,
                    broll: WorkflowState::NotStarted,
                    render: WorkflowState::NotStarted,
                },
            },
            source: SourceManifest {
                schema_version: 1,
                source_id: source_id.to_owned(),
                path: "D:\\Videos\\video real.mp4".into(),
                file_name: "video real.mp4".into(),
                extension: ".mp4".into(),
                file_size_bytes: 58_618_520,
                modified_at: Some(timestamp.clone()),
                duration_us: Some(58_000_123),
                container: ContainerSnapshot {
                    display_name: "MP4".into(),
                    raw_name: Some("mov,mp4".into()),
                },
                video: SourceVideoSnapshot {
                    codec: Some("h264".into()),
                    codec_long_name: Some("H.264 / AVC".into()),
                    width: Some(1920),
                    height: Some(1080),
                    display_width: Some(1920),
                    display_height: Some(1080),
                    fps: FpsSnapshot {
                        numerator: Some(30),
                        denominator: Some(1),
                        decimal: Some(30.0),
                    },
                    pixel_format: Some("yuv420p".into()),
                    bit_rate: Some(7_950_853),
                    rotation: 0,
                    display_aspect_ratio: Some("16:9".into()),
                },
                audio: SourceAudioSnapshot {
                    present: true,
                    codec: Some("aac".into()),
                    codec_long_name: Some("AAC".into()),
                    sample_rate: Some(44_100),
                    channels: Some(2),
                    channel_layout: Some("stereo".into()),
                    bit_rate: Some(127_449),
                },
                streams: StreamCounts {
                    total: 2,
                    video: 1,
                    audio: 1,
                    data: 0,
                    other: 0,
                },
            },
            edl: EdlManifest {
                manual_trim: None,
                manual_split_points_us: Vec::new(),
                audio_on_timeline: None,
                automation: None,
                schema_version: 1,
                project_id: project_id.to_owned(),
                source_id: source_id.to_owned(),
                timebase: EdlTimebase {
                    unit: "microseconds".into(),
                },
                source_duration_us: Some(58_000_123),
                source_on_timeline: None,
                tracks: EdlTracks {
                    cuts: vec![],
                    camera: vec![],
                    broll: vec![],
                    audio: vec![],
                    assets: vec![],
                    titles: vec![],
                    transitions: vec![],
                },
                output: EdlOutput {
                    aspect_ratio_mode: "source".into(),
                    resolution_mode: "source".into(),
                    fps_mode: "source".into(),
                },
                updated_at: timestamp,
            },
        }
    }

    fn fixture() -> (TempDir, ProjectStorage, String, String) {
        let temp = tempfile::tempdir().expect("temp dir");
        let storage = ProjectStorage::new(temp.path().join("projects"));
        (
            temp,
            storage,
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
        )
    }

    #[test]
    fn accepts_valid_project_id() {
        assert!(ProjectStorage::validate_id(&Uuid::new_v4().to_string(), "projectId").is_ok());
    }

    #[test]
    fn rejects_forward_path_traversal() {
        assert_eq!(
            ProjectStorage::validate_id("../project", "projectId")
                .unwrap_err()
                .code,
            "invalid-project-id"
        );
    }

    #[test]
    fn rejects_backward_path_traversal() {
        assert_eq!(
            ProjectStorage::validate_id("..\\project", "projectId")
                .unwrap_err()
                .code,
            "invalid-project-id"
        );
    }

    #[test]
    fn rejects_absolute_path_as_project_id() {
        assert_eq!(
            ProjectStorage::validate_id("C:\\projects\\one", "projectId")
                .unwrap_err()
                .code,
            "invalid-project-id"
        );
    }

    #[test]
    fn creates_project_json() {
        let (_temp, storage, project_id, source_id) = fixture();
        storage
            .initialize_project(sample_request(&project_id, &source_id, "Proyecto"))
            .unwrap();
        assert!(storage
            .project_dir(&project_id)
            .unwrap()
            .join(PROJECT_FILE)
            .is_file());
    }

    #[test]
    fn creates_source_json() {
        let (_temp, storage, project_id, source_id) = fixture();
        storage
            .initialize_project(sample_request(&project_id, &source_id, "Proyecto"))
            .unwrap();
        assert!(storage
            .project_dir(&project_id)
            .unwrap()
            .join(SOURCE_FILE)
            .is_file());
    }

    #[test]
    fn creates_edl_json() {
        let (_temp, storage, project_id, source_id) = fixture();
        storage
            .initialize_project(sample_request(&project_id, &source_id, "Proyecto"))
            .unwrap();
        assert!(storage
            .project_dir(&project_id)
            .unwrap()
            .join(EDL_FILE)
            .is_file());
    }

    #[test]
    fn reads_bundle_after_write() {
        let (_temp, storage, project_id, source_id) = fixture();
        let created = storage
            .initialize_project(sample_request(&project_id, &source_id, "Proyecto"))
            .unwrap();
        assert_eq!(storage.load_project(&project_id).unwrap(), created);
    }

    #[test]
    fn preserves_schema_versions() {
        let (_temp, storage, project_id, source_id) = fixture();
        let bundle = storage
            .initialize_project(sample_request(&project_id, &source_id, "Proyecto"))
            .unwrap();
        assert_eq!(
            (
                bundle.project.schema_version,
                bundle.source.schema_version,
                bundle.edl.schema_version
            ),
            (1, 1, 1)
        );
    }

    #[test]
    fn creates_empty_edl() {
        let (_temp, storage, project_id, source_id) = fixture();
        let bundle = storage
            .initialize_project(sample_request(&project_id, &source_id, "Proyecto"))
            .unwrap();
        assert!(bundle.edl.tracks.is_empty());
    }

    #[test]
    fn preserves_duration_microseconds() {
        let (_temp, storage, project_id, source_id) = fixture();
        let bundle = storage
            .initialize_project(sample_request(&project_id, &source_id, "Proyecto"))
            .unwrap();
        assert_eq!(bundle.source.duration_us, Some(58_000_123));
        assert_eq!(bundle.edl.source_duration_us, Some(58_000_123));
    }

    #[test]
    fn preserves_unicode_project_name() {
        let (_temp, storage, project_id, source_id) = fixture();
        storage
            .initialize_project(sample_request(
                &project_id,
                &source_id,
                "Edición — programación 🎬",
            ))
            .unwrap();
        assert_eq!(
            storage.load_project(&project_id).unwrap().project.name,
            "Edición — programación 🎬"
        );
    }

    #[test]
    fn corrupt_json_returns_controlled_error() {
        let (_temp, storage, project_id, source_id) = fixture();
        storage
            .initialize_project(sample_request(&project_id, &source_id, "Proyecto"))
            .unwrap();
        fs::write(
            storage.project_dir(&project_id).unwrap().join(PROJECT_FILE),
            b"{invalid",
        )
        .unwrap();
        assert_eq!(
            storage.load_project(&project_id).unwrap_err().code,
            "corrupt-json"
        );
    }

    #[test]
    fn reanalysis_identifies_legacy_auto_camera_and_preserves_manual_work() {
        let (_temp, storage, project_id, source_id) = fixture();
        let mut bundle = storage
            .initialize_project(sample_request(&project_id, &source_id, "Proyecto"))
            .unwrap();
        let make = |id: &str, automation: Option<DecisionAutomation>| CameraDecision {
            id: id.into(),
            start_us: 1_000_000,
            end_us: 2_000_000,
            mode: "zoom".into(),
            zoom: Some(1.2),
            center_x: Some(0.5),
            center_y: Some(0.5),
            easing: None,
            reason: None,
            confidence: None,
            transition_us: None,
            automation,
        };
        let manual = DecisionAutomation {
            key: "manual".into(),
            detector: "smart_camera".into(),
            detector_version: "old".into(),
            rule_version: None,
            origin: "manual".into(),
            confidence: None,
            manual_action: Some("modified".into()),
        };
        bundle.edl.tracks.camera = vec![
            make("legacy-auto", None),
            make("manual", Some(manual)),
            make("unknown", None),
        ];
        bundle.edl.tracks.titles.push(
            serde_json::from_value(serde_json::json!({
                "id":"title","presetId":"lower-third","text":"Manual","secondaryText":"",
                "startUs":0,"endUs":2000000,"positionX":0.5,"positionY":0.8,
                "anchor":"center","scale":1,"font":"Inter","fontWeight":700,"fontSize":48,
                "color":"#FFFFFF","accentColor":"#34D5E5","alignment":"left","tracking":0,
                "lineHeight":1.1,"opacity":1,"safeArea":0.06,"animationInUs":0,"animationOutUs":0,
                "easing":"linear","background":false
            }))
            .unwrap(),
        );
        let dir = storage.project_dir(&project_id).unwrap();
        fs::write(
            dir.join("smart_camera.json"),
            r#"{"suggestions":[{"id":"legacy-auto"},{"id":"manual"}]}"#,
        )
        .unwrap();
        let plan = reanalysis_plan_for(&bundle, &dir);
        assert_eq!(plan.automatic_camera_count, 1);
        assert_eq!(plan.preserved_camera_count, 2);
        assert_eq!(plan.legacy_unclassified_camera_count, 1);
        let ids = smart_camera_suggestion_ids(&dir.join("smart_camera.json"));
        bundle
            .edl
            .tracks
            .camera
            .retain(|item| !is_automatic_camera(item, &ids));
        assert_eq!(
            bundle
                .edl
                .tracks
                .camera
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["manual", "unknown"]
        );
        assert_eq!(bundle.edl.tracks.titles[0].text, "Manual");
        let generated_id =
            Uuid::new_v5(&Uuid::NAMESPACE_OID, b"smart-camera:Zoom:1000000:2000000").to_string();
        assert!(matches_legacy_smart_camera_id(&make(&generated_id, None)));
        assert!(!matches_legacy_smart_camera_id(&make("user-camera", None)));
    }
}
