//! Memory cards: detect inserted cards (a mounted volume with a `DCIM` folder) and delete
//! originals from the card after they were imported.
//!
//! Safety rules for deleting (enforced here, not in the UI):
//! - only files below `<card>/DCIM`, only supported media types (no folders, no other files)
//! - only if the imported copy exists outside the card with the same size and the same
//!   fingerprint as the original
//! - companion files (RTK/PPK raw data, see COMPANION_EXTENSIONS) only on request and only in folders
//!   where no image or video is left – otherwise they belong to recordings that stay on the card
//! - afterwards only folders below DCIM that became empty are removed – never DCIM itself

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::media;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Card {
    /// Mount point ("/Volumes/Untitled", "E:\")
    pub root: String,
    /// Display name (volume name or drive letter)
    pub name: String,
    pub dcim: String,
}

/// Files DJI writes next to the images of RTK drones (M4TD, M30T …), for recomputing the positions
/// afterwards (PPK): .MRK (time + position per photo + antenna offset), .OBS/.NAV (RINEX satellite
/// raw data), .RTK (DJI raw data), ppk_file_name.pbk (pointer to the .RTK file). Not used yet –
/// the images already carry the RTK positions (XMP RtkFlag/RtkStd*).
pub const COMPANION_EXTENSIONS: &[&str] = &["mrk", "obs", "nav", "rtk", "pbk"];

fn is_companion(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| COMPANION_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Additional card roots for tests (path list like PATH)
const EXTRA_ROOTS_ENV: &str = "DIDROP_SDCARD_ROOTS";

fn candidate_roots() -> Vec<PathBuf> {
    let mut roots = vec![];
    #[cfg(target_os = "macos")]
    if let Ok(entries) = std::fs::read_dir("/Volumes") {
        // "Macintosh HD" is a symlink to "/" – skip symlinks
        roots.extend(entries.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path()));
    }
    #[cfg(target_os = "windows")]
    roots.extend((b'D'..=b'Z').map(|letter| PathBuf::from(format!("{}:\\", letter as char))));
    #[cfg(target_os = "linux")]
    {
        let user = std::env::var("USER").unwrap_or_default();
        for base in [format!("/media/{user}"), format!("/run/media/{user}"), "/media".into()] {
            if let Ok(entries) = std::fs::read_dir(base) {
                roots.extend(entries.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path()));
            }
        }
    }
    if let Some(extra) = std::env::var_os(EXTRA_ROOTS_ENV) {
        roots.extend(std::env::split_paths(&extra));
    }
    roots
}

/// The DCIM folder of a volume (camera cards may write "dcim" in lower case)
fn dcim_of(root: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    entries
        .flatten()
        .find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case("DCIM") && e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
}

fn card_for(root: &Path) -> Option<Card> {
    let dcim = dcim_of(root)?;
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.display().to_string().trim_end_matches('\\').to_string());
    Some(Card { root: root.display().to_string(), name, dcim: dcim.display().to_string() })
}

/// All currently mounted cards
pub fn list() -> Vec<Card> {
    candidate_roots().iter().filter_map(|root| card_for(root)).collect()
}

/// Ejects a card like "Auswerfen" in Finder/Explorer. Only cards that are detected right now and that
/// are a volume of their own – never the test folders from DIDROP_SDCARD_ROOTS or anything else.
/// The watcher then reports the card as removed.
pub fn eject(root: &Path) -> Result<(), String> {
    let card = list().into_iter().find(|c| Path::new(&c.root) == root).ok_or("Diese Karte ist nicht mehr eingesteckt.")?;
    if !is_volume_root(root) {
        return Err(format!("„{}“ ist kein eigenes Laufwerk und lässt sich nicht auswerfen.", card.name));
    }
    eject_volume(root).map_err(|detail| {
        eprintln!("[sdcard] eject {}: {detail}", root.display());
        format!(
            "„{}“ konnte nicht ausgeworfen werden – vermutlich ist darauf noch etwas geöffnet (z. B. ein Finder- oder \
             Explorer-Fenster oder ein anderes Programm). Schließen und noch einmal versuchen.",
            card.name
        )
    })
}

/// Mount point of its own (other device than the folder above it)
#[cfg(unix)]
fn is_volume_root(root: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let (Ok(own), Some(parent)) = (std::fs::metadata(root), root.parent()) else { return false };
    std::fs::metadata(parent).is_ok_and(|p| p.dev() != own.dev())
}

/// A drive like "E:\" (no folder above it)
#[cfg(windows)]
fn is_volume_root(root: &Path) -> bool {
    root.parent().is_none()
}

#[cfg(target_os = "macos")]
fn eject_volume(root: &Path) -> Result<(), String> {
    let out = std::process::Command::new("/usr/sbin/diskutil").arg("eject").arg(root).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string())
    }
}

/// Same as "Auswerfen" in the Explorer (shell verb) – it reports nothing back, so wait until the drive is gone
#[cfg(target_os = "windows")]
fn eject_volume(root: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let drive = root.display().to_string(); // "E:\" – from list(), so only a drive letter
    let script = format!("(New-Object -ComObject Shell.Application).Namespace(17).ParseName('{drive}').InvokeVerb('Eject')");
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    for _ in 0..20 {
        if dcim_of(root).is_none() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Err("drive still there".into())
}

#[cfg(target_os = "linux")]
fn eject_volume(root: &Path) -> Result<(), String> {
    let out = std::process::Command::new("gio").args(["mount", "--eject"]).arg(root).output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_string()) }
}

/// Polls the mounted volumes and reports changes (`inserted`, `removed`)
pub fn watch(mut inserted: impl FnMut(&Card), mut removed: impl FnMut(&Card)) {
    let mut known: BTreeMap<String, Card> = list().into_iter().map(|c| (c.root.clone(), c)).collect();
    loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let now: BTreeMap<String, Card> = list().into_iter().map(|c| (c.root.clone(), c)).collect();
        for (root, card) in &now {
            if !known.contains_key(root) {
                inserted(card);
            }
        }
        for (root, card) in &known {
            if !now.contains_key(root) {
                removed(card);
            }
        }
        known = now;
    }
}

#[derive(Debug, Deserialize)]
pub struct DeleteItem {
    /// Original on the card
    pub src: String,
    /// Imported copy in the image storage
    pub copy: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Kept {
    pub src: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Default, PartialEq)]
pub struct DeleteReport {
    pub deleted: Vec<String>,
    pub kept: Vec<Kept>,
    /// Companion files (RTK/PPK) deleted along with them
    pub companions: Vec<String>,
    /// Folders below DCIM removed because they became empty
    pub removed_dirs: Vec<String>,
}

/// Why `src` must not be deleted – `None` if the copy is verified
fn refuse_reason(dcim: &Path, item: &DeleteItem) -> Option<String> {
    let src = match Path::new(&item.src).canonicalize() {
        Ok(p) => p,
        Err(_) => return Some("Datei nicht mehr auf der Karte".into()),
    };
    if !src.starts_with(dcim) || src == dcim {
        return Some("Liegt nicht im DCIM-Ordner der Karte".into());
    }
    if !src.is_file() || !media::is_media_file(&src) {
        return Some("Kein Bild oder Video".into());
    }
    let copy = match Path::new(&item.copy).canonicalize() {
        Ok(p) => p,
        Err(_) => return Some("Importierte Kopie fehlt".into()),
    };
    // The copy must not be on the card itself (otherwise it would be deleted with it)
    let card_root = dcim.parent().unwrap_or(dcim);
    if copy.starts_with(card_root) || copy == src {
        return Some("Kopie liegt auf der Karte".into());
    }
    let size = |p: &Path| std::fs::metadata(p).map(|m| m.len()).ok();
    if size(&src).is_none() || size(&src) != size(&copy) {
        return Some("Kopie unvollständig (andere Größe)".into());
    }
    match (media::fingerprint(&src), media::fingerprint(&copy)) {
        (Ok(a), Ok(b)) if a == b => None,
        (Ok(_), Ok(_)) => Some("Kopie weicht vom Original ab".into()),
        (Err(e), _) | (_, Err(e)) => Some(format!("Nicht lesbar: {e}")),
    }
}

/// Deletes imported originals from the card (permanently, no trash – cards have none).
/// Every file is checked individually; anything doubtful stays on the card.
/// companions: also delete RTK/PPK files in folders that no longer contain images or videos.
pub fn delete_imported(card_root: &Path, items: &[DeleteItem], companions: bool) -> Result<DeleteReport, String> {
    let dcim = dcim_of(card_root)
        .ok_or("Keine Speicherkarte (DCIM-Ordner fehlt)")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let mut report = DeleteReport::default();
    let mut parents = std::collections::BTreeSet::new();
    for item in items {
        if let Some(reason) = refuse_reason(&dcim, item) {
            report.kept.push(Kept { src: item.src.clone(), reason });
            continue;
        }
        let src = Path::new(&item.src).canonicalize().map_err(|e| e.to_string())?;
        match std::fs::remove_file(&src) {
            Ok(()) => {
                if let Some(parent) = src.parent() {
                    parents.insert(parent.to_path_buf());
                }
                report.deleted.push(item.src.clone());
            }
            Err(e) => report.kept.push(Kept { src: item.src.clone(), reason: format!("Löschen fehlgeschlagen: {e}") }),
        }
    }
    if companions {
        for dir in &parents {
            delete_companions(&dcim, dir, &mut report);
        }
    }
    // Remove folders that became empty, deepest first, up to (not including) DCIM
    let mut dirs: Vec<PathBuf> = parents.into_iter().flat_map(|p| p.ancestors().map(Path::to_path_buf).collect::<Vec<_>>()).collect();
    dirs.retain(|d| d.starts_with(&dcim) && *d != dcim);
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    dirs.dedup();
    for dir in dirs {
        remove_system_clutter(&dir);
        // remove_dir only succeeds on empty folders
        if std::fs::remove_dir(&dir).is_ok() {
            report.removed_dirs.push(dir.display().to_string());
        }
    }
    Ok(report)
}

/// RTK/PPK files of a folder – only once no image or video is left in it
fn delete_companions(dcim: &Path, dir: &Path, report: &mut DeleteReport) {
    if !dir.starts_with(dcim) || dir == dcim {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let files: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file())) // no folders, no symlinks
        .map(|e| e.path())
        .collect();
    if files.iter().any(|f| media::is_media_file(f)) {
        return;
    }
    for file in files.iter().filter(|f| is_companion(f)) {
        if std::fs::remove_file(file).is_ok() {
            report.companions.push(file.display().to_string());
        }
    }
}

/// macOS leaves "._name" and ".DS_Store" on FAT cards – they don't count as content
fn remove_system_clutter(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let entries: Vec<_> = entries.flatten().collect();
    let is_clutter = |name: &str| name == ".DS_Store" || name.starts_with("._");
    if entries.iter().all(|e| is_clutter(&e.file_name().to_string_lossy()) && e.file_type().is_ok_and(|t| t.is_file())) {
        for entry in entries {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("didrop-sdcard-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn item(src: &Path, copy: &Path) -> DeleteItem {
        DeleteItem { src: src.display().to_string(), copy: copy.display().to_string() }
    }

    #[test]
    fn detects_cards_by_dcim_folder() {
        let dir = tmp("detect");
        std::fs::create_dir_all(dir.join("card/DCIM")).unwrap();
        std::fs::create_dir_all(dir.join("stick/Daten")).unwrap();
        assert!(card_for(&dir.join("card")).is_some());
        assert!(card_for(&dir.join("stick")).is_none());
        assert_eq!(card_for(&dir.join("card")).unwrap().name, "card");
    }

    #[test]
    fn deletes_only_verified_copies() {
        let dir = tmp("delete");
        let card = dir.join("card");
        let flight = card.join("DCIM/DJI_202610061430_001");
        let other = card.join("DCIM/DJI_202610051200_002");
        std::fs::create_dir_all(&flight).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::create_dir_all(dir.join("storage")).unwrap();
        let photo = |dir: &Path, name: &str, byte: u8| {
            let p = dir.join(name);
            std::fs::write(&p, vec![byte; 200_000]).unwrap();
            p
        };
        let a = photo(&flight, "DJI_0001_T.JPG", 1);
        let b = photo(&flight, "DJI_0001_V.JPG", 2);
        let c = photo(&other, "DJI_0002_V.JPG", 3);
        std::fs::write(flight.join("._DJI_0001_T.JPG"), b"x").unwrap();
        let a_copy = dir.join("storage/a.jpg");
        std::fs::copy(&a, &a_copy).unwrap();
        let b_copy = dir.join("storage/b.jpg");
        std::fs::write(&b_copy, vec![9u8; 200_000]).unwrap(); // same size, different content
        let outside = photo(&dir, "outside.jpg", 4);
        let not_media = card.join("DCIM/notes.txt");
        std::fs::write(&not_media, b"x").unwrap();

        let report = delete_imported(
            &card,
            &[
                item(&a, &a_copy),
                item(&b, &b_copy),
                item(&c, &dir.join("storage/missing.jpg")),
                item(&outside, &a_copy),
                item(&not_media, &a_copy),
                item(&c, &c), // copy on the card itself
            ],
            false,
        )
        .unwrap();
        assert_eq!(report.deleted, vec![a.display().to_string()]);
        assert_eq!(report.kept.len(), 5);
        assert!(!a.exists() && b.exists() && c.exists() && outside.exists() && not_media.exists());
        assert!(a_copy.exists());
        // folder still has b → stays; DCIM is never removed
        assert!(report.removed_dirs.is_empty());

        // once b is verified too, the empty flight folder goes – DCIM stays
        std::fs::copy(&b, &b_copy).unwrap();
        let report = delete_imported(&card, &[item(&b, &b_copy)], false).unwrap();
        assert_eq!(report.deleted.len(), 1);
        assert_eq!(report.removed_dirs, vec![flight.display().to_string()]);
        assert!(card.join("DCIM").is_dir() && other.is_dir());
    }

    #[test]
    fn refuses_paths_escaping_dcim() {
        let dir = tmp("escape");
        let card = dir.join("card");
        std::fs::create_dir_all(card.join("DCIM/X")).unwrap();
        let outside = card.join("MISC.jpg");
        std::fs::write(&outside, vec![1u8; 10]).unwrap();
        let copy = dir.join("copy.jpg");
        std::fs::write(&copy, vec![1u8; 10]).unwrap();
        let sneaky = card.join("DCIM/X/../../MISC.jpg");
        let report = delete_imported(&card, &[item(&sneaky, &copy)], true).unwrap();
        assert!(report.deleted.is_empty());
        assert!(outside.exists());
        assert!(delete_imported(&dir, &[], true).is_err()); // no DCIM → no card
    }

    #[test]
    fn deletes_companions_only_when_no_recording_is_left() {
        let dir = tmp("companions");
        let card = dir.join("card");
        let done = card.join("DCIM/DJI_202610151104_001_BOS-Cloud");
        let partly = card.join("DCIM/DJI_202610151200_002");
        std::fs::create_dir_all(&done).unwrap();
        std::fs::create_dir_all(&partly).unwrap();
        std::fs::create_dir_all(dir.join("storage")).unwrap();
        let mut items = vec![];
        for (folder, name) in [(&done, "DJI_0002_V.JPG"), (&partly, "DJI_0003_V.JPG")] {
            let src = folder.join(name);
            std::fs::write(&src, vec![5u8; 1000]).unwrap();
            let copy = dir.join("storage").join(name);
            std::fs::copy(&src, &copy).unwrap();
            items.push(item(&src, &copy));
            for ext in ["MRK", "OBS", "NAV", "RTK"] {
                std::fs::write(folder.join(format!("DJI_0002_D.{ext}")), b"raw").unwrap();
            }
            std::fs::write(folder.join("ppk_file_name.pbk"), b"DJI_0002_D.RTK").unwrap();
            std::fs::write(folder.join("notes.txt"), b"keep").unwrap();
        }
        std::fs::remove_file(done.join("notes.txt")).unwrap();
        std::fs::write(partly.join("DJI_0004_V.JPG"), b"stays on the card").unwrap();

        let report = delete_imported(&card, &items, true).unwrap();
        assert_eq!(report.deleted.len(), 2);
        assert_eq!(report.companions.len(), 5);
        // folder empty → removed; the other still has an image → raw data and other files stay
        assert!(!done.exists());
        assert!(partly.join("DJI_0002_D.RTK").exists() && partly.join("notes.txt").exists());
        assert!(card.join("DCIM").is_dir());
    }

    #[test]
    fn keeps_companions_without_request() {
        let dir = tmp("no-companions");
        let card = dir.join("card");
        let folder = card.join("DCIM/DJI_001");
        std::fs::create_dir_all(&folder).unwrap();
        let src = folder.join("DJI_0001_V.JPG");
        std::fs::write(&src, vec![1u8; 10]).unwrap();
        std::fs::write(folder.join("DJI_0001_D.MRK"), b"raw").unwrap();
        let copy = dir.join("copy.jpg");
        std::fs::copy(&src, &copy).unwrap();
        let report = delete_imported(&card, &[item(&src, &copy)], false).unwrap();
        assert!(report.companions.is_empty());
        assert!(folder.join("DJI_0001_D.MRK").exists());
    }

    #[test]
    fn only_detected_cards_on_a_volume_of_their_own_can_be_ejected() {
        let dir = tmp("eject");
        std::fs::create_dir_all(dir.join("DCIM")).unwrap();
        assert!(!is_volume_root(&dir)); // a folder with DCIM (like the test cards) is no drive
        assert!(eject(&dir).is_err()); // not detected (no DIDROP_SDCARD_ROOTS here) → refused
        assert!(dir.join("DCIM").exists());
    }
}
