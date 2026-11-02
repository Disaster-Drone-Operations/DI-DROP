// Rust side of di-drop. Deliberately lean: only things the frontend can't do
// itself live here (file system, drives, image processing …).
// Database and dialogs come as ready-made Tauri plugins.

pub mod media;
mod cloudflare;
mod geocode;
mod places;
pub mod transfer;
pub mod flightlogs;
pub mod sdcard;
pub mod training;
mod app_update;
mod menu;

use std::path::{Path, PathBuf};

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Finds images/videos in the given files and folders (recursively)
#[tauri::command]
async fn scan_media(paths: Vec<String>) -> Result<media::ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || media::scan(&paths))
        .await
        .map_err(|e| e.to_string())
}

/// All images/videos below a folder, grouped by folder (names only – for scanning folder by folder)
#[tauri::command]
async fn list_media(root: String) -> Result<Vec<media::MediaDir>, String> {
    tauri::async_runtime::spawn_blocking(move || media::list(&root))
        .await
        .map_err(|e| e.to_string())
}

/// Copies files into their target folders and creates thumbnails
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

/// Thumbnail for a single image file (comparison images) → path in the thumbnail folder
#[tauri::command]
async fn make_thumbnail(app: AppHandle, path: String) -> Result<String, String> {
    let thumbs_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbs");
    tauri::async_runtime::spawn_blocking(move || media::thumbnail_for(Path::new(&path), &thumbs_dir))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().into_owned())
}

// ── Flight logs (src/flightlogs.rs) ──────────────────────────────────

#[derive(serde::Serialize, Clone)]
struct FlightLogProgress {
    done: usize,
    total: usize,
}

/// Import from a folder (USB stick, copied FlightRecord folder)
#[tauri::command]
async fn flightlogs_import_folder(src: String, dest: String, known: Vec<String>, include_dat: bool) -> Result<flightlogs::ImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        flightlogs::import_folder(Path::new(&src), Path::new(&dest), &known.into_iter().collect(), include_dat)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Logs in our own folder that the database doesn't know yet
#[tauri::command]
async fn flightlogs_scan_local(dest: String, known: Vec<String>) -> Result<flightlogs::ImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(flightlogs::scan_local(Path::new(&dest), &known.into_iter().collect())))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn flightlogs_devices() -> Result<Vec<flightlogs::DeviceInfo>, String> {
    flightlogs::list_devices()
}

#[tauri::command]
async fn flightlogs_device_status(key: String, dest: String) -> Result<flightlogs::DeviceStatus, String> {
    flightlogs::device_status(&key, Path::new(&dest)).await
}

#[tauri::command]
async fn flightlogs_device_import(
    key: String,
    dest: String,
    known: Vec<String>,
    include_dat: bool,
    on_progress: Channel<FlightLogProgress>,
) -> Result<flightlogs::ImportReport, String> {
    let known = known.into_iter().collect();
    flightlogs::device_import(&key, Path::new(&dest), &known, include_dat, |done, total| {
        let _ = on_progress.send(FlightLogProgress { done, total });
    })
    .await
}

/// Remote controller plugged in/out? → events "flightlogs:device" / "flightlogs:device-removed" to the UI
fn watch_flightlog_devices(app: AppHandle) {
    use futures_util::StreamExt;
    use tauri::Emitter;
    tauri::async_runtime::spawn(async move {
        let mut watch = match mtp_rs::mtp::watch_devices() {
            Ok(watch) => watch,
            Err(error) => return eprintln!("[flightlogs] device watching not possible: {error}"),
        };
        while let Some(event) = watch.next().await {
            match event {
                mtp_rs::mtp::HotplugEvent::Arrived(info) if flightlogs::is_dji(&info) => {
                    let _ = app.emit("flightlogs:device", flightlogs::device_info(&info));
                }
                mtp_rs::mtp::HotplugEvent::Left(info) if flightlogs::is_dji(&info) => {
                    let _ = app.emit("flightlogs:device-removed", flightlogs::device_info(&info));
                }
                _ => {}
            }
        }
    });
}

// ── Memory cards (src/sdcard.rs) ─────────────────────────────────────

#[tauri::command]
fn sdcard_list() -> Vec<sdcard::Card> {
    sdcard::list()
}

/// Deletes imported originals from the card – each one only after its copy was verified
#[tauri::command]
async fn sdcard_delete(root: String, items: Vec<sdcard::DeleteItem>, companions: bool) -> Result<sdcard::DeleteReport, String> {
    tauri::async_runtime::spawn_blocking(move || sdcard::delete_imported(Path::new(&root), &items, companions))
        .await
        .map_err(|e| e.to_string())?
}

/// Ejects a card ("Auswerfen") – the watcher then reports it as removed
#[tauri::command]
async fn sdcard_eject(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sdcard::eject(Path::new(&root))).await.map_err(|e| e.to_string())?
}

/// Memory card inserted/removed? → events "sdcard:inserted" / "sdcard:removed" to the UI.
/// A newly inserted card also brings di-drop to the front (Windows may only flash the taskbar
/// button – unless di-drop is the AutoPlay handler for memory cards)
fn watch_sdcards(app: AppHandle) {
    use tauri::Emitter;
    std::thread::spawn(move || {
        let removed_app = app.clone();
        sdcard::watch(
            |card| {
                bring_to_front(&app);
                let _ = app.emit("sdcard:inserted", card);
            },
            |card| {
                let _ = removed_app.emit("sdcard:removed", card);
            },
        )
    });
}

/// Main window to the front (also when minimized or di-drop is in the background)
fn bring_to_front(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ── Training mode (src/training.rs) ─────────────────────────────────

fn training_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("Schulung"))
}

/// Scenarios shipped with di-drop (tauri.conf.json → bundle.resources)
fn training_builtin(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok().map(|d| d.join("scenarios")).filter(|d| d.is_dir())
}

#[tauri::command]
fn training_list(app: AppHandle) -> Result<Vec<training::ScenarioInfo>, String> {
    Ok(training::list(&training_root(&app)?, training_builtin(&app).as_deref()))
}

#[tauri::command]
fn training_paths(app: AppHandle, id: String) -> Result<training::Paths, String> {
    training::paths(&training_root(&app)?, training_builtin(&app).as_deref(), &id)
}

#[tauri::command]
fn training_scenario(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    training::scenario_json(&training_root(&app)?, training_builtin(&app).as_deref(), &id)
}

#[tauri::command]
fn training_reset(app: AppHandle, id: String) -> Result<(), String> {
    training::reset(&training_root(&app)?, &id)
}

#[tauri::command]
async fn training_card(app: AppHandle, id: String, card: String) -> Result<String, String> {
    let (root, builtin) = (training_root(&app)?, training_builtin(&app));
    tauri::async_runtime::spawn_blocking(move || training::card(&root, builtin.as_deref(), &id, &card)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn training_stage_logs(app: AppHandle, id: String, files: Vec<String>) -> Result<String, String> {
    let (root, builtin) = (training_root(&app)?, training_builtin(&app));
    tauri::async_runtime::spawn_blocking(move || training::stage_logs(&root, builtin.as_deref(), &id, &files)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn training_log_placeholders(app: AppHandle, id: String, files: Vec<String>) -> Result<String, String> {
    let root = training_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || training::write_log_placeholders(&root, &id, &files)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn training_import(app: AppHandle, path: String) -> Result<training::ScenarioInfo, String> {
    let root = training_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || training::import(&root, Path::new(&path))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn training_cloud_list(app: AppHandle, id: String, path: String) -> Result<Vec<training::Folder>, String> {
    training::cloud_list(&training_root(&app)?, &id, &path)
}

#[tauri::command]
fn training_cloud_mkdir(app: AppHandle, id: String, path: String) -> Result<(), String> {
    training::cloud_mkdir(&training_root(&app)?, &id, &path)
}

/// Destination file of an upload into the simulated Nextcloud
#[tauri::command]
fn training_cloud_path(app: AppHandle, id: String, dir: String, file_name: String) -> Result<String, String> {
    transfer::check_file_name(&file_name)?;
    Ok(training::cloud_dir(&training_root(&app)?, &id, &dir)?.join(file_name).display().to_string())
}

/// Second window for the trainer (can be moved to another screen)
#[tauri::command]
async fn training_open_control(app: AppHandle, id: String) -> Result<(), String> {
    training::check_id(&id)?;
    if let Some(window) = app.get_webview_window("control") {
        let _ = window.unminimize();
        return window.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(&app, "control", tauri::WebviewUrl::App(format!("index.html?control={id}").into()))
        .title("di-drop – Schulungssteuerung")
        .inner_size(400.0, 760.0)
        .min_inner_size(340.0, 480.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn training_close_control(app: AppHandle) {
    if let Some(window) = app.get_webview_window("control") {
        let _ = window.close();
    }
}

/// Opens a file or folder with the default app (Preview, Photos, Finder, Explorer)
#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("Nicht gefunden: {path}"));
    }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// Reveals a file in Finder or Explorer
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

/// Returns an image file as bytes (for the comparison image preview in the frontend)
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

/// Saves an image created in the frontend. Path in the "x-path" header (URL-encoded),
/// image data as raw body. If the file already exists, "_2", "_3" … is appended.
/// Returns the actual path.
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

/// Saves the marked copy of an image ("…_markiert.JPG" next to it, with the original's metadata).
/// Original in the "x-original" header (URL-encoded), rendered JPEG as raw body → path of the copy
#[tauri::command]
fn write_marked(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let header = request.headers().get("x-original").and_then(|h| h.to_str().ok()).ok_or("Pfad fehlt")?;
    let original = PathBuf::from(percent_decode(header)?);
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Bilddaten fehlen".into());
    };
    media::marked::write(&original, bytes).map(|p| p.display().to_string())
}

/// Removes the marked copy of an image (markings deleted)
#[tauri::command]
fn remove_marked(original: String) -> Result<(), String> {
    media::marked::remove(Path::new(&original))
}

/// Renames an image/video file (stays in the same folder). If the target name is already taken
/// by a *different* file, "_2", "_3" … is appended. Returns the actual path.
#[tauri::command]
fn rename_file(from: String, to: String) -> Result<String, String> {
    media::rename_file(Path::new(&from), Path::new(&to)).map(|p| p.display().to_string())
}

/// Renames a folder (for descriptive assignment folder names)
#[tauri::command]
fn rename_dir(from: String, to: String) -> Result<String, String> {
    media::rename_dir(Path::new(&from), Path::new(&to)).map(|p| p.display().to_string())
}

/// Opens a web page in the default browser (e.g. maps, Cloudflare). https only – plus the AutoPlay page
/// of the Windows settings (instructions in Settings → Bildablage)
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://") && url != "ms-settings:autoplay" {
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

    // macOS: German menu; app commands go to the UI as "menu" event
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|app| menu::build(app)).on_menu_event(|app, event| {
        use tauri::Emitter;
        let _ = app.emit("menu", event.id().0.as_str());
    });

    builder
        // Must come first: started a second time (e.g. by Windows AutoPlay for a memory card, see
        // windows/hooks.nsh) → no second window, the running di-drop comes to the front instead.
        // The card itself is reported by the memory card watcher.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| bring_to_front(app)))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Auto-update from GitHub releases (signed, see docs/release.md) + restart afterwards
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_update::PendingUpdate::default())
        .setup(|app| {
            // Only once the menu is attached to the running app (shortly after start, on the main thread)
            #[cfg(target_os = "macos")]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    let inner = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        if let Err(error) = menu::register_special_menus(&inner) {
                            eprintln!("[menu] help/window menu not registered: {error}");
                        }
                    });
                });
            }
            watch_flightlog_devices(app.handle().clone());
            watch_sdcards(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![scan_media, list_media, import_media, open_path, reveal_path, read_image, write_image, write_marked, remove_marked, rename_file, rename_dir, open_url,
            cloudflare::cf_set_token, cloudflare::cf_has_token, cloudflare::cf_delete_token,
            geocode::reverse_geocode,
            make_thumbnail,
            app_update::app_update_check, app_update::app_update_install,
            flightlogs_import_folder, flightlogs_scan_local, flightlogs_devices,
            flightlogs_device_status, flightlogs_device_import,
            sdcard_list, sdcard_delete, sdcard_eject,
            training_list, training_paths, training_scenario, training_reset, training_card, training_stage_logs, training_log_placeholders,
            training_import, training_open_control, training_close_control,
            training_cloud_list, training_cloud_mkdir, training_cloud_path,
            places::places_info, places::places_read, places::places_update,
            transfer::commands::transfer_copy, transfer::commands::transfer_nextcloud, transfer::commands::transfer_cancel,
            transfer::commands::nc_account, transfer::commands::nc_login_start, transfer::commands::nc_login_poll,
            transfer::commands::nc_login_manual, transfer::commands::nc_test, transfer::commands::nc_forget,
            transfer::commands::nc_list, transfer::commands::nc_mkdir,
            cloudflare::cf_api, cloudflare::cf_upload_worker])
        .run(tauri::generate_context!())
        .expect("error while starting di-drop");
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_percent_encoded_paths() {
        assert_eq!(super::percent_decode("/Bilder/Test%C3%BCbung%20A/x.jpg").unwrap(), "/Bilder/Testübung A/x.jpg");
    }
}
