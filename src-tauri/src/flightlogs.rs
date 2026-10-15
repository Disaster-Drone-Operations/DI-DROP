//! Flugprotokolle der DJI-Fernsteuerung (DJI Pilot 2: `DJIFlightRecord_YYYY-MM-DD_[HH-MM-SS].txt`).
//!
//! - Eckdaten lesen (Start, Dauer, Strecke, Akku …) mit `dji-log-parser`. Ab Format 13 sind die
//!   Messreihen verschlüsselt (dafür bräuchte es einen DJI-Schlüssel); die Eckdaten im Kopf der
//!   Datei sind es nicht und reichen für das Flugbuch.
//! - Übernehmen aus einem Ordner (USB-Stick, kopierter Ordner) oder direkt von der Fernsteuerung
//!   per MTP (`mtp-rs`: unter Windows über WPD, auf dem Mac über USB).
//! - Die Originaldateien werden unverändert in den Flugprotokoll-Ordner kopiert und behalten –
//!   für spätere, genauere Auswertungen. Vorhandene Dateien werden nie überschrieben.
//! - Mit dabei (Unterordner von FlightRecord, gleiche Struktur im Zielordner):
//!   `FlightTaskReplay/` (Flugwiedergabe, klein) immer, `MCDatFlightRecords/` (Rohdaten des
//!   Flugcontrollers, ca. 20 MB je Flug) nur mit `include_dat`.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Wo DJI-Apps auf der Fernsteuerung ihre Protokolle ablegen (Pilot 2 zuerst)
const DEVICE_FOLDERS: [&str; 4] = [
    "DJI/com.dji.industry.pilot/FlightRecord",
    "DJI/dji.go.v5/FlightRecord",
    "DJI/dji.fly/FlightRecord",
    "Android/data/com.dji.industry.pilot/files/FlightRecord",
];
const DJI_VENDOR_ID: u16 = 0x2ca3;
const REPLAY_DIR: &str = "FlightTaskReplay";
const DAT_DIR: &str = "MCDatFlightRecords";

#[derive(Serialize, Debug, Clone)]
pub struct Summary {
    pub file_name: String,
    pub path: String,
    pub size: u64,
    pub log_version: u8,
    pub start_time: String, // RFC 3339, UTC
    pub duration_s: f64,
    pub distance_m: f64,
    pub max_height_m: f64,
    pub max_speed_ms: f64,
    pub battery_sn: String,
    pub aircraft_name: String,
    pub aircraft_sn: String,
    pub rc_sn: String,
    pub camera_sn: String,
    pub latitude: f64,
    pub longitude: f64,
    pub photos: i64,
    pub video_s: i64,
    pub app_version: String,
}

#[derive(Serialize, Debug, Default)]
pub struct ImportReport {
    /// neu übernommene Flugprotokolle
    pub copied: usize,
    /// neu übernommene Zusatzdateien (FlightTaskReplay, auf Wunsch MCDatFlightRecords)
    pub extras_copied: usize,
    /// Eckdaten aller Dateien im Zielordner, die der Aufrufer noch nicht kannte
    pub summaries: Vec<Summary>,
    pub failed: Vec<(String, String)>,
}

pub fn is_log_name(name: &str) -> bool {
    name.starts_with("DJIFlightRecord_") && name.to_ascii_lowercase().ends_with(".txt")
}

/// Eckdaten eines Protokolls
pub fn summarize(path: &Path) -> Result<Summary, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let size = bytes.len() as u64;
    let log = dji_log_parser::DJILog::from_bytes(bytes).map_err(|e| format!("Kein lesbares DJI-Flugprotokoll: {e}"))?;
    let d = &log.details;
    Ok(Summary {
        file_name: path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string(),
        path: path.to_string_lossy().into_owned(),
        size,
        log_version: log.version,
        start_time: d.start_time.to_rfc3339(),
        duration_s: d.total_time,
        distance_m: f64::from(d.total_distance) * 1000.0, // DJI speichert Kilometer
        max_height_m: f64::from(d.max_height),
        max_speed_ms: f64::from(d.max_horizontal_speed),
        battery_sn: d.battery_sn.trim().to_string(),
        aircraft_name: d.aircraft_name.trim().to_string(),
        aircraft_sn: d.aircraft_sn.trim().to_string(),
        rc_sn: d.rc_sn.trim().to_string(),
        camera_sn: d.camera_sn.trim().to_string(),
        latitude: d.latitude,
        longitude: d.longitude,
        photos: i64::from(d.capture_num),
        video_s: i64::from(d.video_time),
        app_version: d.app_version.trim().to_string(),
    })
}

/// Gibt es die Datei im Zielordner schon (gleicher Name, gleiche Größe)?
fn already_there(dest_dir: &Path, name: &str, size: u64) -> bool {
    std::fs::metadata(dest_dir.join(name)).map(|m| m.len() == size).unwrap_or(false)
}

/// Freier Zielname: gleichnamige, aber andere Datei → "…_2.txt" (nie überschreiben)
fn free_target(dest_dir: &Path, name: &str) -> PathBuf {
    let mut n = 1;
    loop {
        let candidate = if n == 1 { name.to_string() } else { crate::transfer::suffixed(name, n) };
        let path = dest_dir.join(&candidate);
        if !path.exists() {
            return path;
        }
        n += 1;
    }
}

/// Schreibt erst in eine Zwischendatei und benennt dann um – nie eine halbe Datei
fn write_new(dest_dir: &Path, name: &str, data: &[u8]) -> Result<(), String> {
    let target = free_target(dest_dir, name);
    let part = target.with_file_name(format!("{}.didrop-part", target.file_name().unwrap().to_string_lossy()));
    std::fs::write(&part, data).map_err(|e| e.to_string())?;
    std::fs::rename(&part, &target).map_err(|e| e.to_string())
}

/// Alle Protokolle im Zielordner, die der Aufrufer noch nicht kennt, auslesen
fn summarize_unknown(dest_dir: &Path, known: &HashSet<String>, report: &mut ImportReport) {
    let Ok(entries) = std::fs::read_dir(dest_dir) else { return };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| is_log_name(n) && !known.contains(n)))
        .collect();
    paths.sort();
    for path in paths {
        match summarize(&path) {
            Ok(s) => report.summaries.push(s),
            Err(e) => report.failed.push((path.file_name().unwrap().to_string_lossy().into_owned(), e)),
        }
    }
}

/// Protokolldateien in einem Ordner (oder darunter, z. B. ein ganzer USB-Stick)
fn find_logs(src: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(src)
        .max_depth(8)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file() && is_log_name(&e.file_name().to_string_lossy()))
        .map(|e| e.into_path())
        .collect()
}

/// Übernehmen aus einem Ordner (USB-Stick, kopierter FlightRecord-Ordner …)
/// Ordner-Bäume FlightTaskReplay / MCDatFlightRecords unter `src` in den Zielordner übernehmen
fn copy_extras(src: &Path, dest_dir: &Path, include_dat: bool, report: &mut ImportReport) {
    let wanted = |name: &str| name == REPLAY_DIR || (include_dat && name == DAT_DIR);
    let roots: Vec<PathBuf> = walkdir::WalkDir::new(src)
        .max_depth(8)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_dir() && wanted(&e.file_name().to_string_lossy()))
        .map(|e| e.into_path())
        .collect();
    for root in roots {
        let name = root.file_name().unwrap().to_owned();
        for entry in walkdir::WalkDir::new(&root).into_iter().flatten().filter(|e| e.file_type().is_file()) {
            let Ok(rel) = entry.path().strip_prefix(&root) else { continue };
            let target_dir = dest_dir.join(&name).join(rel.parent().unwrap_or(Path::new("")));
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if already_there(&target_dir, &file_name, size) {
                continue;
            }
            let result = std::fs::create_dir_all(&target_dir)
                .map_err(|e| e.to_string())
                .and_then(|_| std::fs::read(entry.path()).map_err(|e| e.to_string()))
                .and_then(|data| write_new(&target_dir, &file_name, &data));
            match result {
                Ok(()) => report.extras_copied += 1,
                Err(e) => report.failed.push((file_name, e)),
            }
        }
    }
}

pub fn import_folder(src: &Path, dest_dir: &Path, known: &HashSet<String>, include_dat: bool) -> Result<ImportReport, String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("Ordner für Flugprotokolle nicht anlegbar: {e}"))?;
    let mut report = ImportReport::default();
    for file in find_logs(src) {
        let name = file.file_name().unwrap().to_string_lossy().into_owned();
        let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        if already_there(dest_dir, &name, size) {
            continue;
        }
        match std::fs::read(&file).map_err(|e| e.to_string()).and_then(|data| write_new(dest_dir, &name, &data)) {
            Ok(()) => report.copied += 1,
            Err(e) => report.failed.push((name, e)),
        }
    }
    copy_extras(src, dest_dir, include_dat, &mut report);
    summarize_unknown(dest_dir, known, &mut report);
    Ok(report)
}

/// Nur auslesen, was schon im Zielordner liegt, aber noch nicht bekannt ist (Reparatur/Neuaufbau)
pub fn scan_local(dest_dir: &Path, known: &HashSet<String>) -> ImportReport {
    let mut report = ImportReport::default();
    summarize_unknown(dest_dir, known, &mut report);
    report
}

// ── Fernsteuerung (MTP) ──────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone)]
pub struct DeviceInfo {
    /// Kennung zum erneuten Öffnen (Seriennummer, sonst USB-Position)
    pub key: String,
    pub name: String,
}

#[derive(Serialize, Debug)]
pub struct DeviceStatus {
    pub device: DeviceInfo,
    pub folder: Option<String>,
    pub total: usize,
    pub new: usize,
}

pub fn is_dji(info: &mtp_rs::mtp::MtpDeviceInfo) -> bool {
    let text = format!("{} {}", info.manufacturer.as_deref().unwrap_or(""), info.product.as_deref().unwrap_or("")).to_lowercase();
    info.vendor_id == DJI_VENDOR_ID || text.contains("dji")
}

pub fn device_info(info: &mtp_rs::mtp::MtpDeviceInfo) -> DeviceInfo {
    // Über die USB-Position öffnen, nicht über die Seriennummer: unter Windows kennt WPD das Gerät
    // unter einer anderen Seriennummer als der USB-Deskriptor; open_by_location ordnet es dort
    // über Hersteller-/Produktkennung zu (siehe mtp-rs MtpDeviceBuilder::open_by_location).
    let key = format!("loc:{}", info.location_id);
    let name = [info.manufacturer.as_deref(), info.product.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    DeviceInfo { key, name: if name.trim().is_empty() { "DJI-Fernsteuerung".into() } else { name } }
}

/// Angeschlossene DJI-Geräte (ohne sie zu öffnen)
pub fn list_devices() -> Result<Vec<DeviceInfo>, String> {
    let devices = mtp_rs::mtp::MtpDevice::list_devices().map_err(|e| e.to_string())?;
    Ok(devices.iter().filter(|d| is_dji(d)).map(device_info).collect())
}

fn contains_any(text: &str, words: &[&str]) -> bool {
    let text = text.to_lowercase();
    words.iter().any(|w| text.contains(w))
}

fn mtp_error(e: mtp_rs::Error) -> String {
    let text = e.to_string();
    if cfg!(target_os = "macos") && contains_any(&text, &["busy", "exclusive", "claim", "access"]) {
        return "macOS hält die Fernsteuerung gerade selbst fest (Dienst „ptpcamerad“ für Fotos/Digitale Bilder). \
                Fotos-App schließen und die Fernsteuerung neu anstecken – oder den FlightRecord-Ordner über „Aus Ordner übernehmen …“ einlesen."
            .into();
    }
    format!("Fernsteuerung nicht lesbar: {text}")
}

async fn open_device(key: &str) -> Result<mtp_rs::mtp::MtpDevice, String> {
    use mtp_rs::mtp::MtpDevice;
    let opened = if let Some(sn) = key.strip_prefix("sn:") {
        MtpDevice::open_by_serial(sn).await
    } else {
        let location = key.strip_prefix("loc:").and_then(|l| l.parse().ok()).ok_or("Unbekanntes Gerät")?;
        MtpDevice::open_by_location(location).await
    };
    match opened {
        Ok(device) => Ok(device),
        // Windows: Zuordnung USB ↔ WPD hat nicht geklappt → direkt über WPD öffnen, aber nur ein DJI-Gerät
        #[cfg(windows)]
        Err(first) => {
            let device = MtpDevice::builder()
                .backend(mtp_rs::mtp::Backend::Wpd)
                .open_first()
                .await
                .map_err(|e| format!("{} (WPD: {e})", mtp_error(first)))?;
            let info = device.device_info();
            if format!("{} {}", info.manufacturer, info.model).to_lowercase().contains("dji") {
                Ok(device)
            } else {
                Err(format!("Fernsteuerung nicht gefunden – Windows meldet zuerst „{} {}“.", info.manufacturer, info.model))
            }
        }
        #[cfg(not(windows))]
        Err(error) => Err(mtp_error(error)),
    }
}

/// Fehlermeldung mit dem Schritt, an dem es hakt (für die Fehlersuche ohne Gerät beim Entwickler)
fn at_step(step: &str) -> impl Fn(String) -> String + '_ {
    move |e| format!("{e} [Schritt: {step}]")
}

/// Protokoll-Ordner auf dem Gerät suchen → (Speicher, Ordner, Pfad)
async fn find_log_folder(
    device: &mtp_rs::mtp::MtpDevice,
) -> Result<Option<(mtp_rs::mtp::Storage, mtp_rs::mtp::ObjectHandle, String)>, String> {
    for storage in device.storages().await.map_err(mtp_error).map_err(at_step("Speicher auflisten"))? {
        'candidates: for candidate in DEVICE_FOLDERS {
            let mut parent = None;
            for part in candidate.split('/') {
                let objects = storage.list_objects(parent).await.map_err(mtp_error).map_err(at_step("Ordner durchsuchen"))?;
                match objects.iter().find(|o| o.is_folder() && o.filename.eq_ignore_ascii_case(part)) {
                    Some(folder) => parent = Some(folder.handle),
                    None => continue 'candidates,
                }
            }
            if let Some(handle) = parent {
                return Ok(Some((storage, handle, candidate.to_string())));
            }
        }
    }
    Ok(None)
}

type Found = (mtp_rs::mtp::Storage, String, Vec<mtp_rs::mtp::ObjectInfo>, mtp_rs::mtp::ObjectHandle);

async fn device_logs(key: &str) -> Result<(DeviceInfo, Option<Found>), String> {
    let device = open_device(key).await.map_err(at_step("Gerät öffnen"))?;
    let info = device.device_info();
    let name = format!("{} {}", info.manufacturer, info.model).trim().to_string();
    let device_info = DeviceInfo { key: key.to_string(), name: if name.is_empty() { "DJI-Fernsteuerung".into() } else { name } };
    let Some((storage, folder, path)) = find_log_folder(&device).await? else { return Ok((device_info, None)) };
    let files = storage
        .list_objects(Some(folder))
        .await
        .map_err(mtp_error)
        .map_err(at_step("Protokolle auflisten"))?
        .into_iter()
        .filter(|o| !o.is_folder() && is_log_name(&o.filename))
        .collect();
    Ok((device_info, Some((storage, path, files, folder))))
}

/// Wie viele Protokolle liegen auf der Fernsteuerung, wie viele davon sind neu?
pub async fn device_status(key: &str, dest_dir: &Path) -> Result<DeviceStatus, String> {
    let (device, found) = device_logs(key).await?;
    Ok(match found {
        None => DeviceStatus { device, folder: None, total: 0, new: 0 },
        Some((_, path, files, _)) => DeviceStatus {
            device,
            folder: Some(path),
            total: files.len(),
            new: files.iter().filter(|f| !already_there(dest_dir, &f.filename, f.size)).count(),
        },
    })
}

/// Zusatzdateien auf dem Gerät: (Datei, Zielordner relativ zum Flugprotokoll-Ordner)
async fn device_extras(
    storage: &mtp_rs::mtp::Storage,
    folder: mtp_rs::mtp::ObjectHandle,
    include_dat: bool,
) -> Result<Vec<(mtp_rs::mtp::ObjectInfo, PathBuf)>, String> {
    let mut plan = Vec::new();
    for sub in storage.list_objects(Some(folder)).await.map_err(mtp_error)? {
        if !sub.is_folder() {
            continue;
        }
        if sub.filename == REPLAY_DIR {
            // FlightTaskReplay/<FTR_Record_…>/<Dateien>
            for flight in storage.list_objects(Some(sub.handle)).await.map_err(mtp_error)? {
                if flight.is_folder() {
                    for file in storage.list_objects(Some(flight.handle)).await.map_err(mtp_error)? {
                        if !file.is_folder() {
                            plan.push((file, PathBuf::from(REPLAY_DIR).join(&flight.filename)));
                        }
                    }
                } else {
                    plan.push((flight, PathBuf::from(REPLAY_DIR)));
                }
            }
        } else if include_dat && sub.filename == DAT_DIR {
            for file in storage.list_objects(Some(sub.handle)).await.map_err(mtp_error)? {
                if !file.is_folder() {
                    plan.push((file, PathBuf::from(DAT_DIR)));
                }
            }
        }
    }
    Ok(plan)
}

/// Neue Protokolle (und Zusatzdateien) von der Fernsteuerung übernehmen. progress(fertig, gesamt)
pub async fn device_import(
    key: &str,
    dest_dir: &Path,
    known: &HashSet<String>,
    include_dat: bool,
    progress: impl Fn(usize, usize),
) -> Result<ImportReport, String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("Ordner für Flugprotokolle nicht anlegbar: {e}"))?;
    let (_, found) = device_logs(key).await?;
    let mut report = ImportReport::default();
    if let Some((storage, _, files, folder)) = found {
        // Plan: erst die Flugprotokolle (wichtig, klein), dann die Zusatzdateien
        let mut plan: Vec<(mtp_rs::mtp::ObjectInfo, PathBuf, bool)> =
            files.into_iter().map(|f| (f, PathBuf::new(), true)).collect();
        match device_extras(&storage, folder, include_dat).await {
            Ok(extras) => plan.extend(extras.into_iter().map(|(f, dir)| (f, dir, false))),
            Err(e) => report.failed.push(("Zusatzdaten".into(), e)),
        }
        plan.retain(|(f, dir, _)| !already_there(&dest_dir.join(dir), &f.filename, f.size));
        progress(0, plan.len());
        for (i, (file, dir, is_log)) in plan.iter().enumerate() {
            let target = dest_dir.join(dir);
            let result = match std::fs::create_dir_all(&target) {
                Ok(()) => storage.download_to_vec(file.handle).await.map_err(mtp_error).map_err(at_step("Datei laden")),
                Err(e) => Err(e.to_string()),
            };
            match result.and_then(|data| write_new(&target, &file.filename, &data)) {
                Ok(()) if *is_log => report.copied += 1,
                Ok(()) => report.extras_copied += 1,
                Err(e) => report.failed.push((file.filename.clone(), e)),
            }
            progress(i + 1, plan.len());
        }
    }
    summarize_unknown(dest_dir, known, &mut report);
    Ok(report)
}

#[cfg(test)]
mod tests {
    #[test]
    fn recognizes_log_names() {
        assert!(super::is_log_name("DJIFlightRecord_2026-08-16_[01-03-08].txt"));
        assert!(!super::is_log_name("2026-07-07_17-02-33_FLY162.DAT"));
    }
}
