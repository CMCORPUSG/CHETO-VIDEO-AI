mod export;
mod hardware_profile;
mod media_ingest;
mod media_proxy;
mod project_storage;
mod proxy_ffmpeg;
mod proxy_model;
mod smart_camera;
mod smart_cut;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(proxy_ffmpeg::ProxyManager::default())
        .manage(export::ExportManager::default())
        .manage(smart_camera::SmartCameraManager::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            export::cancel_export,
            export::open_export_file,
            export::reveal_export_file,
            export::start_export,
            hardware_profile::detect_hardware_profile,
            media_ingest::check_media_source,
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
            smart_camera::analyze_smart_camera,
            smart_camera::apply_smart_camera_to_edl,
            smart_camera::cancel_smart_camera,
            smart_camera::get_smart_camera,
            smart_camera::review_smart_camera,
            smart_cut::analyze_smart_cut,
            smart_cut::apply_smart_cut_to_edl,
            smart_cut::get_smart_cut,
            smart_cut::review_smart_cut_suggestion,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar CHETO VIDEO AI");
}
