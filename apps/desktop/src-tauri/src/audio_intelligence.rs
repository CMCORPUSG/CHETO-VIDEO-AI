use crate::{export::selected_audio_stream, project_storage::ProjectStorage};
use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, RecvTimeoutError},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use webrtc_vad::{SampleRate, Vad, VadMode};

const DETECTOR_VERSION: &str = "webrtc-vad-0.4.0-quality-review-v2";
const SAMPLE_RATE: u64 = 16_000;
const FRAME_SAMPLES: usize = 480; // 30 ms at 16 kHz
const FRAME_US: u64 = 30_000;
const MIN_EVENT_US: u64 = 300_000;
const MAX_GAP_US: u64 = 300_000;
const REVIEW_SPLIT_AFTER_US: u64 = 20_000_000;
const REVIEW_HARD_LIMIT_US: u64 = 30_000_000;
const REVIEW_PAUSE_US: u64 = 120_000;
const MIN_ACTIVITY_RATIO: f64 = 0.45;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioEvent {
    pub id: String,
    pub event_type: String,
    pub original_label: String,
    pub start_us: u64,
    pub end_us: u64,
    // Fraction of VAD-positive frames in this interval, not a calibrated probability.
    pub confidence: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAnalysis {
    pub detector: String,
    pub events: Vec<AudioEvent>,
    pub audio_duration_us: u64,
    pub analysis_elapsed_ms: u64,
    pub realtime_factor: f64,
    pub cache_hit: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    project_id: &'a str,
    analyzed_us: u64,
    duration_us: u64,
}

trait AudioEventDetector {
    fn detect_frame(&mut self, frame: &[i16]) -> Result<bool, String>;
}

struct WebRtcSpeechDetector(Vad);

impl Default for WebRtcSpeechDetector {
    fn default() -> Self {
        Self(Vad::new_with_rate_and_mode(
            SampleRate::Rate16kHz,
            VadMode::Quality,
        ))
    }
}

impl AudioEventDetector for WebRtcSpeechDetector {
    fn detect_frame(&mut self, frame: &[i16]) -> Result<bool, String> {
        self.0
            .is_voice_segment(frame)
            .map_err(|_| "El detector rechazó un frame de audio.".to_string())
    }
}

#[derive(Default)]
struct SegmentBuilder {
    start: Option<u64>,
    last_voice_end: u64,
    positives: u64,
    total: u64,
    events: Vec<AudioEvent>,
}

impl SegmentBuilder {
    fn push(&mut self, start_us: u64, voiced: bool) {
        if let Some(segment_start) = self.start {
            let elapsed = start_us.saturating_sub(segment_start);
            let pause = start_us.saturating_sub(self.last_voice_end);
            if elapsed >= REVIEW_HARD_LIMIT_US
                || (!voiced && elapsed >= REVIEW_SPLIT_AFTER_US && pause >= REVIEW_PAUSE_US)
            {
                self.finish();
            }
        }
        if voiced {
            if self.start.is_none() {
                self.start = Some(start_us);
                self.positives = 0;
                self.total = 0;
            }
            self.last_voice_end = start_us + FRAME_US;
        }
        if self.start.is_some() {
            self.total += 1;
            if voiced {
                self.positives += 1;
            } else if start_us.saturating_sub(self.last_voice_end) >= MAX_GAP_US {
                self.finish();
            }
        }
    }

    fn finish(&mut self) {
        if let Some(start_us) = self.start.take() {
            let activity = self.positives as f64 / self.total.max(1) as f64;
            if self.last_voice_end.saturating_sub(start_us) >= MIN_EVENT_US
                && activity >= MIN_ACTIVITY_RATIO
            {
                self.events.push(AudioEvent {
                    id: format!("speech-{start_us}"),
                    event_type: "voice".into(),
                    original_label: "Voz probable · WebRTC VAD".into(),
                    start_us,
                    end_us: self.last_voice_end,
                    confidence: activity,
                });
            }
        }
        self.positives = 0;
        self.total = 0;
    }
}

fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_key(source: &Path, metadata: &fs::Metadata, stream: usize) -> String {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata.modified().ok().hash(&mut hasher);
    stream.hash(&mut hasher);
    DETECTOR_VERSION.hash(&mut hasher);
    SAMPLE_RATE.hash(&mut hasher);
    format!("{:016x}.json", hasher.finish())
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

fn run_analysis<F: Fn(u64)>(
    source: &Path,
    stream: usize,
    cancelled: &AtomicBool,
    progress: F,
) -> Result<AudioAnalysis, String> {
    let started = Instant::now();
    let mut command = Command::new("ffmpeg");
    command
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
        .arg(source)
        .arg("-map")
        .arg(format!("0:a:{stream}"))
        .args(["-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("No se pudo iniciar FFmpeg: {error}"))?;
    let mut stdout = child.stdout.take().ok_or("FFmpeg no abrió el audio.")?;
    let (sender, receiver) = sync_channel::<Result<Option<[u8; FRAME_SAMPLES * 2]>, String>>(32);
    let reader = thread::spawn(move || loop {
        let mut bytes = [0u8; FRAME_SAMPLES * 2];
        let mut filled = 0;
        while filled < bytes.len() {
            match stdout.read(&mut bytes[filled..]) {
                Ok(0) => break,
                Ok(count) => filled += count,
                Err(error) => {
                    let _ = sender.send(Err(error.to_string()));
                    return;
                }
            }
        }
        if filled < bytes.len() {
            let _ = sender.send(Ok(None));
            return;
        }
        if sender.send(Ok(Some(bytes))).is_err() {
            return;
        }
    });
    let mut detector = WebRtcSpeechDetector::default();
    let mut segments = SegmentBuilder::default();
    let mut frames = 0u64;
    let result = (|| -> Result<(), String> {
        loop {
            if cancelled.load(Ordering::Relaxed) {
                return Err("Análisis cancelado.".into());
            }
            let bytes = match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(Some(bytes))) => bytes,
                Ok(Ok(None)) => break,
                Ok(Err(error)) => return Err(error),
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("Se interrumpió la lectura de audio.".into())
                }
            };
            let mut frame = [0i16; FRAME_SAMPLES];
            for (sample, pair) in frame.iter_mut().zip(bytes.chunks_exact(2)) {
                *sample = i16::from_le_bytes([pair[0], pair[1]]);
            }
            let voiced = detector.detect_frame(&frame)?;
            segments.push(frames * FRAME_US, voiced);
            frames += 1;
            if frames % 100 == 0 {
                progress(frames * FRAME_US);
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = child.kill();
    }
    drop(receiver);
    let status = child.wait().map_err(|error| error.to_string())?;
    let _ = reader.join();
    result?;
    if !status.success() {
        return Err("FFmpeg no pudo decodificar el stream de audio.".into());
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("Análisis cancelado.".into());
    }
    segments.finish();
    let elapsed = started.elapsed();
    let analyzed_us = frames * FRAME_US;
    Ok(AudioAnalysis {
        detector: DETECTOR_VERSION.into(),
        events: segments.events,
        audio_duration_us: analyzed_us,
        analysis_elapsed_ms: elapsed.as_millis() as u64,
        realtime_factor: analyzed_us as f64 / (elapsed.as_secs_f64() * 1_000_000.0).max(1.0),
        cache_hit: false,
    })
}

#[tauri::command]
pub async fn analyze_audio_events(
    app: AppHandle,
    project_id: String,
) -> Result<AudioAnalysis, String> {
    let storage = ProjectStorage::from_app(&app).map_err(|error| error.message)?;
    let bundle = storage
        .load_project(&project_id)
        .map_err(|error| error.message)?;
    if bundle.source.streams.audio == 0 {
        return Err("El video no tiene audio.".into());
    }
    let stream = selected_audio_stream(&bundle.edl);
    if stream >= bundle.source.streams.audio as usize {
        return Err("La pista de audio elegida ya no existe.".into());
    }
    let source = PathBuf::from(&bundle.source.path);
    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;
    let duration_us = bundle
        .source
        .duration_us
        .ok_or("El video no tiene duración válida.")?;
    let directory = storage
        .project_dir(&project_id)
        .map_err(|error| error.message)?
        .join("media")
        .join("audio-intelligence");
    let destination = directory.join(cache_key(&source, &metadata, stream));
    if let Ok(bytes) = fs::read(&destination) {
        if let Ok(mut cached) = serde_json::from_slice::<AudioAnalysis>(&bytes) {
            cached.cache_hit = true;
            return Ok(cached);
        }
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = jobs().lock().map_err(|error| error.to_string())?;
        if active.contains_key(&project_id) {
            return Err("Ya se está analizando este proyecto.".into());
        }
        active.insert(project_id.clone(), cancel.clone());
    }
    let job_id = project_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let analysis = run_analysis(&source, stream, &cancel, |analyzed_us| {
            let _ = app.emit(
                "audio-ai-progress",
                Progress {
                    project_id: &job_id,
                    analyzed_us: analyzed_us.min(duration_us),
                    duration_us,
                },
            );
        })?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Análisis cancelado.".into());
        }
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let temporary = destination.with_extension("json.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec(&analysis).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if cancel.load(Ordering::Relaxed) {
            let _ = fs::remove_file(temporary);
            return Err("Análisis cancelado.".into());
        }
        fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
        Ok(analysis)
    })
    .await
    .map_err(|error| error.to_string())?;
    jobs()
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&project_id);
    result
}

#[tauri::command]
pub fn cancel_audio_events(project_id: String) -> Result<(), String> {
    if let Some(cancel) = jobs()
        .lock()
        .map_err(|error| error.to_string())?
        .get(&project_id)
    {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_short_gaps_and_rejects_tiny_regions() {
        let mut builder = SegmentBuilder::default();
        for frame in 0..10 {
            builder.push(frame * FRAME_US, true);
        }
        for frame in 10..16 {
            builder.push(frame * FRAME_US, false);
        }
        for frame in 16..28 {
            builder.push(frame * FRAME_US, true);
        }
        builder.finish();
        assert_eq!(builder.events.len(), 1);
        assert_eq!(builder.events[0].start_us, 0);
        assert_eq!(builder.events[0].end_us, 840_000);
        let mut tiny = SegmentBuilder::default();
        tiny.push(0, true);
        tiny.finish();
        assert!(tiny.events.is_empty());
        let mut sparse = SegmentBuilder {
            start: Some(0),
            last_voice_end: 600_000,
            positives: 2,
            total: 20,
            ..Default::default()
        };
        sparse.finish();
        assert!(sparse.events.is_empty());
    }

    #[test]
    fn long_vad_activity_is_split_into_reviewable_segments() {
        let mut builder = SegmentBuilder::default();
        for frame in 0..(75_000_000 / FRAME_US) {
            // A real phrase pause after 22 s is preferred to the hard limit.
            let voiced = !(740..746).contains(&frame);
            builder.push(frame * FRAME_US, voiced);
        }
        builder.finish();
        assert!(builder.events.len() >= 3);
        assert!(builder
            .events
            .iter()
            .all(|event| event.end_us - event.start_us <= REVIEW_HARD_LIMIT_US + FRAME_US));
        assert!(builder.events[0].end_us <= 22_300_000);
    }

    #[test]
    fn cache_key_tracks_file_and_stream() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let first = fs::metadata(file.path()).unwrap();
        let key = cache_key(file.path(), &first, 0);
        assert_ne!(key, cache_key(file.path(), &first, 1));
        fs::write(file.path(), b"changed").unwrap();
        let second = fs::metadata(file.path()).unwrap();
        assert_ne!(key, cache_key(file.path(), &second, 0));
    }

    #[test]
    fn vad_does_not_call_silence_speech() {
        let mut detector = WebRtcSpeechDetector::default();
        assert!(!detector.detect_frame(&[0; FRAME_SAMPLES]).unwrap());
    }

    #[test]
    fn streams_real_ffmpeg_audio_and_can_cancel() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let directory = tempfile::TempDir::new().unwrap();
        let source = directory.path().join("tone.wav");
        let status = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "5",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(status.success());
        let result = run_analysis(&source, 0, &AtomicBool::new(false), |_| {}).unwrap();
        assert!(result.audio_duration_us >= 4_950_000);
        assert!(result.audio_duration_us <= 5_010_000);
        assert!(result.realtime_factor > 0.0);
        eprintln!(
            "5 s audio analyzed in {} ms ({:.1}x)",
            result.analysis_elapsed_ms, result.realtime_factor
        );
        let cancelled = run_analysis(&source, 0, &AtomicBool::new(true), |_| {});
        assert!(cancelled.unwrap_err().contains("cancelado"));
        let mid_run_cancel = AtomicBool::new(false);
        let stopped = run_analysis(&source, 0, &mid_run_cancel, |_| {
            mid_run_cancel.store(true, Ordering::Relaxed);
        });
        assert!(stopped.unwrap_err().contains("cancelado"));
    }

    #[test]
    fn qa_video_vad_segments_when_source_is_provided() {
        let Ok(path) = std::env::var("CHETO_QA_VIDEO") else {
            return;
        };
        let result = run_analysis(Path::new(&path), 0, &AtomicBool::new(false), |_| {}).unwrap();
        eprintln!(
            "QA_VAD durationUs={} segments={} maxSegmentUs={} elapsedMs={}",
            result.audio_duration_us,
            result.events.len(),
            result
                .events
                .iter()
                .map(|event| event.end_us - event.start_us)
                .max()
                .unwrap_or(0),
            result.analysis_elapsed_ms
        );
        for event in &result.events {
            eprintln!(
                "QA_VAD_SEGMENT startUs={} endUs={} activity={:.3}",
                event.start_us, event.end_us, event.confidence
            );
        }
        assert!(result
            .events
            .iter()
            .all(|event| event.end_us - event.start_us <= REVIEW_HARD_LIMIT_US + FRAME_US));
    }
}
