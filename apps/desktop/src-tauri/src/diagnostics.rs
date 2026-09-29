use crate::hardware_profile::detect_hardware_profile;
use serde::Serialize;
use std::process::{Command, Stdio};
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticContext {
    cpu: String,
    gpu: Vec<String>,
    ram_total_bytes: u64,
    ffmpeg_version: String,
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

#[tauri::command]
pub fn get_diagnostic_context(app: AppHandle) -> Result<DiagnosticContext, String> {
    let hardware = detect_hardware_profile(app)?;
    let mut command = Command::new("ffmpeg");
    command.arg("-version").stdin(Stdio::null());
    hide_console(&mut command);
    let ffmpeg_version = command
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|text| text.lines().next().map(str::to_owned))
        .unwrap_or_else(|| "No disponible".into());
    Ok(DiagnosticContext {
        cpu: hardware.cpu,
        gpu: hardware
            .gpu_adapters
            .into_iter()
            .map(|adapter| adapter.name)
            .collect(),
        ram_total_bytes: hardware.ram_total_bytes,
        ffmpeg_version,
    })
}
