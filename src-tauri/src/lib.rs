// Rust-Seite von di-drop. Bewusst schlank: Hier landen nur Dinge, die das
// Frontend nicht selbst kann (Dateisystem, Laufwerke, Uploads …).
// Datenbank und Dialoge kommen als fertige Tauri-Plugins.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von di-drop");
}
