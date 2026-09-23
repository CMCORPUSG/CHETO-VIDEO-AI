mod media_ingest;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            media_ingest::check_media_source,
            media_ingest::detect_ffprobe,
            media_ingest::probe_media,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar CHETO VIDEO AI");
}
