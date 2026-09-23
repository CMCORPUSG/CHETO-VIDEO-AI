use serde::{Deserialize, Serialize};
use std::path::Path;

pub const PROXY_SCHEMA_VERSION: u32 = 1;
pub const PROXY_FILE: &str = "media/proxy.mp4";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyError {
    pub(crate) code: String,
    pub(crate) message: String,
}

impl ProxyError {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyFps {
    pub numerator: u64,
    pub denominator: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxySourceSnapshot {
    pub file_size_bytes: u64,
    pub modified_at: Option<String>,
    pub duration_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyOutputSnapshot {
    pub file: String,
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: ProxyFps,
    pub encoder: String,
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyManifest {
    pub schema_version: u32,
    pub source_id: String,
    pub created_at: String,
    pub source: ProxySourceSnapshot,
    pub proxy: ProxyOutputSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyState {
    NotCreated,
    Preparing,
    Generating,
    Available,
    Stale,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub state: ProxyState,
    pub progress: Option<f64>,
    pub processed_us: Option<u64>,
    pub metadata: Option<ProxyManifest>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackKind {
    Original,
    Proxy,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackPreference {
    Auto,
    Original,
    Proxy,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSource {
    pub kind: PlaybackKind,
    pub path: String,
    pub duration_us: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProgress {
    pub project_id: String,
    pub status: ProxyState,
    pub progress: f64,
    pub processed_us: u64,
}

pub fn calculate_proxy_dimensions(width: u32, height: u32) -> Option<(u32, u32)> {
    if width == 0 || height == 0 {
        return None;
    }
    let (max_width, max_height) = if width >= height {
        (960_u32, 540_u32)
    } else {
        (540, 960)
    };
    let scale = f64::min(
        max_width as f64 / width as f64,
        max_height as f64 / height as f64,
    )
    .min(1.0);
    let even = |value: f64| -> u32 { ((value.floor() as u32).max(2) / 2) * 2 };
    Some((even(width as f64 * scale), even(height as f64 * scale)))
}

pub fn source_is_stale(stored: &ProxySourceSnapshot, current: &ProxySourceSnapshot) -> bool {
    stored.file_size_bytes != current.file_size_bytes || stored.modified_at != current.modified_at
}

pub fn proxy_is_valid(
    manifest: &ProxyManifest,
    source_id: &str,
    current: &ProxySourceSnapshot,
    proxy_path: &Path,
) -> bool {
    manifest.schema_version == PROXY_SCHEMA_VERSION
        && manifest.source_id == source_id
        && manifest.proxy.file == PROXY_FILE
        && manifest.proxy.file_size_bytes > 0
        && proxy_path.is_file()
        && !source_is_stale(&manifest.source, current)
}

pub fn select_encoder(nvenc_advertised: bool, nvenc_validation_passed: bool) -> &'static str {
    if nvenc_advertised && nvenc_validation_passed {
        "h264_nvenc"
    } else {
        "libx264"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn snapshot(size: u64, modified: &str) -> ProxySourceSnapshot {
        ProxySourceSnapshot {
            file_size_bytes: size,
            modified_at: Some(modified.into()),
            duration_us: 58_000_000,
        }
    }

    fn manifest(source: ProxySourceSnapshot) -> ProxyManifest {
        ProxyManifest {
            schema_version: 1,
            source_id: "28f4037d-8aa4-4c7b-a194-2e4437ea2d9b".into(),
            created_at: "2026-09-23T12:00:00.000Z".into(),
            source,
            proxy: ProxyOutputSnapshot {
                file: PROXY_FILE.into(),
                codec: "h264".into(),
                width: 960,
                height: 540,
                fps: ProxyFps {
                    numerator: 30,
                    denominator: 1,
                },
                encoder: "libx264".into(),
                file_size_bytes: 42,
            },
        }
    }

    #[test]
    fn calculates_horizontal_proxy() {
        assert_eq!(calculate_proxy_dimensions(1920, 1080), Some((960, 540)));
    }

    #[test]
    fn calculates_vertical_proxy() {
        assert_eq!(calculate_proxy_dimensions(1080, 1920), Some((540, 960)));
    }

    #[test]
    fn dimensions_are_even() {
        let (w, h) = calculate_proxy_dimensions(853, 479).unwrap();
        assert_eq!((w % 2, h % 2), (0, 0));
    }

    #[test]
    fn does_not_upscale() {
        assert_eq!(calculate_proxy_dimensions(640, 360), Some((640, 360)));
    }

    #[test]
    fn detects_stale_size() {
        assert!(source_is_stale(&snapshot(10, "a"), &snapshot(11, "a")));
    }

    #[test]
    fn detects_stale_modified_at() {
        assert!(source_is_stale(&snapshot(10, "a"), &snapshot(10, "b")));
    }

    #[test]
    fn selects_cpu_when_nvenc_validation_fails() {
        assert_eq!(select_encoder(true, false), "libx264");
    }

    #[test]
    fn selects_nvenc_only_after_validation() {
        assert_eq!(select_encoder(true, true), "h264_nvenc");
    }

    #[test]
    fn missing_proxy_is_invalid() {
        let temp = TempDir::new().unwrap();
        assert!(!proxy_is_valid(
            &manifest(snapshot(10, "a")),
            "28f4037d-8aa4-4c7b-a194-2e4437ea2d9b",
            &snapshot(10, "a"),
            &temp.path().join("missing.mp4")
        ));
    }

    #[test]
    fn existing_matching_proxy_is_valid() {
        let temp = TempDir::new().unwrap();
        let file = temp.path().join("proxy.mp4");
        std::fs::write(&file, b"proxy").unwrap();
        assert!(proxy_is_valid(
            &manifest(snapshot(10, "a")),
            "28f4037d-8aa4-4c7b-a194-2e4437ea2d9b",
            &snapshot(10, "a"),
            &file
        ));
    }
}
