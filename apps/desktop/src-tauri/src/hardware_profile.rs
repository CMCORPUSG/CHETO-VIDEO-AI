use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    process::{Command, Stdio},
};
use sysinfo::{Disks, System};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GpuAdapter {
    pub name: String,
    pub vendor: String,
    pub dedicated_video_memory_bytes: u64,
    pub vendor_id: u32,
    pub device_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccelerationCapability {
    pub backend: String,
    pub available: bool,
    pub reason: String,
    pub compute_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub cpu: String,
    pub logical_cores: usize,
    pub physical_cores: usize,
    pub architecture: String,
    pub ram_total_bytes: u64,
    pub ram_available_bytes: u64,
    pub gpu_adapters: Vec<GpuAdapter>,
    pub disk_free_bytes: u64,
    pub transcription_acceleration: AccelerationCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum QualityMode {
    Auto,
    Fast,
    Balanced,
    Quality,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionExecutionProfile {
    pub device: String,
    pub compute_type: String,
    pub model: String,
    pub cpu_threads: usize,
    pub workers: usize,
    pub reason: String,
    pub automatic: bool,
}

fn vendor_name(id: u32) -> &'static str {
    match id {
        0x10DE => "NVIDIA",
        0x1002 | 0x1022 => "AMD",
        0x8086 => "Intel",
        _ => "Other",
    }
}

#[cfg(windows)]
fn detect_gpu_adapters() -> Vec<GpuAdapter> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ERROR_NOT_FOUND};
    let mut result = Vec::new();
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return result;
    };
    for index in 0..32 {
        match unsafe { factory.EnumAdapters1(index) } {
            Ok(adapter) => {
                if let Ok(desc) = unsafe { adapter.GetDesc1() } {
                    let length = desc
                        .Description
                        .iter()
                        .position(|value| *value == 0)
                        .unwrap_or(desc.Description.len());
                    result.push(GpuAdapter {
                        name: String::from_utf16_lossy(&desc.Description[..length]),
                        vendor: vendor_name(desc.VendorId).into(),
                        dedicated_video_memory_bytes: desc.DedicatedVideoMemory as u64,
                        vendor_id: desc.VendorId,
                        device_id: desc.DeviceId,
                    });
                }
            }
            Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
            Err(_) => break,
        }
    }
    result
}

#[cfg(not(windows))]
fn detect_gpu_adapters() -> Vec<GpuAdapter> {
    Vec::new()
}

fn worker_probe() -> AccelerationCapability {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo = manifest.join("../../..");
    let venv = repo.join(".venv/Scripts/python.exe");
    let executable = if venv.is_file() {
        venv.to_string_lossy().into_owned()
    } else {
        "python".into()
    };
    let mut command = Command::new(executable);
    command
        .current_dir(&repo)
        .env("PYTHONPATH", repo.join("worker"))
        .args(["-m", "transcription.main"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let Ok(mut child) = command.spawn() else {
        return AccelerationCapability {
            backend: "cpu".into(),
            available: false,
            reason: "Worker Python no disponible; CPU pendiente de instalación".into(),
            compute_types: vec![],
        };
    };
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(b"{\"command\":\"PROBE\"}\n");
    }
    let Ok(output) = child.wait_with_output() else {
        return AccelerationCapability {
            backend: "cpu".into(),
            available: false,
            reason: "No se pudo consultar CTranslate2".into(),
            compute_types: vec![],
        };
    };
    let parsed = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| serde_json::from_str::<serde_json::Value>(line).ok());
    let payload = parsed.as_ref().and_then(|value| value.get("payload"));
    let count = payload
        .and_then(|value| value.get("cudaDeviceCount"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let types = payload
        .and_then(|value| value.get("cudaComputeTypes"))
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let reason = payload
        .and_then(|value| value.get("reason"))
        .and_then(|value| value.as_str())
        .unwrap_or(if count > 0 {
            "CUDA validado"
        } else {
            "CTranslate2/CUDA no disponible"
        });
    AccelerationCapability {
        backend: if count > 0 { "cuda" } else { "cpu" }.into(),
        available: count > 0,
        reason: reason.into(),
        compute_types: types,
    }
}

pub fn select_execution_profile(
    hardware: &HardwareProfile,
    mode: QualityMode,
    force_cpu: bool,
) -> TranscriptionExecutionProfile {
    let threads = hardware.logical_cores.clamp(1, 8);
    let cuda = hardware.transcription_acceleration.available
        && hardware
            .transcription_acceleration
            .compute_types
            .iter()
            .any(|value| value == "int8_float16")
        && !force_cpu;
    let vram = hardware
        .gpu_adapters
        .iter()
        .filter(|gpu| gpu.vendor == "NVIDIA")
        .map(|gpu| gpu.dedicated_video_memory_bytes)
        .max()
        .unwrap_or(0);
    let low_ram = hardware.ram_available_bytes < 4 * 1024_u64.pow(3);
    let model = if cuda {
        match mode {
            QualityMode::Quality if vram >= 10 * 1024_u64.pow(3) => "medium",
            QualityMode::Fast => "base",
            _ if vram < 5 * 1024_u64.pow(3) || low_ram => "base",
            _ => "small",
        }
    } else {
        match mode {
            QualityMode::Fast => "tiny",
            _ if low_ram => "tiny",
            _ => "small",
        }
    };
    TranscriptionExecutionProfile {
        device: if cuda { "cuda" } else { "cpu" }.into(),
        compute_type: if cuda { "int8_float16" } else { "int8" }.into(),
        model: model.into(),
        cpu_threads: threads,
        workers: 1,
        reason: if cuda {
            "CUDA validado por CTranslate2 y recursos compatibles"
        } else if force_cpu {
            "CPU forzada para prueba o preferencia"
        } else {
            "CUDA no utilizable; fallback CPU seguro"
        }
        .into(),
        automatic: !force_cpu,
    }
}

#[tauri::command]
pub fn select_transcription_profile(
    hardware: HardwareProfile,
    mode: QualityMode,
    force_cpu: Option<bool>,
) -> TranscriptionExecutionProfile {
    select_execution_profile(&hardware, mode, force_cpu.unwrap_or(false))
}

#[tauri::command]
pub fn detect_hardware_profile(app: AppHandle) -> Result<HardwareProfile, String> {
    let mut system = System::new_all();
    system.refresh_all();
    let local_data = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let disks = Disks::new_with_refreshed_list();
    let disk_free_bytes = disks
        .list()
        .iter()
        .filter(|disk| local_data.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .map(|disk| disk.available_space())
        .unwrap_or(0);
    Ok(HardwareProfile {
        cpu: system
            .cpus()
            .first()
            .map(|cpu| cpu.brand().to_owned())
            .unwrap_or_else(|| "Unknown CPU".into()),
        logical_cores: system.cpus().len().max(1),
        physical_cores: System::physical_core_count().unwrap_or(system.cpus().len().max(1)),
        architecture: std::env::consts::ARCH.into(),
        ram_total_bytes: system.total_memory(),
        ram_available_bytes: system.available_memory(),
        gpu_adapters: detect_gpu_adapters(),
        disk_free_bytes,
        transcription_acceleration: worker_probe(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hardware(cuda: bool, vendor: &str, vram_gb: u64, ram_gb: u64) -> HardwareProfile {
        HardwareProfile {
            cpu: "Test CPU".into(),
            logical_cores: 12,
            physical_cores: 6,
            architecture: "x86_64".into(),
            ram_total_bytes: 16 * 1024_u64.pow(3),
            ram_available_bytes: ram_gb * 1024_u64.pow(3),
            gpu_adapters: if vendor == "none" {
                vec![]
            } else {
                vec![GpuAdapter {
                    name: "Generic Adapter".into(),
                    vendor: vendor.into(),
                    dedicated_video_memory_bytes: vram_gb * 1024_u64.pow(3),
                    vendor_id: 1,
                    device_id: 2,
                }]
            },
            disk_free_bytes: 100 * 1024_u64.pow(3),
            transcription_acceleration: AccelerationCapability {
                backend: if cuda { "cuda" } else { "cpu" }.into(),
                available: cuda,
                reason: "test".into(),
                compute_types: if cuda {
                    vec!["int8_float16".into()]
                } else {
                    vec![]
                },
            },
        }
    }
    #[test]
    fn normalized_profile_contains_resources() {
        let h = hardware(false, "none", 0, 8);
        assert_eq!((h.logical_cores, h.physical_cores), (12, 6));
    }
    #[test]
    fn nvidia_without_cuda_is_cpu() {
        assert_eq!(
            select_execution_profile(&hardware(false, "NVIDIA", 8, 8), QualityMode::Auto, false)
                .device,
            "cpu"
        );
    }
    #[test]
    fn amd_is_cpu() {
        assert_eq!(
            select_execution_profile(&hardware(false, "AMD", 8, 8), QualityMode::Balanced, false)
                .compute_type,
            "int8"
        );
    }
    #[test]
    fn intel_is_cpu() {
        assert_eq!(
            select_execution_profile(&hardware(false, "Intel", 2, 8), QualityMode::Auto, false)
                .device,
            "cpu"
        );
    }
    #[test]
    fn cpu_only_is_safe() {
        assert_eq!(
            select_execution_profile(&hardware(false, "none", 0, 8), QualityMode::Quality, false)
                .model,
            "small"
        );
    }
    #[test]
    fn four_gb_cuda_downgrades() {
        assert_eq!(
            select_execution_profile(&hardware(true, "NVIDIA", 4, 8), QualityMode::Auto, false)
                .model,
            "base"
        );
    }
    #[test]
    fn twelve_gb_cuda_quality_uses_medium() {
        assert_eq!(
            select_execution_profile(
                &hardware(true, "NVIDIA", 12, 12),
                QualityMode::Quality,
                false
            )
            .model,
            "medium"
        );
    }
    #[test]
    fn low_ram_uses_tiny_cpu() {
        assert_eq!(
            select_execution_profile(&hardware(false, "none", 0, 2), QualityMode::Quality, false)
                .model,
            "tiny"
        );
    }
}
