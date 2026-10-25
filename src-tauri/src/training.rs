//! Training mode (docs/scenario-format.md): scenarios and the separate training data.
//!
//!   <app data>/Schulung/Szenarien/<id>/   installed scenarios (szenario.json, karten/, flugprotokolle/)
//!   <resources>/scenarios/<id>/            scenarios shipped with di-drop (repo: scenarios/, read only)
//!   <app data>/Schulung/Daten/<id>/       training data: schulung.db, Bilder/, Karten/, Nextcloud/ …
//!
//! Every path is checked to stay inside the "Schulung" folder; scenario and card ids are plain
//! names. The functions take the root folder so the dev CLI (browser bridge) can use them too.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const SCENARIO_FILE: &str = "szenario.json";

#[derive(Debug, Serialize)]
pub struct ScenarioInfo {
    pub id: String,
    pub title: String,
    pub description: String,
    pub start: String,
    /// Training data exists (can be continued)
    pub started: bool,
    /// Shipped with di-drop (not removable)
    pub builtin: bool,
}

#[derive(Debug, Serialize)]
pub struct Paths {
    pub scenario: String,
    pub data: String,
    pub database: String,
}

/// Scenario/card ids: letters, digits, "-" and "_" (no paths)
pub fn check_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty() && id.len() <= 60 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(()) } else { Err(format!("Ungültige Kennung: {id}")) }
}

fn scenarios_dir(root: &Path) -> PathBuf {
    root.join("Szenarien")
}

fn data_dir(root: &Path, id: &str) -> PathBuf {
    root.join("Daten").join(id)
}

fn read_scenario(dir: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(dir.join(SCENARIO_FILE)).map_err(|_| format!("{SCENARIO_FILE} fehlt"))?;
    serde_json::from_str(&text).map_err(|e| format!("{SCENARIO_FILE} ist fehlerhaft: {e}"))
}

/// Folder of a scenario: installed ones take precedence over shipped ones with the same id
fn scenario_dir(root: &Path, builtin: Option<&Path>, id: &str) -> Result<PathBuf, String> {
    check_id(id)?;
    let installed = scenarios_dir(root).join(id);
    if installed.join(SCENARIO_FILE).exists() {
        return Ok(installed);
    }
    builtin
        .map(|b| b.join(id))
        .filter(|d| d.join(SCENARIO_FILE).exists())
        .ok_or(format!("Szenario „{id}“ ist nicht installiert."))
}

pub fn list(root: &Path, builtin: Option<&Path>) -> Vec<ScenarioInfo> {
    let read = |dir: PathBuf, is_builtin: bool| -> Vec<ScenarioInfo> {
        fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let json = read_scenario(&entry.path()).ok()?;
                let id = entry.file_name().to_string_lossy().into_owned();
                check_id(&id).ok()?;
                let text = |k: &str| json[k].as_str().unwrap_or_default().to_string();
                Some(ScenarioInfo {
                    started: data_dir(root, &id).join("schulung.db").exists(),
                    title: if text("title").is_empty() { id.clone() } else { text("title") },
                    description: text("description"),
                    start: text("start"),
                    builtin: is_builtin,
                    id,
                })
            })
            .collect()
    };
    let mut list = read(scenarios_dir(root), false);
    if let Some(dir) = builtin {
        for info in read(dir.to_path_buf(), true) {
            if !list.iter().any(|s| s.id == info.id) {
                list.push(info);
            }
        }
    }
    // Shipped ones first, then alphabetically
    list.sort_by(|a, b| b.builtin.cmp(&a.builtin).then(a.title.cmp(&b.title)));
    list
}

/// Paths of a scenario; creates the data folder
pub fn paths(root: &Path, builtin: Option<&Path>, id: &str) -> Result<Paths, String> {
    let scenario = scenario_dir(root, builtin, id)?;
    let data = data_dir(root, id);
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    Ok(Paths {
        database: data.join("schulung.db").display().to_string(),
        scenario: scenario.display().to_string(),
        data: data.display().to_string(),
    })
}

pub fn scenario_json(root: &Path, builtin: Option<&Path>, id: &str) -> Result<Value, String> {
    read_scenario(&scenario_dir(root, builtin, id)?)
}

/// "Übung neu starten": delete all training data of the scenario (never the scenario itself).
/// Note: the database must be closed (the window reloads afterwards).
pub fn reset(root: &Path, id: &str) -> Result<(), String> {
    check_id(id)?;
    let data = data_dir(root, id);
    if data.exists() {
        fs::remove_dir_all(&data).map_err(|e| format!("Schulungsdaten nicht löschbar: {e}"))?;
    }
    Ok(())
}

fn copy_tree(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in walkdir::WalkDir::new(src).min_depth(1) {
        let entry = entry.map_err(|e| e.to_string())?;
        let rel = entry.path().strip_prefix(src).map_err(|e| e.to_string())?;
        let target = dest.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else if entry.file_type().is_file() {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        } // symlinks are ignored
    }
    Ok(())
}

/// Simulated SD card: copy of karten/<card> in the training data (made once, then it keeps its state).
/// Returns the card root (contains DCIM).
pub fn card(root: &Path, builtin: Option<&Path>, id: &str, card: &str) -> Result<String, String> {
    check_id(card)?;
    let scenario = scenario_dir(root, builtin, id)?;
    let target = data_dir(root, id).join("Karten").join(card);
    if !target.exists() {
        let source = scenario.join("karten").join(card);
        if !source.is_dir() {
            return Err(format!("Karte „{card}“ fehlt im Szenario."));
        }
        copy_tree(&source, &target)?;
    }
    Ok(target.display().to_string())
}

/// Simulated remote controller: copies the given log files (from flugprotokolle/) into a staging
/// folder so the regular folder import can read them. Returns the folder.
pub fn stage_logs(root: &Path, builtin: Option<&Path>, id: &str, files: &[String]) -> Result<String, String> {
    let source = scenario_dir(root, builtin, id)?.join("flugprotokolle");
    let staging = data_dir(root, id).join("Fernsteuerung");
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    for name in files {
        if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
            return Err(format!("Ungültiger Dateiname: {name}"));
        }
        fs::copy(source.join(name), staging.join(name)).map_err(|e| format!("{name}: {e}"))?;
    }
    Ok(staging.display().to_string())
}

// ── Simulated Nextcloud: a local folder Daten/<id>/Nextcloud ──────────────────

#[derive(Debug, Serialize, PartialEq)]
pub struct Folder {
    pub name: String,
    pub path: String,
}

/// "/Einsätze/2026" → folder below Daten/<id>/Nextcloud (only plain names, no "..")
pub fn cloud_dir(root: &Path, id: &str, path: &str) -> Result<PathBuf, String> {
    check_id(id)?;
    let mut dir = data_dir(root, id).join("Nextcloud");
    for part in path.split('/').filter(|p| !p.is_empty()) {
        if part == "." || part == ".." || part.contains('\\') {
            return Err(format!("Ungültiger Ordner: {path}"));
        }
        dir.push(part);
    }
    Ok(dir)
}

pub fn cloud_list(root: &Path, id: &str, path: &str) -> Result<Vec<Folder>, String> {
    let dir = cloud_dir(root, id, path)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let base = path.trim_end_matches('/');
    let mut folders: Vec<Folder> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            Folder { path: format!("{base}/{name}"), name }
        })
        .collect();
    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(folders)
}

pub fn cloud_mkdir(root: &Path, id: &str, path: &str) -> Result<(), String> {
    fs::create_dir_all(cloud_dir(root, id, path)?).map_err(|e| e.to_string())
}

/// Install a scenario from a folder or a .zip (replaces an installed one with the same id)
pub fn import(root: &Path, path: &Path) -> Result<ScenarioInfo, String> {
    let incoming = root.join("Import");
    if incoming.exists() {
        fs::remove_dir_all(&incoming).map_err(|e| e.to_string())?;
    }
    if path.is_dir() {
        copy_tree(path, &incoming)?;
    } else {
        extract_zip(path, &incoming)?;
    }
    // The scenario may sit in a single subfolder of the archive
    let dir = if incoming.join(SCENARIO_FILE).exists() {
        incoming.clone()
    } else {
        let mut subdirs = fs::read_dir(&incoming).map_err(|e| e.to_string())?.flatten().filter(|e| e.path().join(SCENARIO_FILE).exists());
        subdirs.next().map(|e| e.path()).ok_or(format!("Kein Szenario gefunden ({SCENARIO_FILE} fehlt)."))?
    };
    let json = read_scenario(&dir)?;
    let id = json["id"].as_str().ok_or("Szenario ohne „id“")?.to_string();
    check_id(&id)?;
    let target = scenarios_dir(root).join(&id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(scenarios_dir(root)).map_err(|e| e.to_string())?;
    fs::rename(&dir, &target).or_else(|_| copy_tree(&dir, &target))?;
    let _ = fs::remove_dir_all(&incoming);
    list(root, None).into_iter().find(|s| s.id == id).ok_or("Szenario nicht lesbar".into())
}

fn extract_zip(path: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Keine gültige ZIP-Datei: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // Only plain relative paths ("zip slip" protection)
        let Some(rel) = entry.enclosed_name() else { continue };
        if rel.components().any(|c| !matches!(c, Component::Normal(_))) || rel.starts_with("__MACOSX") {
            continue;
        }
        let target = dest.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("didrop-training-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn scenario(dir: &Path, id: &str) {
        fs::create_dir_all(dir.join("karten/flug1/DCIM/DJI_001")).unwrap();
        fs::write(dir.join("karten/flug1/DCIM/DJI_001/a.JPG"), b"jpg").unwrap();
        fs::create_dir_all(dir.join("flugprotokolle")).unwrap();
        fs::write(dir.join("flugprotokolle/DJIFlightRecord_1.txt"), b"log").unwrap();
        fs::write(dir.join(SCENARIO_FILE), format!(r#"{{"id":"{id}","title":"Test","start":"2026-09-11T11:30"}}"#)).unwrap();
    }

    #[test]
    fn imports_folder_copies_cards_and_resets() {
        let root = tmp("folder");
        let src = tmp("folder-src");
        scenario(&src, "test");
        let info = import(&root, &src).unwrap();
        assert_eq!(info.id, "test");
        assert!(!info.started);
        let p = paths(&root, None, "test").unwrap();
        assert!(p.database.ends_with("schulung.db"));

        let card_root = card(&root, None, "test", "flug1").unwrap();
        let photo = Path::new(&card_root).join("DCIM/DJI_001/a.JPG");
        assert!(photo.exists());
        fs::remove_file(&photo).unwrap(); // deleted on the simulated card …
        assert!(src.join("karten/flug1/DCIM/DJI_001/a.JPG").exists()); // … source untouched
        card(&root, None, "test", "flug1").unwrap();
        assert!(!photo.exists()); // the card keeps its state

        let staged = stage_logs(&root, None, "test", &["DJIFlightRecord_1.txt".into()]).unwrap();
        assert!(Path::new(&staged).join("DJIFlightRecord_1.txt").exists());
        assert!(stage_logs(&root, None, "test", &["../szenario.json".into()]).is_err());

        reset(&root, "test").unwrap();
        assert!(!root.join("Daten/test").exists());
        assert!(root.join("Szenarien/test").exists());
    }

    #[test]
    fn simulated_cloud_stays_in_its_folder() {
        let root = tmp("cloud");
        cloud_mkdir(&root, "s", "/Einsätze/Übung").unwrap();
        let list = cloud_list(&root, "s", "/Einsätze").unwrap();
        assert_eq!(list, vec![Folder { name: "Übung".into(), path: "/Einsätze/Übung".into() }]);
        assert!(cloud_dir(&root, "s", "/../../etc").is_err());
        assert!(cloud_dir(&root, "s", "/a/../b").is_err());
    }

    #[test]
    fn shipped_scenarios_are_listed_and_used() {
        let root = tmp("builtin");
        let shipped = tmp("builtin-shipped");
        scenario(&shipped.join("basis"), "basis");
        let list = list(&root, Some(&shipped));
        assert_eq!(list.len(), 1);
        assert!(list[0].builtin);
        assert!(paths(&root, Some(&shipped), "basis").unwrap().scenario.starts_with(shipped.to_str().unwrap()));
        let card_root = card(&root, Some(&shipped), "basis", "flug1").unwrap();
        assert!(Path::new(&card_root).starts_with(&root)); // copy in the training data, never in the shipped folder
        assert!(paths(&root, None, "basis").is_err());
    }

    #[test]
    fn rejects_paths_as_ids() {
        assert!(check_id("../x").is_err());
        assert!(check_id("a/b").is_err());
        assert!(check_id("unterhain-2026").is_ok());
        let root = tmp("ids");
        assert!(card(&root, None, "x", "../../etc").is_err());
    }

    #[test]
    fn zip_import_ignores_escaping_paths() {
        let root = tmp("zip");
        let zip_path = root.join("s.zip");
        {
            let mut w = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("paket/szenario.json", opts).unwrap();
            w.write_all(br#"{"id":"zipped","title":"Zip"}"#).unwrap();
            w.start_file("paket/karten/k/DCIM/x.JPG", opts).unwrap();
            w.write_all(b"jpg").unwrap();
            w.start_file("../../boese.txt", opts).unwrap();
            w.write_all(b"nope").unwrap();
            w.finish().unwrap();
        }
        let info = import(&root, &zip_path).unwrap();
        assert_eq!(info.id, "zipped");
        assert!(root.join("Szenarien/zipped/karten/k/DCIM/x.JPG").exists());
        assert!(!root.parent().unwrap().join("boese.txt").exists());
    }
}
