use crate::project_storage::{AssetDecision, EdlManifest};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

pub(crate) fn edited_time(edl: &EdlManifest, source_us: u64) -> u64 {
    let mut removed: Vec<(u64, u64)> = edl
        .tracks
        .cuts
        .iter()
        .filter(|cut| cut.action == "remove")
        .map(|cut| (cut.start_us, cut.end_us.min(source_us)))
        .filter(|(start, end)| end > start)
        .collect();
    removed.sort_unstable();
    let mut sum = 0;
    let mut current: Option<(u64, u64)> = None;
    for (start, end) in removed {
        current = Some(match current {
            Some((a, b)) if start <= b => (a, b.max(end)),
            Some((a, b)) => {
                sum += b - a;
                (start, end)
            }
            None => (start, end),
        });
    }
    if let Some((a, b)) = current {
        sum += b - a;
    }
    source_us.saturating_sub(sum)
}

pub(crate) fn active_audio_assets(edl: &EdlManifest) -> Vec<&AssetDecision> {
    edl.tracks
        .assets
        .iter()
        .filter(|item| !item.muted && item.kind != "overlay")
        .collect()
}

pub(crate) fn seamless_music_loop(
    path: &Path,
    duration_us: u64,
    cache: &Path,
) -> Result<(PathBuf, u64), String> {
    if duration_us < 1_000_000 {
        return Ok((path.to_path_buf(), duration_us));
    }
    let fade_us = 350_000_u64.min(duration_us / 4);
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let mut hash = DefaultHasher::new();
    path.hash(&mut hash);
    metadata.len().hash(&mut hash);
    metadata.modified().ok().hash(&mut hash);
    fade_us.hash(&mut hash);
    fs::create_dir_all(cache).map_err(|error| error.to_string())?;
    let output = cache.join(format!("{:016x}.flac", hash.finish()));
    let cycle_us = duration_us - fade_us;
    if output.is_file() {
        return Ok((output, cycle_us));
    }
    let temp = output.with_extension("tmp.flac");
    let duration = seconds(duration_us);
    let fade = seconds(fade_us);
    let tail = seconds(duration_us - fade_us);
    let graph = format!("[0:a:0]aresample=48000,asplit=3[body0][tail0][head0];[body0]atrim=start={fade}:end={tail},asetpts=PTS-STARTPTS[body];[tail0]atrim=start={tail}:end={duration},asetpts=PTS-STARTPTS[tail];[head0]atrim=start=0:end={fade},asetpts=PTS-STARTPTS[head];[tail][head]acrossfade=d={fade}[seam];[body][seam]concat=n=2:v=0:a=1[out]");
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(path)
        .args(["-filter_complex", &graph, "-map", "[out]", "-c:a", "flac"])
        .arg(&temp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let rendered = cmd.output().map_err(|error| error.to_string())?;
    if !rendered.status.success() {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "No se pudo preparar el loop musical: {}",
            String::from_utf8_lossy(&rendered.stderr)
        ));
    }
    fs::rename(&temp, &output).map_err(|error| error.to_string())?;
    Ok((output, cycle_us))
}

#[derive(Clone, Copy)]
pub(crate) struct AudioAssetInput<'a> {
    pub(crate) index: usize,
    pub(crate) item: &'a AssetDecision,
    pub(crate) start_us: u64,
    pub(crate) end_us: u64,
}

fn seconds(us: u64) -> String {
    format!("{:.6}", us as f64 / 1_000_000.0)
}

pub(crate) fn audio_mix_graph(
    edl: &EdlManifest,
    asset_inputs: &[AudioAssetInput<'_>],
    source_filters: &str,
    window_start_us: u64,
    window_end_us: u64,
    source_audio_present: bool,
) -> Option<String> {
    let active: Vec<_> = asset_inputs
        .iter()
        .filter_map(|input| {
            let start = input.start_us.max(window_start_us);
            let end = input.end_us.min(window_end_us);
            (end > start).then_some((*input, start, end))
        })
        .collect();
    if active.is_empty() {
        return None;
    }
    let mut graph = Vec::<String>::new();
    let source = if source_filters.is_empty() {
        "anull"
    } else {
        source_filters
    };
    let sidechains = active
        .iter()
        .filter(|(input, _, _)| input.item.kind == "music" && input.item.ducking)
        .count();
    let base = if source_audio_present {
        format!(
            "[0:a:{}]{source}",
            crate::export::selected_audio_stream(edl)
        )
    } else {
        format!(
            "anullsrc=r=48000:cl=stereo,atrim=duration={},asetpts=PTS-STARTPTS",
            seconds(window_end_us - window_start_us)
        )
    };
    if sidechains == 0 {
        graph.push(format!("{base}[base]"));
    } else {
        let outputs = (0..sidechains)
            .map(|index| format!("[side{index}]"))
            .collect::<String>();
        graph.push(format!("{base},asplit={}[base]{outputs}", sidechains + 1));
    }
    let mut duck_index = 0;
    let mut mix_inputs = vec!["[base]".to_string()];
    for (slot, (input, start, end)) in active.iter().enumerate() {
        let item = input.item;
        let output_start = start.saturating_sub(window_start_us);
        let duration = end - start;
        let elapsed = start.saturating_sub(input.start_us);
        let trim_start = if item.loop_ && item.source_duration_us > 0 {
            elapsed % item.source_duration_us
        } else {
            elapsed
        };
        let gain = item.gain_db.clamp(-60.0, 12.0);
        let mut filters = vec![
            format!(
                "atrim=start={}:duration={}",
                seconds(trim_start),
                seconds(duration)
            ),
            "asetpts=PTS-STARTPTS".into(),
            "aresample=48000".into(),
            format!("volume={gain:.2}dB"),
        ];
        if item.fade_in_us > 0 && elapsed < item.fade_in_us {
            let fade = item.fade_in_us.saturating_sub(elapsed).min(duration);
            filters.push(format!("afade=t=in:st=0:d={}", seconds(fade)));
        }
        let item_duration = input.end_us - input.start_us;
        if item.fade_out_us > 0 && *end == input.end_us {
            let fade = item.fade_out_us.min(duration).min(item_duration);
            filters.push(format!(
                "afade=t=out:st={}:d={}",
                seconds(duration - fade),
                seconds(fade)
            ));
        }
        filters.push(format!("adelay={}:all=1", output_start / 1_000));
        let prepared = format!("asset{slot}");
        graph.push(format!(
            "[{}:a:0]{}[{prepared}]",
            input.index,
            filters.join(",")
        ));
        if item.kind == "music" && item.ducking {
            let ratio = match item.duck_db {
                value if value <= -16.0 => 12,
                value if value <= -9.0 => 7,
                _ => 4,
            };
            let ducked = format!("duck{slot}");
            graph.push(format!("[{prepared}][side{duck_index}]sidechaincompress=threshold=0.03:ratio={ratio}:attack={}:release={}[{ducked}]", item.attack_ms.clamp(10, 2000), item.release_ms.clamp(50, 5000)));
            mix_inputs.push(format!("[{ducked}]"));
            duck_index += 1;
        } else {
            mix_inputs.push(format!("[{prepared}]"));
        }
    }
    graph.push(format!(
        "{}amix=inputs={}:duration=longest:dropout_transition=0,alimiter=limit=0.95[aout]",
        mix_inputs.join(""),
        mix_inputs.len()
    ));
    Some(graph.join(";"))
}

pub(crate) fn overlay_graph(
    overlays: &[(usize, &AssetDecision)],
    video_filters: &str,
    edl: &EdlManifest,
    input_label: &str,
) -> Option<String> {
    if overlays.is_empty() {
        return None;
    }
    let mut graph = Vec::new();
    graph.push(format!(
        "[{input_label}]{}[video0]",
        if video_filters.is_empty() {
            "null"
        } else {
            video_filters
        }
    ));
    for (slot, (index, item)) in overlays.iter().enumerate() {
        let start = edited_time(edl, item.start_us);
        let end = edited_time(edl, item.end_us);
        let scale = item.scale.clamp(0.05, 1.0);
        let opacity = item.opacity.clamp(0.0, 1.0);
        graph.push(format!("[{index}:v:0]format=rgba,scale=iw*{scale:.3}:ih*{scale:.3},colorchannelmixer=aa={opacity:.3},setpts=PTS-STARTPTS+{}/TB[overlay{slot}]", seconds(start)));
        graph.push(format!("[video{slot}][overlay{slot}]overlay=x='(W-w)*{:.3}':y='(H-h)*{:.3}':eof_action=pass:enable='between(t,{},{})'[video{}]", item.position_x.clamp(0.0, 1.0), item.position_y.clamp(0.0, 1.0), seconds(start), seconds(end), slot + 1));
    }
    graph.push(format!("[video{}]null[vout]", overlays.len()));
    Some(graph.join(";"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_time_maps_through_removed_cuts() {
        let mut edl: EdlManifest = serde_json::from_str(r#"{"schemaVersion":1,"projectId":"p","sourceId":"s","sourceDurationUs":10000000,"timebase":{"unit":"microseconds"},"tracks":{"cuts":[{"id":"c","startUs":2000000,"endUs":4000000,"action":"remove","confidence":null,"reason":null}],"camera":[],"broll":[],"audio":[]},"output":{"resolutionMode":"source","fpsMode":"source","aspectRatioMode":"source"},"updatedAt":"x"}"#).unwrap();
        assert_eq!(edited_time(&edl, 1_000_000), 1_000_000);
        assert_eq!(edited_time(&edl, 5_000_000), 3_000_000);
        edl.tracks.cuts.clear();
        assert_eq!(edited_time(&edl, 5_000_000), 5_000_000);
    }

    #[test]
    fn music_loop_preparation_creates_shorter_seamless_cycle() {
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let directory = tempfile::TempDir::new().unwrap();
        let source = directory.path().join("music.wav");
        let generated = Command::new("ffmpeg")
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=220:sample_rate=48000",
                "-t",
                "2",
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(generated.status.success());
        let (result, duration) =
            seamless_music_loop(&source, 2_000_000, &directory.path().join("cache")).unwrap();
        assert!(result.is_file());
        assert_eq!(duration, 1_650_000);
        let (cached, _) =
            seamless_music_loop(&source, 2_000_000, &directory.path().join("cache")).unwrap();
        assert_eq!(cached, result);
    }
}
