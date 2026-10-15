//! Delivering files: copy into a folder (e.g. USB stick) or upload to a Nextcloud.
//! Both report progress in bytes and can be cancelled at any time (pause, cancel,
//! reordering the queue – the control logic lives in app/services/upload_queue.js).
//!
//! More targets: a new submodule with a function that receives source, target, cancel flag and
//! progress callback, plus a Tauri command in commands.rs.

pub mod commands;
pub mod folder;
pub mod nextcloud;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub const CANCELED: &str = "CANCELED";

/// Result of a transfer: bytes transferred, or skipped (the target already had the file).
/// `name` is set when the file was stored under a different name ("…_2.JPG") because a
/// different file with the same name already existed at the target – existing files are never overwritten.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Outcome {
    pub bytes: u64,
    pub skipped: bool,
    pub name: Option<String>,
}

/// At most this many alternative names ("_2" … "_99") are tried
pub const MAX_SUFFIX: u32 = 99;

/// "a.jpg", 2 → "a_2.jpg"
pub fn suffixed(name: &str, n: u32) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}_{n}.{ext}"),
        _ => format!("{name}_{n}"),
    }
}

/// Plain file name without folder parts
pub fn check_file_name(name: &str) -> Result<(), String> {
    let bad = name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) || name.chars().any(char::is_control);
    if bad { Err(format!("Ungültiger Dateiname: {name}")) } else { Ok(()) }
}

/// Running transfers with cancel flag (the id comes from the UI)
fn registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REG: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registers a transfer; the flag is set on cancel
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
