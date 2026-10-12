// Rust-Seite von di-drop. Bewusst schlank: Hier landen nur Dinge, die das
// Frontend nicht selbst kann (Dateisystem, Laufwerke, Bildverarbeitung …).
// Datenbank und Dialoge kommen als fertige Tauri-Plugins.

pub mod media;
mod cloudflare;
mod geocode;
mod places;
mod menu;

use std::path::{Path, PathBuf};

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Findet Bilder/Videos in den übergebenen Dateien und Ordnern (rekursiv)
#[tauri::command]
async fn scan_media(paths: Vec<String>) -> Result<media::ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || media::scan(&paths))
        .await
        .map_err(|e| e.to_string())
}

/// Kopiert Dateien in ihre Zielordner und erzeugt Vorschaubilder
#[tauri::command]
async fn import_media(
    app: AppHandle,
    items: Vec<media::ImportItem>,
    on_progress: Channel<media::ImportProgress>,
) -> Result<Vec<media::ImportResult>, String> {
    let thumbs_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbs");
    tauri::async_runtime::spawn_blocking(move || {
        media::import(items, &thumbs_dir, |p| {
            let _ = on_progress.send(p);
        })
    })
    .await
    .map_err(|e| e.to_string())
}

/// Öffnet eine Datei oder einen Ordner mit dem Standardprogramm (Vorschau, Fotos, Finder, Explorer)
#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("Nicht gefunden: {path}"));
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// Zeigt eine Datei im Finder bzw. Explorer
#[tauri::command]
fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("Nicht gefunden: {path}"));
    }
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png"];

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Liefert eine Bilddatei als Bytes (für die Vergleichsbild-Vorschau im Frontend)
#[tauri::command]
async fn read_image(path: String) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    if !is_image(&path) {
        return Err("Nur Bilddateien".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Speichert ein im Frontend erzeugtes Bild. Pfad im Header "x-path" (URL-kodiert),
/// Bilddaten als Rohdaten. Existiert die Datei schon, wird "_2", "_3" … angehängt.
/// Gibt den tatsächlichen Pfad zurück.
#[tauri::command]
fn write_image(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let header = request.headers().get("x-path").and_then(|h| h.to_str().ok()).ok_or("Pfad fehlt")?;
    let path = PathBuf::from(percent_decode(header)?);
    if !is_image(&path) {
        return Err("Nur .jpg oder .png".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Bilddaten fehlen".into());
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let target = media::unique_path(&path);
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    Ok(target.display().to_string())
}

/// Benennt eine Bild-/Videodatei um (bleibt im selben Ordner). Ist der Zielname schon von
/// einer *anderen* Datei belegt, wird "_2", "_3" … angehängt. Gibt den tatsächlichen Pfad zurück.
#[tauri::command]
fn rename_file(from: String, to: String) -> Result<String, String> {
    media::rename_file(Path::new(&from), Path::new(&to)).map(|p| p.display().to_string())
}

/// Ordner umbenennen (für sprechende Ordnernamen der Aufträge)
#[tauri::command]
fn rename_dir(from: String, to: String) -> Result<String, String> {
    media::rename_dir(Path::new(&from), Path::new(&to)).map(|p| p.display().to_string())
}

/// Öffnet eine Webseite im Standard-Browser (z. B. Karten, Cloudflare). Nur https.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Nur https-Adressen".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

fn percent_decode(s: &str) -> Result<String, String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // macOS: deutsches Menü; App-Befehle gehen als Ereignis "menu" an die Oberfläche
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|app| menu::build(app)).on_menu_event(|app, event| {
        use tauri::Emitter;
        let _ = app.emit("menu", event.id().0.as_str());
    });

    builder
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_media, import_media, open_path, reveal_path, read_image, write_image, rename_file, rename_dir, open_url,
            cloudflare::cf_set_token, cloudflare::cf_has_token, cloudflare::cf_delete_token,
            geocode::reverse_geocode,
            places::places_info, places::places_read, places::places_update,
            cloudflare::cf_api, cloudflare::cf_upload_worker])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von di-drop");
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_percent_encoded_paths() {
        assert_eq!(super::percent_decode("/Bilder/Test%C3%BCbung%20A/x.jpg").unwrap(), "/Bilder/Testübung A/x.jpg");
    }
}
