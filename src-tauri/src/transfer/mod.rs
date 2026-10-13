//! Dateien bereitstellen: in einen Ordner kopieren (z. B. USB-Stick) oder in eine Nextcloud laden.
//! Beides meldet Fortschritt in Bytes und lässt sich jederzeit abbrechen (Pause, Abbruch,
//! Umsortieren der Warteschlange – die Steuerung liegt in app/services/upload_queue.js).
//!
//! Weitere Ziele: neues Untermodul mit einer Funktion, die Quelle, Ziel, Abbruch-Flag und
//! Fortschritts-Rückruf bekommt, plus Tauri-Befehl in commands.rs.

pub mod commands;
pub mod folder;
pub mod nextcloud;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub const CANCELED: &str = "CANCELED";

/// Ergebnis einer Übertragung: übertragene Bytes, oder übersprungen (Ziel hatte die Datei schon).
/// `name` ist gesetzt, wenn die Datei unter anderem Namen abgelegt wurde ("…_2.JPG"), weil am
/// Ziel schon eine andere Datei gleichen Namens lag – vorhandene Dateien werden nie überschrieben.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Outcome {
    pub bytes: u64,
    pub skipped: bool,
    pub name: Option<String>,
}

/// Höchstens so viele Ausweichnamen ("_2" … "_99") werden probiert
pub const MAX_SUFFIX: u32 = 99;

/// "a.jpg", 2 → "a_2.jpg"
pub fn suffixed(name: &str, n: u32) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}_{n}.{ext}"),
        _ => format!("{name}_{n}"),
    }
}

/// Reiner Dateiname ohne Ordneranteile
pub fn check_file_name(name: &str) -> Result<(), String> {
    let bad = name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) || name.chars().any(char::is_control);
    if bad { Err(format!("Ungültiger Dateiname: {name}")) } else { Ok(()) }
}

/// Laufende Übertragungen mit Abbruch-Flag (Kennung kommt aus der Oberfläche)
fn registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Meldet eine Übertragung an; das Flag wird beim Abbruch gesetzt
pub fn register(id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    registry().lock().unwrap().insert(id.to_string(), flag.clone());
    flag
}

pub fn unregister(id: &str) {
    registry().lock().unwrap().remove(id);
}

pub fn cancel(id: &str) -> bool {
    match registry().lock().unwrap().get(id) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}
