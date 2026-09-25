use serde::{Deserialize, Serialize};
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
pub struct HardwareProfile {
    pub cpu: String,
    pub logical_cores: usize,
    pub physical_cores: usize,
    pub architecture: String,
    pub ram_total_bytes: u64,
    pub ram_available_bytes: u64,
    pub gpu_adapters: Vec<GpuAdapter>,
    pub disk_free_bytes: u64,
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
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_gpu_vendors() {
        assert_eq!(vendor_name(0x10DE), "NVIDIA");
        assert_eq!(vendor_name(0x1002), "AMD");
        assert_eq!(vendor_name(0x1022), "AMD");
        assert_eq!(vendor_name(0x8086), "Intel");
    }

    #[test]
    fn maps_unknown_gpu_vendor() {
        assert_eq!(vendor_name(0xFFFF), "Other");
    }
}
