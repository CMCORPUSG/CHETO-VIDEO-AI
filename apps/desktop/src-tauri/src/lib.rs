mod asset_library;
mod asset_mix;
mod audio_intelligence;
mod audio_preview;
mod chetopack;
mod conflicts;
mod cover;
mod diagnostics;
mod export;
mod hardware_profile;
mod media_ingest;
mod media_proxy;
mod project_storage;
mod proxy_ffmpeg;
mod proxy_model;
mod smart_camera;
mod smart_cut;
mod template_engine;
mod timeline_media;
mod visual_render;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(proxy_ffmpeg::ProxyManager::default())
        .manage(export::ExportManager::default())
        .manage(export::PreviewManager::default())
        .manage(smart_camera::SmartCameraManager::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            chetopack::inspect_chetopack,
            chetopack::list_chetopacks,
            chetopack::verify_chetopack,
            chetopack::resolve_chetopack_resource,
            chetopack::install_chetopack,
            chetopack::uninstall_chetopack,
            chetopack::load_installed_templates,
            chetopack::export_chetopack,
            audio_intelligence::analyze_audio_events,
            audio_intelligence::cancel_audio_events,
            diagnostics::get_diagnostic_context,
            audio_preview::render_audio_preview,
            asset_library::enumerate_library_folder,
            asset_library::probe_library_asset,
            asset_library::library_asset_preview,
            asset_library::list_builtin_assets,
            export::cancel_export,
            export::open_export_file,
            export::reveal_export_file,
            export::start_export,
            export::render_result_chunk,
            export::cancel_result_preview,
            cover::get_project_cover,
            cover::save_project_cover,
            cover::remove_project_cover,
            cover::export_project_cover,
            hardware_profile::detect_hardware_profile,
            hardware_profile::export_disk_space,
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
            project_storage::preview_reanalysis_cleanup,
            project_storage::apply_reanalysis_cleanup,
            project_storage::update_project_source,
            smart_camera::analyze_smart_camera,
            smart_camera::apply_smart_camera_to_edl,
            smart_camera::cancel_smart_camera,
            smart_camera::get_smart_camera,
            smart_camera::review_smart_camera,
            smart_camera::review_all_smart_camera,
            smart_cut::analyze_smart_cut,
            smart_cut::apply_smart_cut_to_edl,
            smart_cut::get_smart_cut,
            smart_cut::review_smart_cut_suggestion,
            smart_cut::review_all_smart_cut_suggestions,
            timeline_media::get_import_thumbnail,
            timeline_media::get_timeline_thumbnail,
            timeline_media::get_timeline_waveform,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar CHETO VIDEO AI");
}
