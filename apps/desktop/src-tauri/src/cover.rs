use crate::project_storage::ProjectStorage;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCover {
    pub path: String,
    pub fit: String,
    pub scale: f64,
    pub offset_x: f64,
    pub offset_y: f64,
}

fn cover_file(app: &AppHandle, project_id: &str) -> Result<PathBuf, String> {
    ProjectStorage::from_app(app)
        .map_err(|e| e.message)?
        .project_dir(project_id)
        .map(|path| path.join("cover.json"))
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn get_project_cover(
    app: AppHandle,
    project_id: String,
) -> Result<Option<ProjectCover>, String> {
    let file = cover_file(&app, &project_id)?;
    if !file.is_file() {
        return Ok(None);
    }
    let cover: ProjectCover = serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if Path::new(&cover.path).is_file() {
        app.asset_protocol_scope()
            .allow_file(Path::new(&cover.path))
            .map_err(|e| e.to_string())?;
    }
    Ok(Some(cover))
}

#[tauri::command]
pub fn save_project_cover(
    app: AppHandle,
    project_id: String,
    mut cover: ProjectCover,
) -> Result<ProjectCover, String> {
    if cover.fit != "cover" && cover.fit != "contain" {
        return Err("Ajuste de portada inválido.".into());
    }
    if !cover.scale.is_finite()
        || !(0.5..=2.5).contains(&cover.scale)
        || !cover.offset_x.is_finite()
        || cover.offset_x.abs() > 1.0
        || !cover.offset_y.is_finite()
        || cover.offset_y.abs() > 1.0
    {
        return Err("Transformación de portada inválida.".into());
    }
    let file = cover_file(&app, &project_id)?;
    let directory = file.parent().ok_or("Proyecto inválido")?;
    if !directory.join("project.json").is_file() {
        return Err("El proyecto no existe.".into());
    }
    let source = Path::new(&cover.path);
    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["jpg", "jpeg", "png", "webp"].contains(&ext.as_str()) || !source.is_file() {
        return Err("Selecciona una imagen JPG, PNG o WebP válida.".into());
    }
    if fs::metadata(source).map_err(|e| e.to_string())?.len() > 50_000_000 {
        return Err("La portada debe ocupar menos de 50 MB.".into());
    }
    let target = directory.join(format!("cover.{ext}"));
    let previous = get_project_cover(app.clone(), project_id.clone())
        .ok()
        .flatten();
    if source != target {
        fs::copy(source, &target).map_err(|e| e.to_string())?;
    }
    cover.path = target.to_string_lossy().into_owned();
    app.asset_protocol_scope()
        .allow_file(&target)
        .map_err(|e| e.to_string())?;
    fs::write(
        &file,
        serde_json::to_vec_pretty(&cover).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if let Some(previous) = previous {
        let old = Path::new(&previous.path);
        if old != target
            && old.parent() == Some(directory)
            && old.file_stem().is_some_and(|value| value == "cover")
        {
            let _ = fs::remove_file(old);
        }
    }
    Ok(cover)
}

#[tauri::command]
pub fn remove_project_cover(app: AppHandle, project_id: String) -> Result<(), String> {
    let file = cover_file(&app, &project_id)?;
    if let Ok(Some(cover)) = get_project_cover(app, project_id) {
        let image = Path::new(&cover.path);
        if image.parent() == file.parent()
            && image.file_stem().is_some_and(|value| value == "cover")
        {
            let _ = fs::remove_file(image);
        }
    }
    if file.is_file() {
        fs::remove_file(file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverExport {
    project_id: String,
    output_path: String,
    width: u32,
    height: u32,
}

#[tauri::command]
pub async fn export_project_cover(app: AppHandle, config: CoverExport) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cover = get_project_cover(app, config.project_id)?.ok_or("El proyecto no tiene portada.")?;
        if config.width < 16 || config.height < 16 || config.width > 7680 || config.height > 4320 { return Err("Resolución inválida.".into()); }
        let input = Path::new(&cover.path);
        if !input.is_file() { return Err("La imagen de portada ya no existe.".into()); }
        let output = Path::new(&config.output_path);
        if !output.extension().is_some_and(|value| value.eq_ignore_ascii_case("jpg")) { return Err("La portada asociada debe ser JPG.".into()); }
        let w = config.width;
        let h = config.height;
        let mode = if cover.fit == "cover" { "increase" } else { "decrease" };
        let filter = format!(
            r"scale={w}:{h}:force_original_aspect_ratio={mode},scale=trunc(iw*{scale}/2)*2:trunc(ih*{scale}/2)*2,crop=min(iw\,{w}):min(ih\,{h}):max(0\,(iw-ow)*(1+{x})/2):max(0\,(ih-oh)*(1+{y})/2),pad={w}:{h}:max(0\,(ow-iw)*(1+{x})/2):max(0\,(oh-ih)*(1+{y})/2):black,format=yuvj420p",
            scale=cover.scale, x=cover.offset_x, y=cover.offset_y
        );
        let mut command = Command::new("ffmpeg");
        command.args(["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
            .arg(input).args(["-vf", &filter, "-frames:v", "1", "-q:v", "2"])
            .arg(output).stdin(Stdio::null());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let result = command.output().map_err(|e| format!("No se pudo iniciar FFmpeg: {e}"))?;
        if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).into_owned()); }
        Ok(config.output_path)
    }).await.map_err(|e| e.to_string())?
}
