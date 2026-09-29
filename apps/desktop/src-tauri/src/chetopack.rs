//! Local, data-only CHETO template packages. Archive entries are validated before any write.
use crate::project_storage::{AssetDecision, EdlManifest};
use crate::template_engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
};
use tauri::Manager;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_ARCHIVE: u64 = 128 * 1024 * 1024;
const MAX_ENTRY: u64 = 32 * 1024 * 1024;
const MAX_TOTAL: u64 = 128 * 1024 * 1024;
const MAX_FILES: usize = 256;
const MAX_JSON: u64 = 1024 * 1024;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackTemplateRef {
    pub path: String,
    pub template_id: String,
    pub template_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackManifest {
    pub schema_version: u32,
    pub pack_id: String,
    pub pack_version: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub created_at: String,
    pub minimum_cheto_version: String,
    #[serde(default)]
    pub maximum_cheto_version: Option<String>,
    pub templates: Vec<PackTemplateRef>,
    #[serde(default)]
    pub asset_refs: Vec<String>,
    #[serde(default)]
    pub font_refs: Vec<String>,
    #[serde(default)]
    pub preview_refs: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    pub license_summary: String,
    pub checksum_algorithm: String,
    pub provenance: String,
    #[serde(default)]
    pub requires_builtins: Vec<String>,
    #[serde(default)]
    pub signature: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LicenseEntry {
    pub resource_id: String,
    pub resource_type: String,
    pub name: String,
    pub license_id: String,
    #[serde(default)]
    pub license_text_ref: Option<String>,
    pub source: String,
    pub author: String,
    #[serde(default)]
    pub copyright: String,
    pub redistribution_allowed: bool,
    #[serde(default)]
    pub modified: bool,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPack {
    pub pack_id: String,
    pub pack_version: String,
    pub name: String,
    pub author: String,
    pub installed_at: String,
    pub source: String,
    pub install_path: String,
    pub templates: Vec<PackTemplateRef>,
    pub archive_sha256: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackInspection {
    pub manifest: PackManifest,
    pub templates: Vec<Value>,
    pub licenses: Vec<LicenseEntry>,
    pub size_bytes: u64,
    pub archive_sha256: String,
    pub status: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportResource {
    pub path: String,
    pub source_path: String,
    pub license: LicenseEntry,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportPackRequest {
    pub pack_id: String,
    pub pack_version: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub output_path: String,
    pub templates: Vec<Value>,
    #[serde(default)]
    pub resources: Vec<ExportResource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedPackResource {
    pub resource_id: String,
    pub kind: String,
    pub path: String,
    pub sha256: String,
    pub license_id: String,
    pub license_source: String,
    pub license_author: String,
    pub license_name: String,
    pub license_text_ref: Option<String>,
    pub resource_type: String,
    pub license_text_path: Option<String>,
}

pub(crate) fn parse_resource_id(id: &str) -> Result<(&str, &str, &str), String> {
    let body = id.strip_prefix("pack:").ok_or("ID de recurso inválido")?;
    let (identity, relative) = body.split_once(':').ok_or("ID de recurso inválido")?;
    let (pack_id, version) = identity.split_once('@').ok_or("ID de recurso inválido")?;
    validate_pack_id(pack_id)?;
    semver(version)?;
    safe_path(relative)?;
    if !relative.starts_with("fonts/")
        && !relative.starts_with("assets/")
        && !relative.starts_with("previews/")
    {
        return Err("Tipo de recurso no permitido".into());
    }
    Ok((pack_id, version, relative))
}

#[cfg(test)]
fn resource_id(pack_id: &str, version: &str, relative: &str) -> String {
    format!("pack:{pack_id}@{version}:{relative}")
}

fn resolve_resource_at(root: &Path, id: &str) -> Result<ResolvedPackResource, String> {
    let (pack_id, version, relative) = parse_resource_id(id)?;
    if !read_index(root)?
        .iter()
        .any(|pack| pack.pack_id == pack_id && pack.pack_version == version)
    {
        return Err("Recurso no disponible: el paquete no está instalado".into());
    }
    let directory = root.join("packs").join(pack_id).join(version);
    let manifest_bytes = fs::read(directory.join("manifest.json"))
        .map_err(|_| "Manifest instalado no disponible")?;
    if manifest_bytes.len() as u64 > MAX_JSON {
        return Err("Manifest instalado demasiado grande".into());
    }
    let manifest: PackManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| "Manifest instalado corrupto")?;
    if manifest.pack_id != pack_id || manifest.pack_version != version {
        return Err("Identidad instalada inconsistente".into());
    }
    let kind = if manifest.font_refs.iter().any(|path| path == relative) {
        "font"
    } else if manifest.asset_refs.iter().any(|path| path == relative) {
        "asset"
    } else if manifest.preview_refs.iter().any(|path| path == relative) {
        "preview"
    } else {
        return Err("Recurso no declarado por el paquete".into());
    };
    let licenses: Vec<LicenseEntry> = serde_json::from_slice(
        &fs::read(directory.join("licenses/LICENSES.json"))
            .map_err(|_| "Licencias instaladas no disponibles")?,
    )
    .map_err(|_| "Licencias instaladas corruptas")?;
    let license = licenses
        .iter()
        .find(|item| item.resource_id == relative)
        .ok_or("Licencia de recurso ausente")?;
    let license_text_path = license
        .license_text_ref
        .as_ref()
        .map(|text| directory.join(text.replace('/', std::path::MAIN_SEPARATOR_STR)))
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned());
    let checksums_bytes = fs::read(directory.join("checksums.json"))
        .map_err(|_| "Checksums instalados no disponibles")?;
    if checksums_bytes.len() as u64 > MAX_JSON {
        return Err("Checksums instalados demasiado grandes".into());
    }
    let checksums: BTreeMap<String, String> =
        serde_json::from_slice(&checksums_bytes).map_err(|_| "Checksums instalados corruptos")?;
    let expected = checksums
        .get(relative)
        .ok_or("Checksum de recurso ausente")?;
    let path = directory.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    let metadata = fs::symlink_metadata(&path).map_err(|_| "Recurso instalado faltante")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_ENTRY {
        return Err("Recurso instalado inválido".into());
    }
    let canonical_root = fs::canonicalize(&directory).map_err(|e| e.to_string())?;
    let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canonical.starts_with(canonical_root) {
        return Err("Ruta de recurso insegura".into());
    }
    let bytes = read_bounded(
        &mut File::open(&canonical).map_err(|e| e.to_string())?,
        MAX_ENTRY,
    )?;
    if sha(&bytes) != *expected || !valid_resource_bytes(relative, &bytes) {
        return Err("CHETOPACK_CHECKSUM_FAILED: recurso instalado modificado".into());
    }
    Ok(ResolvedPackResource {
        resource_id: id.into(),
        kind: kind.into(),
        path: canonical.to_string_lossy().into_owned(),
        sha256: expected.clone(),
        license_id: license.license_id.clone(),
        license_source: license.source.clone(),
        license_author: license.author.clone(),
        license_name: license.name.clone(),
        license_text_ref: license.license_text_ref.clone(),
        resource_type: license.resource_type.clone(),
        license_text_path,
    })
}

pub(crate) fn resolve_resource(
    app: &tauri::AppHandle,
    id: &str,
) -> Result<ResolvedPackResource, String> {
    resolve_resource_at(&root(app)?, id)
}

fn image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
        ])
        .arg(path)
        .output()
        .map_err(|e| io_error("ffprobe no disponible para asset", e))?;
    if !output.status.success() {
        return Err("No se pudieron leer dimensiones del asset".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let (width, height) = text
        .trim()
        .split_once('x')
        .ok_or("Dimensiones de asset inválidas")?;
    let width: u32 = width.parse().map_err(|_| "Ancho de asset inválido")?;
    let height: u32 = height.parse().map_err(|_| "Alto de asset inválido")?;
    if width == 0 || height == 0 {
        return Err("Dimensiones de asset inválidas".into());
    }
    Ok((width, height))
}

pub(crate) fn prepare_render_edl(
    app: &tauri::AppHandle,
    edl: &EdlManifest,
    canvas_width: u32,
) -> Result<EdlManifest, String> {
    let mut prepared = edl.clone();
    for title in &mut prepared.tracks.titles {
        let Some(snapshot) = title.template_snapshot.as_ref() else {
            continue;
        };
        let font_id = if title.font.starts_with("pack:") {
            Some(title.font.as_str())
        } else {
            snapshot["fontRefs"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .find(|id| id.starts_with("pack:"))
        };
        if let Some(id) = font_id {
            let resource = resolve_resource(app, id)?;
            if resource.kind != "font" {
                return Err("ID no corresponde a una fuente".into());
            }
            let extension = Path::new(&resource.path)
                .extension()
                .and_then(|value| value.to_str())
                .ok_or("Extensión de fuente inválida")?;
            let filename = format!("pack-font-{}.{}", resource.sha256, extension);
            let folder = std::env::temp_dir().join("cheto-visual-13d");
            fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let target = folder.join(&filename);
            if !target.is_file()
                || fs::metadata(&target).map(|info| info.len()).unwrap_or(0)
                    != fs::metadata(&resource.path)
                        .map(|info| info.len())
                        .unwrap_or(0)
            {
                fs::copy(&resource.path, &target)
                    .map_err(|e| io_error("No se pudo preparar fuente del paquete", e))?;
            }
            title.font = filename;
        }
        if let Some(graphic) = snapshot.get("graphicLayer").filter(|item| item.is_object()) {
            let id = graphic["assetId"].as_str().ok_or("Asset gráfico sin ID")?;
            let resource = resolve_resource(app, id)?;
            if resource.kind != "asset" {
                return Err("ID no corresponde a un gráfico".into());
            }
            let (image_width, _) = image_dimensions(Path::new(&resource.path))?;
            let width = graphic["width"]
                .as_f64()
                .ok_or("Ancho de gráfico inválido")?
                .clamp(0.02, 1.0);
            let scale = (canvas_width as f64 * width / image_width as f64).clamp(0.05, 4.0);
            let overlay: AssetDecision = serde_json::from_value(serde_json::json!({
                "id": format!("pack-graphic-{}", title.id), "assetId": id, "assetPath": resource.path,
                "sourceDurationUs": title.end_us.saturating_sub(title.start_us), "kind": "overlay",
                "startUs": title.start_us, "endUs": title.end_us, "gainDb": 0.0, "fadeInUs": 0,
                "fadeOutUs": 0, "loop": false, "ducking": false, "duckDb": 0.0,
                "attackMs": 0, "releaseMs": 0,
                "positionX": graphic["positionX"], "positionY": graphic["positionY"],
                "scale": scale, "opacity": 1.0, "muted": false
            })).map_err(|e| io_error("Capa gráfica inválida", e))?;
            prepared.tracks.assets.push(overlay);
        }
    }
    Ok(prepared)
}

#[tauri::command]
pub(crate) fn resolve_chetopack_resource(
    app: tauri::AppHandle,
    resource_id: String,
) -> Result<ResolvedPackResource, String> {
    let resolved = resolve_resource(&app, &resource_id)?;
    app.asset_protocol_scope()
        .allow_file(Path::new(&resolved.path))
        .map_err(|e| io_error("Recurso local no autorizado", e))?;
    Ok(resolved)
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn io_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}
fn semver(text: &str) -> Result<[u64; 3], String> {
    let parts = text.split('.').collect::<Vec<_>>();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || !part.bytes().all(|c| c.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
        })
    {
        return Err("versión SemVer inválida".into());
    }
    Ok([
        parts[0].parse().map_err(|_| "versión inválida")?,
        parts[1].parse().map_err(|_| "versión inválida")?,
        parts[2].parse().map_err(|_| "versión inválida")?,
    ])
}
fn validate_pack_id(id: &str) -> Result<(), String> {
    if id.len() < 6
        || id.len() > 120
        || !id.starts_with(|c: char| c.is_ascii_lowercase())
        || id.contains("..")
        || !id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
    {
        return Err("packId inválido".into());
    }
    Ok(())
}
fn safe_path(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 240
        || name.contains('\\')
        || name.starts_with('/')
        || name.contains(':')
        || name.contains('\0')
        || name
            .chars()
            .any(|c| c.is_control() || "<>\"|?*".contains(c))
    {
        return Err("ruta insegura en paquete".into());
    }
    let parts: Vec<_> = name.split('/').collect();
    if parts.len() > 6
        || parts.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || part.ends_with([' ', '.'])
                || part.len() > 100
        })
    {
        return Err("ruta insegura en paquete".into());
    }
    for part in &parts {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.as_bytes()[3].is_ascii_digit()
                && stem.as_bytes()[3] != b'0')
        {
            return Err("nombre reservado de Windows".into());
        }
    }
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let allowed = name == "manifest.json"
        || name == "checksums.json"
        || name == "licenses/LICENSES.json"
        || (parts[0] == "templates" && parts.len() == 2 && extension == "json")
        || (parts[0] == "assets"
            && parts.len() >= 3
            && ["images", "overlays", "other"].contains(&parts[1])
            && ["png", "jpg", "jpeg", "webp", "gif"].contains(&extension.as_str()))
        || (parts[0] == "fonts"
            && parts.len() == 2
            && ["ttf", "otf"].contains(&extension.as_str()))
        || (parts[0] == "previews"
            && parts.len() == 2
            && ["png", "jpg", "jpeg", "webp", "gif"].contains(&extension.as_str()))
        || (parts[0] == "licenses"
            && parts.len() == 2
            && ["txt", "md"].contains(&extension.as_str()));
    if !allowed {
        return Err("tipo de archivo no permitido".into());
    }
    Ok(())
}
fn valid_resource_bytes(path: &str, bytes: &[u8]) -> bool {
    let extension = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "ttf" => bytes.starts_with(b"\x00\x01\x00\x00"),
        "otf" => bytes.starts_with(b"OTTO"),
        _ => true,
    }
}
fn validate_manifest(manifest: &PackManifest) -> Result<(), String> {
    if manifest.schema_version != 1 || manifest.checksum_algorithm != "SHA-256" {
        return Err("schema o checksum incompatible".into());
    }
    validate_pack_id(&manifest.pack_id)?;
    semver(&manifest.pack_version)?;
    if semver(&manifest.minimum_cheto_version)? > semver(APP_VERSION)?
        || manifest
            .maximum_cheto_version
            .as_deref()
            .map(semver)
            .transpose()?
            .is_some_and(|max| max < semver(APP_VERSION).unwrap())
    {
        return Err(format!(
            "Este paquete requiere otra versión de CHETO (actual {APP_VERSION})."
        ));
    }
    if manifest.name.trim().is_empty()
        || manifest.name.len() > 120
        || manifest.author.trim().is_empty()
        || manifest.author.len() > 120
        || manifest.description.len() > 2000
        || manifest.templates.is_empty()
        || manifest.templates.len() > 64
    {
        return Err("metadata de paquete incompleta".into());
    }
    let mut identities = HashSet::new();
    for item in &manifest.templates {
        safe_path(&item.path)?;
        if !item.path.starts_with("templates/")
            || !identities.insert(format!("{}@{}", item.template_id, item.template_version))
        {
            return Err("template duplicado o ruta inválida".into());
        }
    }
    for (paths, prefix) in [
        (&manifest.asset_refs, "assets/"),
        (&manifest.font_refs, "fonts/"),
        (&manifest.preview_refs, "previews/"),
    ] {
        for path in paths {
            safe_path(path)?;
            if !path.starts_with(prefix) {
                return Err("Referencia en carpeta incorrecta".into());
            }
        }
    }
    let mut declared = HashSet::new();
    for path in manifest
        .templates
        .iter()
        .map(|item| &item.path)
        .chain(&manifest.asset_refs)
        .chain(&manifest.font_refs)
        .chain(&manifest.preview_refs)
    {
        if !declared.insert(path.to_lowercase()) {
            return Err("Recurso declarado más de una vez".into());
        }
    }
    if manifest.requires_builtins.iter().any(|item| {
        !matches!(item.as_str(), "font:inter" | "font:instrument-serif")
            && !item.strip_prefix("primitive:").is_some_and(|primitive| {
                [
                    "opacity",
                    "translateX",
                    "translateY",
                    "scale",
                    "clipReveal",
                    "underline",
                    "highlight",
                    "glow",
                    "stroke",
                    "staggerWords",
                    "staggerCharacters",
                    "wordPop",
                    "counter",
                    "backgroundPanel",
                    "accentBar",
                ]
                .contains(&primitive)
            })
    }) {
        return Err("Dependencia built-in desconocida".into());
    }
    Ok(())
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| io_error("Carpeta local no disponible", e))?
        .join("chetopacks"))
}
fn installed_index(root: &Path) -> PathBuf {
    root.join("installed.json")
}
fn read_index(root: &Path) -> Result<Vec<InstalledPack>, String> {
    let path = installed_index(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path).map_err(|e| io_error("No se pudo leer la biblioteca", e))?;
    if bytes.len() > 1024 * 1024 {
        return Err("índice de paquetes demasiado grande".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| io_error("Biblioteca de paquetes dañada", e))
}
fn write_index(root: &Path, index: &[InstalledPack]) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| io_error("No se pudo preparar la biblioteca", e))?;
    let pending = root.join(format!("installed-{}.pending", Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(index).map_err(|e| e.to_string())?;
    fs::write(&pending, bytes).map_err(|e| io_error("No se pudo guardar el índice", e))?;
    fs::rename(&pending, installed_index(root))
        .map_err(|e| io_error("No se pudo publicar el índice", e))
}

fn read_bounded<R: Read>(reader: &mut R, max: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error("Lectura de paquete fallida", e))?;
    if bytes.len() as u64 > max {
        return Err("archivo del paquete demasiado grande".into());
    }
    Ok(bytes)
}

fn validate_archive(
    path: &Path,
) -> Result<
    (
        PackManifest,
        Vec<Value>,
        Vec<LicenseEntry>,
        BTreeMap<String, String>,
        String,
        u64,
    ),
    String,
> {
    if path
        .extension()
        .and_then(|v| v.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("chetopack"))
    {
        return Err("Selecciona un archivo .chetopack".into());
    }
    let size = fs::metadata(path)
        .map_err(|e| io_error("No se pudo abrir el paquete", e))?
        .len();
    if size > MAX_ARCHIVE {
        return Err("paquete demasiado grande".into());
    }
    let archive_hash = sha(&fs::read(path).map_err(|e| io_error("No se pudo leer el paquete", e))?);
    let file = File::open(path).map_err(|e| io_error("No se pudo abrir el paquete", e))?;
    let mut archive =
        ZipArchive::new(file).map_err(|_| "El archivo está dañado o incompleto.".to_string())?;
    if archive.len() > MAX_FILES {
        return Err("demasiados archivos en el paquete".into());
    }
    let mut names = HashSet::new();
    let mut bytes_by_path = BTreeMap::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "Entrada ZIP ilegible".to_string())?;
        let name = entry.name().to_string();
        safe_path(&name)?;
        if entry.is_dir()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Enlaces o carpetas ZIP no permitidos".into());
        }
        if !names.insert(name.to_lowercase()) {
            return Err("Colisión de nombres en Windows".into());
        }
        let max = if name.ends_with(".json") {
            MAX_JSON
        } else {
            MAX_ENTRY
        };
        if entry.size() > max
            || entry.compressed_size() > MAX_ENTRY
            || entry.size()
                > entry
                    .compressed_size()
                    .saturating_mul(200)
                    .saturating_add(1024 * 1024)
        {
            return Err("Límite de descompresión excedido".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Tamaño descomprimido inválido")?;
        if total > MAX_TOTAL {
            return Err("Paquete descomprimido demasiado grande".into());
        }
        bytes_by_path.insert(name, read_bounded(&mut entry, max)?);
    }
    if bytes_by_path
        .iter()
        .any(|(path, bytes)| !valid_resource_bytes(path, bytes))
    {
        return Err("Contenido de asset o fuente inválido".into());
    }
    let manifest_bytes = bytes_by_path
        .get("manifest.json")
        .ok_or("Falta manifest.json")?;
    let manifest: PackManifest =
        serde_json::from_slice(manifest_bytes).map_err(|_| "manifest.json inválido".to_string())?;
    validate_manifest(&manifest)?;
    let checksum_bytes = bytes_by_path
        .get("checksums.json")
        .ok_or("Falta checksums.json")?;
    let checksums: BTreeMap<String, String> = serde_json::from_slice(checksum_bytes)
        .map_err(|_| "checksums.json inválido".to_string())?;
    if checksums.len() + 1 != bytes_by_path.len()
        || checksums.iter().any(|(name, expected)| {
            name == "checksums.json"
                || !bytes_by_path
                    .get(name)
                    .is_some_and(|bytes| expected.len() == 64 && expected == &sha(bytes))
        })
    {
        return Err(
            "CHETOPACK_CHECKSUM_FAILED: el paquete fue modificado o está incompleto".into(),
        );
    }
    let licenses: Vec<LicenseEntry> = serde_json::from_slice(
        bytes_by_path
            .get("licenses/LICENSES.json")
            .ok_or("Falta LICENSES.json")?,
    )
    .map_err(|_| "LICENSES.json inválido".to_string())?;
    let mut licensed = HashSet::new();
    for license in &licenses {
        safe_path(&license.resource_id)?;
        if !licensed.insert(license.resource_id.to_lowercase())
            || !license.redistribution_allowed
            || license.license_id.trim().is_empty()
            || license.name.trim().is_empty()
            || license.author.trim().is_empty()
        {
            return Err("Licencia duplicada o incompleta".into());
        }
        if let Some(text) = &license.license_text_ref {
            safe_path(text)?;
            if !text.starts_with("licenses/") {
                return Err("Texto de licencia fuera de licenses/".into());
            }
        }
    }
    let declared: HashSet<&str> = manifest
        .templates
        .iter()
        .map(|item| item.path.as_str())
        .chain(manifest.asset_refs.iter().map(String::as_str))
        .chain(manifest.font_refs.iter().map(String::as_str))
        .chain(manifest.preview_refs.iter().map(String::as_str))
        .chain(
            licenses
                .iter()
                .filter_map(|item| item.license_text_ref.as_deref()),
        )
        .chain(["manifest.json", "checksums.json", "licenses/LICENSES.json"])
        .collect();
    if bytes_by_path
        .keys()
        .any(|path| !declared.contains(path.as_str()))
    {
        return Err("Archivo no declarado en el paquete".into());
    }
    for path in manifest
        .asset_refs
        .iter()
        .chain(&manifest.font_refs)
        .chain(&manifest.preview_refs)
        .chain(manifest.templates.iter().map(|item| &item.path))
    {
        if !bytes_by_path.contains_key(path) {
            return Err(format!("Recurso faltante: {path}"));
        }
        if !licenses.iter().any(|license| {
            license.resource_id == *path
                && license.redistribution_allowed
                && !license.license_id.trim().is_empty()
        }) {
            return Err(format!("Licencia ausente o no redistribuible: {path}"));
        }
    }
    for license in &licenses {
        if let Some(text) = &license.license_text_ref {
            if !bytes_by_path.contains_key(text) {
                return Err("Texto de licencia faltante".into());
            }
        }
    }
    let mut templates = Vec::new();
    for item in &manifest.templates {
        let bytes = bytes_by_path.get(&item.path).ok_or("Template faltante")?;
        let value: Value =
            serde_json::from_slice(bytes).map_err(|_| "Template JSON inválido".to_string())?;
        template_engine::validate_pack_template(&value)?;
        for font in value["fontRefs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if font == "inter" || font == "instrument-serif" {
                continue;
            }
            let (id, version, relative) = parse_resource_id(font)?;
            if id != manifest.pack_id
                || version != manifest.pack_version
                || !manifest.font_refs.iter().any(|path| path == relative)
            {
                return Err("Fuente de plantilla ausente del paquete".into());
            }
        }
        for asset in value["assetRefs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            let (id, version, relative) = parse_resource_id(asset)?;
            if id != manifest.pack_id
                || version != manifest.pack_version
                || !manifest.asset_refs.iter().any(|path| path == relative)
            {
                return Err("Asset de plantilla ausente del paquete".into());
            }
        }
        if value["templateId"] != item.template_id
            || value["templateVersion"] != item.template_version
            || !value["templateId"]
                .as_str()
                .is_some_and(|id| id.starts_with(&format!("cheto.pack.{}.", manifest.pack_id)))
        {
            return Err("Identidad de template inconsistente".into());
        }
        templates.push(value);
    }
    Ok((manifest, templates, licenses, checksums, archive_hash, size))
}

fn inspect_at(root: &Path, path: &Path) -> Result<PackInspection, String> {
    let (manifest, templates, licenses, incoming_checksums, archive_sha256, size_bytes) =
        validate_archive(path)?;
    let installed = read_index(root)?;
    let mut status = "compatible".to_string();
    let mut warnings = Vec::new();
    let latest = installed
        .iter()
        .filter(|pack| pack.pack_id == manifest.pack_id)
        .max_by_key(|pack| semver(&pack.pack_version).unwrap_or([0, 0, 0]));
    if let Some(pack) = latest {
        status = if semver(&pack.pack_version)? < semver(&manifest.pack_version)? {
            "update".into()
        } else if semver(&pack.pack_version)? > semver(&manifest.pack_version)? {
            "older".into()
        } else {
            "already_installed".into()
        };
        if status == "update" {
            warnings.push(format!(
                "Actualizar desde {} a {}",
                pack.pack_version, manifest.pack_version
            ));
        }
        if status == "older" {
            warnings.push(format!(
                "Versión instalada: {}; importada: {}",
                pack.pack_version, manifest.pack_version
            ));
        }
    }
    for pack in &installed {
        if !manifest.font_refs.is_empty() {
            let installed_dir = root
                .join("packs")
                .join(&pack.pack_id)
                .join(&pack.pack_version);
            let installed_manifest: PackManifest = serde_json::from_slice(
                &fs::read(installed_dir.join("manifest.json"))
                    .map_err(|e| io_error("Manifest instalado no disponible", e))?,
            )
            .map_err(|_| "Manifest instalado corrupto".to_string())?;
            let old_checksums: BTreeMap<String, String> = serde_json::from_slice(
                &fs::read(installed_dir.join("checksums.json"))
                    .map_err(|e| io_error("Checksums instalados no disponibles", e))?,
            )
            .map_err(|_| "Checksums instalados corruptos".to_string())?;
            for font in &manifest.font_refs {
                if installed_manifest.font_refs.contains(font)
                    && old_checksums.get(font) != incoming_checksums.get(font)
                {
                    return Err(format!(
                        "Conflicto de fuente: {font} tiene contenido distinto"
                    ));
                }
            }
        }
        if pack.pack_id == manifest.pack_id {
            if pack.pack_version == manifest.pack_version {
                if pack.archive_sha256 == archive_sha256 {
                    status = "already_installed".into();
                    warnings.push("Ya está instalado.".into());
                } else {
                    return Err("Conflicto: mismo packId y versión con contenido diferente".into());
                }
            }
            for previous in &pack.templates {
                if let Some(position) = manifest.templates.iter().position(|incoming| {
                    incoming.template_id == previous.template_id
                        && incoming.template_version == previous.template_version
                }) {
                    let installed_path = root
                        .join("packs")
                        .join(&pack.pack_id)
                        .join(&pack.pack_version)
                        .join(&previous.path);
                    let old: Value = serde_json::from_slice(
                        &fs::read(installed_path)
                            .map_err(|e| io_error("Template instalado no disponible", e))?,
                    )
                    .map_err(|_| "Template instalado corrupto".to_string())?;
                    if old != templates[position] {
                        return Err(
                            "Conflicto: mismo templateId@version con contenido diferente".into(),
                        );
                    }
                }
            }
        }
        if pack.pack_id != manifest.pack_id {
            for template in &pack.templates {
                if manifest.templates.iter().any(|incoming| {
                    incoming.template_id == template.template_id
                        && incoming.template_version == template.template_version
                }) {
                    return Err("Conflicto de templateId@version entre paquetes".into());
                }
            }
        }
    }
    Ok(PackInspection {
        manifest,
        templates,
        licenses,
        size_bytes,
        archive_sha256,
        status,
        warnings,
    })
}

#[tauri::command]
pub(crate) fn inspect_chetopack(
    app: tauri::AppHandle,
    path: String,
) -> Result<PackInspection, String> {
    inspect_at(&root(&app)?, Path::new(&path))
}

#[tauri::command]
pub(crate) fn list_chetopacks(app: tauri::AppHandle) -> Result<Vec<InstalledPack>, String> {
    read_index(&root(&app)?)
}

fn verify_at(root: &Path, pack_id: &str, pack_version: &str) -> Result<(), String> {
    validate_pack_id(pack_id)?;
    semver(pack_version)?;
    if !read_index(root)?
        .iter()
        .any(|pack| pack.pack_id == pack_id && pack.pack_version == pack_version)
    {
        return Err("Paquete no instalado".into());
    }
    let directory = root.join("packs").join(pack_id).join(pack_version);
    let bytes = fs::read(directory.join("checksums.json"))
        .map_err(|e| io_error("Checksums instalados no disponibles", e))?;
    if bytes.len() as u64 > MAX_JSON {
        return Err("Checksums instalados demasiado grandes".into());
    }
    let checksums: BTreeMap<String, String> =
        serde_json::from_slice(&bytes).map_err(|_| "Checksums instalados corruptos".to_string())?;
    let mut expected = HashSet::new();
    for (path, digest) in checksums {
        safe_path(&path)?;
        expected.insert(path.clone());
        let file = directory.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let metadata =
            fs::symlink_metadata(&file).map_err(|_| "Recurso instalado faltante".to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("Recurso instalado no es un archivo regular".into());
        }
        if !fs::canonicalize(&file)
            .map_err(|e| e.to_string())?
            .starts_with(fs::canonicalize(&directory).map_err(|e| e.to_string())?)
        {
            return Err("Recurso instalado fuera del paquete".into());
        }
        let max = if path.ends_with(".json") {
            MAX_JSON
        } else {
            MAX_ENTRY
        };
        let bytes = read_bounded(
            &mut File::open(file).map_err(|_| "Recurso instalado faltante".to_string())?,
            max,
        )?;
        if digest.len() != 64 || sha(&bytes) != digest {
            return Err("CHETOPACK_CHECKSUM_FAILED: recurso instalado modificado".into());
        }
    }
    let mut actual = HashSet::new();
    let mut folders = vec![directory.clone()];
    while let Some(folder) = folders.pop() {
        for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                return Err("Enlace inesperado en paquete instalado".into());
            }
            if kind.is_dir() {
                folders.push(entry.path());
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&directory)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            safe_path(&relative)?;
            if relative != "checksums.json" {
                actual.insert(relative);
            }
        }
    }
    if actual != expected {
        return Err("Archivos instalados incompletos o inesperados".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn verify_chetopack(
    app: tauri::AppHandle,
    pack_id: String,
    pack_version: String,
) -> Result<(), String> {
    verify_at(&root(&app)?, &pack_id, &pack_version)
}

fn install_at(root: &Path, path: &Path) -> Result<InstalledPack, String> {
    let inspected = inspect_at(root, path)?;
    let (_, _, _, expected, hash_before, _) = validate_archive(path)?;
    if hash_before != inspected.archive_sha256 {
        return Err("El archivo cambió durante la inspección".into());
    }
    if inspected.status == "already_installed" {
        return Err("Ya está instalado.".into());
    }
    if inspected.status == "older" {
        return Err("La versión importada es anterior; no se instala automáticamente.".into());
    }
    fs::create_dir_all(root).map_err(|e| io_error("No se pudo crear la biblioteca", e))?;
    let stage = root.join(format!(".staging-{}", Uuid::new_v4()));
    fs::create_dir(&stage).map_err(|e| io_error("No se pudo preparar staging", e))?;
    let result = (|| -> Result<InstalledPack, String> {
        let mut archive = ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        for index in 0..archive.len() {
            let entry = archive.by_index(index).map_err(|e| e.to_string())?;
            let relative = entry.name();
            safe_path(relative)?;
            let target = stage.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut output = File::create(target).map_err(|e| e.to_string())?;
            let copied = std::io::copy(&mut entry.take(MAX_ENTRY + 1), &mut output)
                .map_err(|e| e.to_string())?;
            if copied > MAX_ENTRY {
                return Err("Límite de extracción excedido".into());
            }
        }
        let destination = root
            .join("packs")
            .join(&inspected.manifest.pack_id)
            .join(&inspected.manifest.pack_version);
        if destination.exists() {
            return Err("Destino del pack ya ocupado".into());
        }
        let (verified, _, _, _, hash_after, _) = validate_archive(path)?;
        if verified.pack_id != inspected.manifest.pack_id || hash_after != hash_before {
            return Err("El paquete cambió durante la instalación".into());
        }
        for (relative, digest) in &expected {
            let bytes = fs::read(stage.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR)))
                .map_err(|e| e.to_string())?;
            if sha(&bytes) != *digest {
                return Err("Integridad de staging fallida".into());
            }
        }
        fs::create_dir_all(destination.parent().ok_or("Destino inválido")?)
            .map_err(|e| e.to_string())?;
        fs::rename(&stage, &destination)
            .map_err(|e| io_error("No se pudo publicar el paquete", e))?;
        let record = InstalledPack {
            pack_id: inspected.manifest.pack_id.clone(),
            pack_version: inspected.manifest.pack_version.clone(),
            name: inspected.manifest.name.clone(),
            author: inspected.manifest.author.clone(),
            installed_at: chrono::Utc::now().to_rfc3339(),
            source: "local".into(),
            install_path: format!(
                "packs/{}/{}",
                inspected.manifest.pack_id, inspected.manifest.pack_version
            ),
            templates: inspected.manifest.templates.clone(),
            archive_sha256: inspected.archive_sha256.clone(),
            size_bytes: inspected.size_bytes,
        };
        let mut index = read_index(root)?;
        index.push(record.clone());
        if let Err(error) = write_index(root, &index) {
            let _ = fs::remove_dir_all(destination);
            return Err(error);
        }
        Ok(record)
    })();
    if stage.exists() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

#[tauri::command]
pub(crate) fn install_chetopack(
    app: tauri::AppHandle,
    path: String,
) -> Result<InstalledPack, String> {
    install_at(&root(&app)?, Path::new(&path))
}

#[tauri::command]
pub(crate) fn uninstall_chetopack(
    app: tauri::AppHandle,
    pack_id: String,
    pack_version: String,
) -> Result<(), String> {
    uninstall_at(&root(&app)?, &pack_id, &pack_version)
}

fn uninstall_at(root: &Path, pack_id: &str, pack_version: &str) -> Result<(), String> {
    validate_pack_id(&pack_id)?;
    semver(&pack_version)?;
    let mut index = read_index(root)?;
    let before = index.len();
    index.retain(|item| item.pack_id != pack_id || item.pack_version != pack_version);
    if before == index.len() {
        return Err("Paquete no instalado".into());
    }
    let target = root.join("packs").join(pack_id).join(pack_version);
    let target = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    let safe_root = fs::canonicalize(root.join("packs")).map_err(|e| e.to_string())?;
    if !target.starts_with(&safe_root) || target == safe_root {
        return Err("Ruta de desinstalación insegura".into());
    }
    let trash = root.join(format!(".uninstall-{}", Uuid::new_v4()));
    fs::rename(&target, &trash).map_err(|e| e.to_string())?;
    if let Err(error) = write_index(root, &index) {
        let _ = fs::rename(&trash, &target);
        return Err(error);
    }
    fs::remove_dir_all(trash)
        .map_err(|e| io_error("Índice actualizado, no se pudo limpiar el paquete", e))
}

#[tauri::command]
pub(crate) fn load_installed_templates(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let root = root(&app)?;
    let mut values = Vec::new();
    for pack in read_index(&root)? {
        for item in pack.templates {
            let path = root
                .join("packs")
                .join(&pack.pack_id)
                .join(&pack.pack_version)
                .join(&item.path);
            let bytes =
                fs::read(path).map_err(|e| io_error("Template instalado no disponible", e))?;
            if bytes.len() as u64 > MAX_JSON {
                return Err("Template instalado demasiado grande".into());
            }
            let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            template_engine::validate_pack_template(&value)?;
            values.push(value);
        }
    }
    Ok(values)
}

fn export_at(request: ExportPackRequest) -> Result<String, String> {
    validate_pack_id(&request.pack_id)?;
    semver(&request.pack_version)?;
    if request.templates.is_empty() || request.templates.len() > 64 {
        return Err("Selecciona entre 1 y 64 plantillas".into());
    }
    let destination = PathBuf::from(&request.output_path);
    if destination
        .extension()
        .and_then(|v| v.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("chetopack"))
        || destination.exists()
    {
        return Err("El destino debe terminar en .chetopack y estar libre".into());
    }
    let parent = destination.parent().ok_or("Destino inválido")?;
    if !parent.is_dir() {
        return Err("Carpeta de salida no disponible".into());
    }
    let mut files = BTreeMap::<String, Vec<u8>>::new();
    let mut templates = Vec::new();
    let mut builtin_refs = HashSet::new();
    for value in request.templates {
        template_engine::validate_pack_template(&value)?;
        let id = value["templateId"].as_str().ok_or("templateId inválido")?;
        if !id.starts_with(&format!("cheto.pack.{}.", request.pack_id)) {
            return Err("La identidad de la plantilla no corresponde al pack".into());
        }
        let version = value["templateVersion"]
            .as_str()
            .ok_or("version inválida")?;
        let filename = format!(
            "templates/{}.json",
            id.strip_prefix(&format!("cheto.pack.{}.", request.pack_id))
                .unwrap_or(id)
        );
        safe_path(&filename)?;
        if files
            .insert(
                filename.clone(),
                serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
            )
            .is_some()
        {
            return Err("Templates duplicados".into());
        }
        templates.push(PackTemplateRef {
            path: filename,
            template_id: id.into(),
            template_version: version.into(),
        });
        for font in value["fontRefs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if font == "inter" || font == "instrument-serif" {
                builtin_refs.insert(format!("font:{font}"));
            }
        }
        for primitive in value["recipe"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            builtin_refs.insert(format!("primitive:{primitive}"));
        }
    }
    let template_values = templates
        .iter()
        .map(|item| {
            serde_json::from_slice::<Value>(files.get(&item.path).expect("template written"))
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut licenses = templates
        .iter()
        .map(|item| LicenseEntry {
            resource_id: item.path.clone(),
            resource_type: "template".into(),
            name: item.template_id.clone(),
            license_id: "CHETO-TEMPLATE".into(),
            license_text_ref: None,
            source: "CHETO VIDEO AI".into(),
            author: request.author.clone(),
            copyright: String::new(),
            redistribution_allowed: true,
            modified: false,
            notes: "Plantilla declarativa".into(),
        })
        .collect::<Vec<_>>();
    let mut asset_refs = Vec::new();
    let mut font_refs = Vec::new();
    let mut preview_refs = Vec::new();
    for resource in request.resources {
        safe_path(&resource.path)?;
        if resource.license.resource_id != resource.path
            || !resource.license.redistribution_allowed
            || resource.license.license_id.trim().is_empty()
        {
            return Err("Recurso sin licencia redistribuible".into());
        }
        let bytes =
            fs::read(&resource.source_path).map_err(|e| io_error("No se pudo leer recurso", e))?;
        if bytes.len() as u64 > MAX_ENTRY || files.insert(resource.path.clone(), bytes).is_some() {
            return Err("Recurso duplicado o demasiado grande".into());
        }
        if resource.path.starts_with("fonts/") {
            font_refs.push(resource.path.clone());
        } else if resource.path.starts_with("assets/") {
            asset_refs.push(resource.path.clone());
        } else if resource.path.starts_with("previews/") {
            preview_refs.push(resource.path.clone());
        }
        licenses.push(resource.license);
    }
    for value in &template_values {
        for (refs, paths, label) in [
            (&value["fontRefs"], &font_refs, "Fuente"),
            (&value["assetRefs"], &asset_refs, "Asset"),
        ] {
            for id in refs
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                if id == "inter" || id == "instrument-serif" {
                    continue;
                }
                let (pack_id, version, relative) = parse_resource_id(id)?;
                if pack_id != request.pack_id
                    || version != request.pack_version
                    || !paths.iter().any(|path| path == relative)
                {
                    return Err(format!("{label} requerido no incluido: {id}"));
                }
            }
        }
    }
    let manifest = PackManifest {
        schema_version: 1,
        pack_id: request.pack_id,
        pack_version: request.pack_version,
        name: request.name,
        description: request.description,
        author: request.author,
        created_at: chrono::Utc::now().to_rfc3339(),
        minimum_cheto_version: APP_VERSION.into(),
        maximum_cheto_version: None,
        templates,
        asset_refs,
        font_refs,
        preview_refs,
        tags: Vec::new(),
        categories: Vec::new(),
        license_summary: "Licencias declaradas por recurso".into(),
        checksum_algorithm: "SHA-256".into(),
        provenance: "user-provided".into(),
        requires_builtins: builtin_refs.into_iter().collect(),
        signature: None,
    };
    validate_manifest(&manifest)?;
    files.insert(
        "manifest.json".into(),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    );
    files.insert(
        "licenses/LICENSES.json".into(),
        serde_json::to_vec_pretty(&licenses).map_err(|e| e.to_string())?,
    );
    let checksums = files
        .iter()
        .map(|(path, bytes)| (path.clone(), sha(bytes)))
        .collect::<BTreeMap<_, _>>();
    files.insert(
        "checksums.json".into(),
        serde_json::to_vec_pretty(&checksums).map_err(|e| e.to_string())?,
    );
    let pending = parent.join(format!(".chetopack-{}.chetopack", Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut writer = ZipWriter::new(File::create(&pending).map_err(|e| e.to_string())?);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, bytes) in files {
            writer
                .start_file(name, options)
                .map_err(|e| e.to_string())?;
            writer.write_all(&bytes).map_err(|e| e.to_string())?;
        }
        writer.finish().map_err(|e| e.to_string())?;
        validate_archive(&pending)?;
        fs::rename(&pending, &destination)
            .map_err(|e| io_error("No se pudo publicar .chetopack", e))?;
        Ok(())
    })();
    if result.is_err() && pending.exists() {
        let _ = fs::remove_file(&pending);
    }
    result.map(|_| destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn export_chetopack(request: ExportPackRequest) -> Result<String, String> {
    export_at(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn template(pack: &str, family: &str) -> Value {
        let catalog: Value =
            serde_json::from_str(include_str!("../../src/templates/builtin-manifests.json"))
                .unwrap();
        let raw = catalog["templates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["legacyPresetId"] == family)
            .unwrap();
        let mut parameters = catalog["parameters"].as_array().unwrap().clone();
        for override_value in raw["parameters"].as_array().into_iter().flatten() {
            if let Some(index) = parameters
                .iter()
                .position(|item| item["id"] == override_value["id"])
            {
                for (key, value) in override_value.as_object().unwrap() {
                    parameters[index][key] = value.clone();
                }
            } else {
                parameters.push(override_value.clone());
            }
        }
        let mut value = raw.clone();
        value["schemaVersion"] = 1.into();
        value["rendererVersion"] = catalog["rendererVersion"].clone();
        value["templateId"] = format!("cheto.pack.{pack}.{family}").into();
        value["author"] = catalog["author"].clone();
        value["license"] = catalog["license"].clone();
        value["provenance"] = catalog["provenance"].clone();
        value["supportedAspectRatios"] = catalog["supportedAspectRatios"].clone();
        value["durationMs"] = catalog["durationMs"].clone();
        value["safeArea"] = catalog["safeArea"].clone();
        value["parameters"] = parameters.into();
        if value["fontRefs"].is_null() {
            value["fontRefs"] = catalog["fontRefs"].clone();
        }
        if value["assetRefs"].is_null() {
            value["assetRefs"] = catalog["assetRefs"].clone();
        }
        if value["animationIn"].is_null() {
            value["animationIn"] = serde_json::json!({"durationMs":500,"easing":"easeOut"});
        }
        if value["animationOut"].is_null() {
            value["animationOut"] = serde_json::json!({"durationMs":350,"easing":"linear"});
        }
        value
    }
    fn request(root: &Path, version: &str, families: &[&str]) -> ExportPackRequest {
        ExportPackRequest {
            pack_id: "com.cheto.qa".into(),
            pack_version: version.into(),
            name: "Edición José Perú".into(),
            description: "Niñez, música y configuración.".into(),
            author: "QA local".into(),
            output_path: root
                .join(format!("qa-{version}.chetopack"))
                .to_string_lossy()
                .into_owned(),
            templates: families
                .iter()
                .map(|family| template("com.cheto.qa", family))
                .collect(),
            resources: Vec::new(),
        }
    }
    fn resource(
        path: &str,
        source: &Path,
        license_id: &str,
        text_ref: Option<&str>,
    ) -> ExportResource {
        ExportResource {
            path: path.into(),
            source_path: source.to_string_lossy().into_owned(),
            license: LicenseEntry {
                resource_id: path.into(),
                resource_type: "fixture".into(),
                name: path.into(),
                license_id: license_id.into(),
                license_text_ref: text_ref.map(str::to_string),
                source: "CHETO test resources".into(),
                author: "CHETO".into(),
                copyright: String::new(),
                redistribution_allowed: true,
                modified: false,
                notes: String::new(),
            },
        }
    }
    fn rewrite_with_extra(source: &Path, destination: &Path, name: &str, contents: &[u8]) {
        let mut archive = ZipArchive::new(File::open(source).unwrap()).unwrap();
        let mut writer = ZipWriter::new(File::create(destination).unwrap());
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).unwrap();
            let filename = entry.name().to_string();
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            writer
                .start_file(
                    filename,
                    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
                )
                .unwrap();
            writer.write_all(&bytes).unwrap();
        }
        writer
            .start_file(name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(contents).unwrap();
        writer.finish().unwrap();
    }
    #[test]
    fn path_rejections_cover_traversal_windows_and_executables() {
        for path in [
            "../evil.txt",
            "templates/../../evil.json",
            "C:\\evil.txt",
            "//server/asset.png",
            "assets/images/evil.exe",
            "fonts/CON.ttf",
            "assets/images/Asset.png/../x.png",
            "templates\\evil.json",
        ] {
            assert!(safe_path(path).is_err(), "{path}");
        }
        assert!(safe_path("templates/José-Perú.json").is_ok());
    }
    #[test]
    fn semver_and_id_are_bounded() {
        assert!(semver("1.2.3").is_ok());
        assert!(semver("1.02.3").is_err());
        assert!(validate_pack_id("com.cheto.jose").is_ok());
        assert!(validate_pack_id("../evil").is_err());
    }
    #[test]
    fn minimal_pack_exports_installs_updates_and_uninstalls_without_losing_other_versions() {
        let temp = tempfile::tempdir().unwrap();
        let storage = temp.path().join("library");
        let path = export_at(request(temp.path(), "1.0.0", &["future-glow"])).unwrap();
        let first = inspect_at(&storage, Path::new(&path)).unwrap();
        assert_eq!(first.status, "compatible");
        assert_eq!(first.templates.len(), 1);
        assert!(first
            .licenses
            .iter()
            .any(|item| item.resource_type == "template"));
        install_at(&storage, Path::new(&path)).unwrap();
        verify_at(&storage, "com.cheto.qa", "1.0.0").unwrap();
        assert_eq!(
            inspect_at(&storage, Path::new(&path)).unwrap().status,
            "already_installed"
        );
        let updated = export_at(request(
            temp.path(),
            "1.1.0",
            &["future-glow", "editorial-master", "quote-editorial"],
        ))
        .unwrap();
        assert_eq!(
            inspect_at(&storage, Path::new(&updated)).unwrap().status,
            "update"
        );
        install_at(&storage, Path::new(&updated)).unwrap();
        assert_eq!(read_index(&storage).unwrap().len(), 2);
        assert!(storage
            .join("packs/com.cheto.qa/1.0.0/templates/future-glow.json")
            .exists());
        uninstall_at(&storage, "com.cheto.qa", "1.1.0").unwrap();
        assert_eq!(read_index(&storage).unwrap().len(), 1);
        assert!(storage.join("packs/com.cheto.qa/1.0.0").exists());
        assert!(!storage.join("packs/com.cheto.qa/1.1.0").exists());
    }
    #[test]
    fn corrupt_checksum_and_forbidden_entries_never_publish() {
        let temp = tempfile::tempdir().unwrap();
        let path = export_at(request(temp.path(), "1.0.0", &["future-glow"])).unwrap();
        for (name, contents) in [
            ("../evil.txt", b"escape".as_slice()),
            ("C:\\evil.txt", b"absolute".as_slice()),
            ("assets/images/evil.exe", b"MZ".as_slice()),
        ] {
            let bad = temp
                .path()
                .join(format!("bad-{}.chetopack", Uuid::new_v4()));
            rewrite_with_extra(Path::new(&path), &bad, name, contents);
            assert!(install_at(&temp.path().join("library"), &bad).is_err());
        }
        assert!(!temp.path().join("evil.txt").exists());
        let tampered = temp.path().join("tampered.chetopack");
        rewrite_with_extra(
            Path::new(&path),
            &tampered,
            "previews/extra.jpg",
            b"\xff\xd8\xffchanged",
        );
        assert!(validate_archive(&tampered)
            .unwrap_err()
            .contains("CHECKSUM"));
    }
    #[test]
    fn case_collision_and_compression_bomb_are_rejected_before_extraction() {
        let temp = tempfile::tempdir().unwrap();
        let collision = temp.path().join("collision.chetopack");
        let mut zip = ZipWriter::new(File::create(&collision).unwrap());
        for path in ["assets/images/Asset.png", "assets/images/asset.png"] {
            zip.start_file(path, SimpleFileOptions::default()).unwrap();
            zip.write_all(b"\x89PNG\r\n\x1a\n").unwrap();
        }
        zip.finish().unwrap();
        assert!(validate_archive(&collision)
            .unwrap_err()
            .contains("Colisión"));
        let bomb = temp.path().join("bomb.chetopack");
        let mut zip = ZipWriter::new(File::create(&bomb).unwrap());
        zip.start_file(
            "assets/images/bomb.png",
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
        )
        .unwrap();
        zip.write_all(&vec![0u8; 4 * 1024 * 1024]).unwrap();
        zip.finish().unwrap();
        assert!(validate_archive(&bomb)
            .unwrap_err()
            .contains("descompresión"));
        assert!(!temp.path().join("library").exists());
    }
    #[test]
    fn unknown_recipe_and_conflicting_same_version_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let mut bad = request(temp.path(), "1.0.0", &["future-glow"]);
        bad.templates[0]["recipe"] = serde_json::json!(["runShell"]);
        assert!(export_at(bad).unwrap_err().contains("receta"));
        let path = export_at(request(temp.path(), "1.0.0", &["future-glow"])).unwrap();
        let storage = temp.path().join("library");
        install_at(&storage, Path::new(&path)).unwrap();
        let mut changed = request(temp.path(), "1.0.0", &["future-glow"]);
        changed.output_path = temp
            .path()
            .join("different.chetopack")
            .to_string_lossy()
            .into_owned();
        changed.description = "otro contenido".into();
        let different = export_at(changed).unwrap();
        assert!(inspect_at(&storage, Path::new(&different))
            .unwrap_err()
            .contains("Conflicto"));
    }
    #[test]
    fn full_pack_round_trips_utf8_font_asset_preview_and_license() {
        let temp = tempfile::tempdir().unwrap();
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let font = manifest_dir.join("resources/visual-13d/fonts/Inter.ttf");
        let license = manifest_dir.join("resources/visual-13d/licenses/Inter-OFL.txt");
        let image = manifest_dir.join("../../../docs/13e-template-gallery-16x9.jpg");
        let mut request = request(
            temp.path(),
            "1.0.0",
            &["editorial-master", "lower-third-premium", "quote-editorial"],
        );
        request.resources = vec![
            resource(
                "fonts/Inter.ttf",
                &font,
                "OFL-1.1",
                Some("licenses/Inter-OFL.txt"),
            ),
            resource("licenses/Inter-OFL.txt", &license, "OFL-1.1", None),
            resource("assets/images/gallery.jpg", &image, "CHETO-OWN", None),
            resource("previews/gallery.jpg", &image, "CHETO-OWN", None),
        ];
        let path = export_at(request).unwrap();
        let inspected = inspect_at(&temp.path().join("library"), Path::new(&path)).unwrap();
        assert_eq!(inspected.manifest.name, "Edición José Perú");
        assert_eq!(
            inspected.manifest.description,
            "Niñez, música y configuración."
        );
        assert_eq!(inspected.manifest.templates.len(), 3);
        assert_eq!(inspected.manifest.font_refs.len(), 1);
        assert_eq!(inspected.manifest.asset_refs.len(), 1);
        assert_eq!(inspected.manifest.preview_refs.len(), 1);
        assert_eq!(inspected.licenses.len(), 7);
        install_at(&temp.path().join("library"), Path::new(&path)).unwrap();
        verify_at(&temp.path().join("library"), "com.cheto.qa", "1.0.0").unwrap();
        let font_id = resource_id("com.cheto.qa", "1.0.0", "fonts/Inter.ttf");
        let asset_id = resource_id("com.cheto.qa", "1.0.0", "assets/images/gallery.jpg");
        assert_eq!(
            resolve_resource_at(&temp.path().join("library"), &font_id)
                .unwrap()
                .kind,
            "font"
        );
        assert_eq!(
            resolve_resource_at(&temp.path().join("library"), &asset_id)
                .unwrap()
                .kind,
            "asset"
        );
        let altered_font = temp.path().join("Inter-altered.ttf");
        let mut altered_bytes = fs::read(&font).unwrap();
        altered_bytes.push(0);
        fs::write(&altered_font, altered_bytes).unwrap();
        let mut incompatible = self::request(temp.path(), "1.1.0", &["editorial-master"]);
        incompatible.resources = vec![
            resource(
                "fonts/Inter.ttf",
                &altered_font,
                "OFL-1.1",
                Some("licenses/Inter-OFL.txt"),
            ),
            resource("licenses/Inter-OFL.txt", &license, "OFL-1.1", None),
        ];
        let incompatible_path = export_at(incompatible).unwrap();
        assert!(
            inspect_at(&temp.path().join("library"), Path::new(&incompatible_path))
                .unwrap_err()
                .contains("Conflicto de fuente")
        );
        fs::write(
            temp.path()
                .join("library/packs/com.cheto.qa/1.0.0/previews/gallery.jpg"),
            b"changed",
        )
        .unwrap();
        assert!(
            verify_at(&temp.path().join("library"), "com.cheto.qa", "1.0.0")
                .unwrap_err()
                .contains("CHECKSUM")
        );
        uninstall_at(&temp.path().join("library"), "com.cheto.qa", "1.0.0").unwrap();
        assert!(read_index(&temp.path().join("library")).unwrap().is_empty());
        assert!(resolve_resource_at(&temp.path().join("library"), &font_id).is_err());
    }
    #[test]
    fn checked_in_qa_fixtures_validate() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/chetopack");
        let minimal = validate_archive(&root.join("qa-minimal.chetopack")).unwrap();
        let full = validate_archive(&root.join("qa-full.chetopack")).unwrap();
        assert_eq!(minimal.0.templates.len(), 1);
        assert_eq!(full.0.templates.len(), 3);
        assert_eq!(full.0.font_refs.len(), 1);
        assert_eq!(full.0.asset_refs.len(), 1);
    }
    #[test]
    fn imported_template_snapshot_keeps_export_layout_after_uninstall() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/chetopack");
        let storage = tempfile::tempdir().unwrap();
        install_at(storage.path(), &root.join("qa-minimal.chetopack")).unwrap();
        let (_, templates, _, _, _, _) =
            validate_archive(&root.join("qa-minimal.chetopack")).unwrap();
        let manifest = templates[0].clone();
        let mut value: Value = serde_json::from_str(r##"{"id":"pack-title","presetId":"future-glow","text":"José en Perú","secondaryText":"PRUEBA","startUs":0,"endUs":4000000,"positionX":0.5,"positionY":0.5,"anchor":"center","scale":1,"font":"Inter","fontWeight":700,"fontSize":72,"color":"#FFFFFF","accentColor":"#34D5E5","alignment":"center","tracking":0,"lineHeight":1.15,"opacity":1,"safeArea":0.06,"animationInUs":500000,"animationOutUs":350000,"easing":"ease-out","background":false}"##).unwrap();
        value["templateId"] = manifest["templateId"].clone();
        value["templateVersion"] = manifest["templateVersion"].clone();
        value["templateSnapshot"] = manifest.clone();
        let title: crate::project_storage::TitleDecision = serde_json::from_value(value).unwrap();
        uninstall_at(storage.path(), "com.cheto.qa", "1.0.0").unwrap();
        assert_eq!(
            template_engine::resolve_manifest(&title).unwrap().unwrap(),
            &manifest
        );
        for (width, height) in [(1920, 1080), (1080, 1920), (1080, 1080)] {
            let layout = template_engine::layout(&title, width, height)
                .unwrap()
                .unwrap();
            assert!(layout.font_scale > 0.0);
            assert!(layout.x >= layout.safe_area);
        }
    }
    #[test]
    #[ignore = "regenerate checked-in QA .chetopack files only when requested"]
    fn write_qa_fixtures() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/chetopack");
        fs::create_dir_all(&fixtures).unwrap();
        let mut minimal = request(&fixtures, "1.0.0", &["future-glow"]);
        minimal.output_path = fixtures
            .join("qa-minimal.chetopack")
            .to_string_lossy()
            .into_owned();
        if Path::new(&minimal.output_path).exists() {
            fs::remove_file(&minimal.output_path).unwrap();
        }
        export_at(minimal).unwrap();
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut full = request(
            &fixtures,
            "1.0.0",
            &["editorial-master", "lower-third-premium", "quote-editorial"],
        );
        full.output_path = fixtures
            .join("qa-full.chetopack")
            .to_string_lossy()
            .into_owned();
        full.resources = vec![
            resource(
                "fonts/Inter.ttf",
                &manifest_dir.join("resources/visual-13d/fonts/Inter.ttf"),
                "OFL-1.1",
                Some("licenses/Inter-OFL.txt"),
            ),
            resource(
                "licenses/Inter-OFL.txt",
                &manifest_dir.join("resources/visual-13d/licenses/Inter-OFL.txt"),
                "OFL-1.1",
                None,
            ),
            resource(
                "assets/images/gallery.jpg",
                &manifest_dir.join("../../../docs/13e-template-gallery-16x9.jpg"),
                "CHETO-OWN",
                None,
            ),
            resource(
                "previews/gallery.jpg",
                &manifest_dir.join("../../../docs/13e-template-gallery-16x9.jpg"),
                "CHETO-OWN",
                None,
            ),
        ];
        if Path::new(&full.output_path).exists() {
            fs::remove_file(&full.output_path).unwrap();
        }
        export_at(full).unwrap();
    }
}
