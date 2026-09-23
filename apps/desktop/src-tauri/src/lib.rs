mod hardware_profile;
mod media_ingest;
mod media_proxy;
mod project_storage;
mod proxy_ffmpeg;
mod proxy_model;
mod transcription;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(proxy_ffmpeg::ProxyManager::default())
        .manage(transcription::TranscriptionManager::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            media_ingest::check_media_source,
            hardware_profile::detect_hardware_profile,
            hardware_profile::select_transcription_profile,
            media_ingest::detect_ffprobe,
            media_ingest::probe_media,
            media_proxy::cancel_proxy,
            media_proxy::create_proxy,
            media_proxy::delete_proxy,
            media_proxy::get_playback_source,
            media_proxy::get_proxy_status,
            project_storage::initialize_project_storage,
            project_storage::project_manifest_exists,
            project_storage::initialize_project_manifest,
            project_storage::load_project_bundle,
            project_storage::save_project_manifest,
            project_storage::save_project_edl,
            project_storage::update_project_source,
            transcription::cancel_transcription,
            transcription::download_transcription_model,
            transcription::get_transcript_status,
            transcription::get_transcription_model_status,
            transcription::start_transcription,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar CHETO VIDEO AI");
}
