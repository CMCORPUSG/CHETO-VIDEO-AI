mod media_ingest;
mod project_storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            media_ingest::check_media_source,
            media_ingest::detect_ffprobe,
            media_ingest::probe_media,
            project_storage::initialize_project_storage,
            project_storage::project_manifest_exists,
            project_storage::initialize_project_manifest,
            project_storage::load_project_bundle,
            project_storage::save_project_manifest,
            project_storage::save_project_edl,
            project_storage::update_project_source,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar CHETO VIDEO AI");
}
