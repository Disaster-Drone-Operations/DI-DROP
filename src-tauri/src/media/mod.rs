//! Import of drone images and videos.
//!
//! 1. `scan`   – finds media files in files/folders, reads metadata and
//!               computes a fingerprint (for duplicate detection).
//!               Reads only the start and end of each file → fast even on SD cards.
//! 2. `import` – copies the selected files into the flight folder and creates
//!               thumbnails.
//!
//! Which of them are new or already imported is decided by the frontend based on
//! the database.

pub mod metadata;
pub mod thumbnail;

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use metadata::Metadata;

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg"];
const RAW_EXTENSIONS: &[&str] = &["dng"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov"];

/// How much is read from the start (metadata + fingerprint) and end (fingerprint) of a file
const HEAD_BYTES: usize = 256 * 1024;
const TAIL_BYTES: u64 = 256 * 1024;

#[derive(Debug, Serialize, Clone)]
pub struct ScannedFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub fingerprint: String,
    /// "image" | "raw" | "video"
    pub kind: String,
    /// Shared key of all files of one shot, e.g. "DJI_20261006143012_0001"
    pub shot_key: String,
    /// Camera variant from the file name: "W" (wide), "Z" (zoom), "T" (thermal), "V" …
    pub variant: Option<String>,
    pub meta: Metadata,
}

#[derive(Debug, Serialize)]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Default)]
pub struct ScanResult {
    pub files: Vec<ScannedFile>,
    pub skipped: Vec<Skipped>,
}

// ── Scan ────────────────────────────────────────────────────────────────────

fn media_kind(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        Some("image")
    } else if RAW_EXTENSIONS.contains(&ext.as_str()) {
        Some("raw")
    } else if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        Some("video")
    } else {
        None
    }
}

fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    entry.depth() > 0 && entry.file_name().to_str().is_some_and(|n| n.starts_with('.') || n.starts_with('$'))
}

pub fn scan(paths: &[String]) -> ScanResult {
    let mut result = ScanResult::default();
    let mut candidates: Vec<PathBuf> = Vec::new();

    for path in paths {
        for entry in WalkDir::new(path).follow_links(false).into_iter().filter_entry(|e| !is_hidden(e)) {
            match entry {
                Ok(e) if e.file_type().is_file() && media_kind(e.path()).is_some() => candidates.push(e.into_path()),
                Ok(_) => {}
                Err(err) => result.skipped.push(Skipped { path: path.clone(), reason: err.to_string() }),
            }
        }
    }
    candidates.sort();
    candidates.dedup();

    for path in candidates {
        match scan_file(&path) {
            Ok(file) => result.files.push(file),
            Err(reason) => result.skipped.push(Skipped { path: path.display().to_string(), reason }),
        }
    }
    assign_shot_keys(&mut result.files);
    result
}

/// Groups the files of one shot (thermal + visible …) under one key.
///
/// The M4TD cameras don't trigger at exactly the same time: "…135744_0001_T" and
/// "…135745_0001_V" belong together. Criterion: same folder, same sequence number,
/// at most 3 seconds apart. The sequence number alone is not enough – within a folder
/// it sometimes starts again at 0001.
fn assign_shot_keys(files: &mut [ScannedFile]) {
    const MAX_GAP_SECONDS: i64 = 3;

    let mut parsed: Vec<(usize, String, DjiName)> = files
        .iter()
        .enumerate()
        .filter_map(|(i, f)| {
            let dir = Path::new(&f.path).parent().map(|p| p.display().to_string()).unwrap_or_default();
            parse_dji_name(&f.name).map(|n| (i, dir, n))
        })
        .collect();
    parsed.sort_by(|a, b| (&a.1, &a.2.index, a.2.seconds).cmp(&(&b.1, &b.2.index, b.2.seconds)));

    let mut used = std::collections::HashSet::new();
    let mut group_start: Option<(String, String, i64, String)> = None; // dir, index, seconds, key
    for (i, dir, name) in parsed {
        let same_shot = group_start.as_ref().is_some_and(|(d, idx, secs, _)| {
            *d == dir && *idx == name.index && name.seconds - secs <= MAX_GAP_SECONDS
        });
        if !same_shot {
            let base = format!("DJI_{}_{}", name.stamp, name.index);
            let key = (1..).map(|n| if n == 1 { base.clone() } else { format!("{base}_{n}") }).find(|k| !used.contains(k)).unwrap();
            used.insert(key.clone());
            group_start = Some((dir, name.index.clone(), name.seconds, key));
        }
        files[i].shot_key = group_start.as_ref().unwrap().3.clone();
    }
}

/// Fingerprint: size + start + end. Camera files already differ in the header (timestamps,
/// serial numbers) – so we don't have to read the whole file. Also returns the header bytes.
fn fingerprint_with_head(file: &mut File, size: u64) -> Result<(String, Vec<u8>), String> {
    let mut head = vec![0; HEAD_BYTES.min(size as usize)];
    file.read_exact(&mut head).map_err(|e| e.to_string())?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(&size.to_le_bytes());
    hasher.update(&head);
    if size > HEAD_BYTES as u64 + TAIL_BYTES {
        let mut tail = vec![0; TAIL_BYTES as usize];
        file.seek(SeekFrom::End(-(TAIL_BYTES as i64))).map_err(|e| e.to_string())?;
        file.read_exact(&mut tail).map_err(|e| e.to_string())?;
        hasher.update(&tail);
    }
    Ok((hasher.finalize().to_hex()[..32].to_string(), head))
}

/// Same fingerprint as during scanning/import (used to verify copies before deleting originals)
pub fn fingerprint(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    Ok(fingerprint_with_head(&mut file, size)?.0)
}

pub fn is_media_file(path: &Path) -> bool {
    media_kind(path).is_some()
}

fn scan_file(path: &Path) -> Result<ScannedFile, String> {
    let kind = media_kind(path).ok_or("Kein unterstütztes Format")?;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();

    let (fingerprint, head) = fingerprint_with_head(&mut file, size)?;

    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    let dji_name = parse_dji_name(&name);
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(&name);
    // Preliminary – assign_shot_keys() groups related files afterwards
    let shot_key = dji_name.as_ref().map(|n| format!("DJI_{}_{}", n.stamp, n.index)).unwrap_or_else(|| stem.to_string());
    let variant = dji_name.as_ref().map(|n| n.variant.clone());

    let mut meta = if kind == "image" { metadata::read(&head) } else { Metadata::default() };
    if meta.taken_at.is_none() {
        meta.taken_at = dji_name.as_ref().map(|n| n.iso_time());
    }

    Ok(ScannedFile { path: path.display().to_string(), name, size, fingerprint, kind: kind.into(), shot_key, variant, meta })
}

/// Parts of a DJI file name: "DJI_20261006143012_0001_T.JPG"
#[derive(Debug, Clone, PartialEq)]
pub struct DjiName {
    /// "20261006143012"
    pub stamp: String,
    /// sequence number "0001"
    pub index: String,
    /// "T" (thermal), "V" (visible), "W", "Z" …
    pub variant: String,
    /// seconds since 1970 (for time differences; time zone irrelevant)
    pub seconds: i64,
}

impl DjiName {
    pub fn iso_time(&self) -> String {
        let t = &self.stamp;
        format!("{}-{}-{}T{}:{}:{}", &t[0..4], &t[4..6], &t[6..8], &t[8..10], &t[10..12], &t[12..14])
    }
}

pub fn parse_dji_name(name: &str) -> Option<DjiName> {
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
    let parts: Vec<&str> = stem.split('_').collect();
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());

    if parts.len() < 4 || !parts[0].eq_ignore_ascii_case("DJI") || parts[1].len() != 14 || !digits(parts[1]) || !digits(parts[2]) {
        return None;
    }
    let t = parts[1];
    let n = |r: std::ops::Range<usize>| t[r].parse::<i64>().unwrap_or(0);
    let seconds = days_from_civil(n(0..4), n(4..6), n(6..8)) * 86_400 + n(8..10) * 3600 + n(10..12) * 60 + n(12..14);
    Some(DjiName {
        stamp: t.to_string(),
        index: parts[2].to_string(),
        variant: parts[3..].join("_").to_ascii_uppercase(),
        seconds,
    })
}

/// Days since 1970-01-01 (algorithm by Howard Hinnant)
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

// ── Import ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ImportItem {
    pub src: String,
    pub dest_dir: String,
    pub fingerprint: String,
    pub kind: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub src: String,
    pub fingerprint: String,
    pub dest_path: Option<String>,
    pub thumb_path: Option<String>,
    pub error: Option<String>,
}

pub fn import(items: Vec<ImportItem>, thumbs_dir: &Path, progress: impl Fn(ImportProgress) + Sync) -> Vec<ImportResult> {
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // Copy sequentially (easier on SD cards), thumbnails afterwards in parallel
    let total = items.len();
    let done = AtomicUsize::new(0);
    let report = |name: String| progress(ImportProgress { done: done.load(Ordering::Relaxed), total, name });

    let copied: Vec<(ImportItem, ImportResult, String)> = items
        .into_iter()
        .map(|item| {
            let name = Path::new(&item.src).file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
            report(name.clone());

            let mut result = ImportResult {
                src: item.src.clone(),
                fingerprint: item.fingerprint.clone(),
                dest_path: None,
                thumb_path: None,
                error: None,
            };
            match copy_into(&item, &name) {
                Ok(dest) => result.dest_path = Some(dest.display().to_string()),
                Err(e) => {
                    result.error = Some(e);
                    done.fetch_add(1, Ordering::Relaxed);
                }
            }
            (item, result, name)
        })
        .collect();

    let results = copied
        .into_par_iter()
        .map(|(item, mut result, name)| {
            if let (Some(dest), "image") = (&result.dest_path, item.kind.as_str()) {
                let thumb = thumbs_dir.join(format!("{}.jpg", item.fingerprint));
                if thumb.exists() || thumbnail::create(Path::new(dest), &thumb).is_ok() {
                    result.thumb_path = Some(thumb.display().to_string());
                }
            }
            if result.error.is_none() {
                done.fetch_add(1, Ordering::Relaxed);
                report(name);
            }
            result
        })
        .collect();
    report(String::new());
    results
}

/// "image.jpg" → "image.jpg", or "image_2.jpg", "image_3.jpg" … if it already exists
pub fn unique_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("bild");
    let ext = path.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    (2..)
        .map(|n| path.with_file_name(format!("{stem}_{n}{ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

/// Rename within the same folder – see command `rename_file`
pub fn rename_file(from: &Path, to: &Path) -> Result<PathBuf, String> {
    if from.parent() != to.parent() {
        return Err("Umbenennen nur innerhalb desselben Ordners".into());
    }
    let allowed = |p: &Path| media_kind(p).is_some() || p.extension().is_some_and(|e| e.eq_ignore_ascii_case("png"));
    if !allowed(from) || !allowed(to) {
        return Err("Nur Bild- und Videodateien".into());
    }
    if !from.exists() {
        return Err(format!("Nicht gefunden: {}", from.display()));
    }
    // Same file (e.g. only different case on macOS) → rename directly
    let same = to.exists() && fs::canonicalize(from).ok() == fs::canonicalize(to).ok();
    let target = if to.exists() && !same { unique_path(to) } else { to.to_path_buf() };
    fs::rename(from, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Renames a folder (same parent folder, never overwrite → "_2" …)
pub fn rename_dir(from: &Path, to: &Path) -> Result<PathBuf, String> {
    if from.parent() != to.parent() {
        return Err("Umbenennen nur innerhalb desselben Ordners".into());
    }
    if !from.is_dir() {
        return Err(format!("Kein Ordner: {}", from.display()));
    }
    let same = to.exists() && fs::canonicalize(from).ok() == fs::canonicalize(to).ok();
    let target = if to.exists() && !same {
        let name = to.file_name().and_then(|n| n.to_str()).unwrap_or("Ordner");
        (2..).map(|n| to.with_file_name(format!("{name}_{n}"))).find(|p| !p.exists()).unwrap()
    } else {
        to.to_path_buf()
    };
    fs::rename(from, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Copies into the target folder. If a file with the same name already exists there:
/// same content → reuse it, different content → append "_1", "_2" …
fn copy_into(item: &ImportItem, name: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(&item.dest_dir);
    fs::create_dir_all(&dir).map_err(|e| format!("Ordner konnte nicht angelegt werden: {e}"))?;

    let (stem, ext) = name.rsplit_once('.').map(|(s, e)| (s.to_string(), format!(".{e}"))).unwrap_or((name.to_string(), String::new()));
    for n in 0.. {
        let candidate = dir.join(if n == 0 { name.to_string() } else { format!("{stem}_{n}{ext}") });
        if !candidate.exists() {
            let tmp = candidate.with_extension("part");
            fs::copy(&item.src, &tmp).map_err(|e| format!("Kopieren fehlgeschlagen: {e}"))?;
            fs::rename(&tmp, &candidate).map_err(|e| e.to_string())?;
            return Ok(candidate);
        }
        if scan_file(&candidate).map(|f| f.fingerprint == item.fingerprint).unwrap_or(false) {
            return Ok(candidate);
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renames_without_overwriting() {
        let dir = std::env::temp_dir().join(format!("didrop-rename-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let a = dir.join("DJI_0001_T.JPG");
        let b = dir.join("DJI_0002_T.JPG");
        fs::write(&a, b"a").unwrap();
        fs::write(&b, b"b").unwrap();
        let target = dir.join("2026_09_11__133152_Ost 1_Wärmebild.JPG");
        assert_eq!(rename_file(&a, &target).unwrap(), target);
        // target taken → "_2"
        let second = rename_file(&b, &target).unwrap();
        assert_eq!(second.file_name().unwrap(), "2026_09_11__133152_Ost 1_Wärmebild_2.JPG");
        assert_eq!(fs::read(&target).unwrap(), b"a");
        // renaming to itself changes nothing
        assert_eq!(rename_file(&target, &target).unwrap(), target);
        // a different folder is not allowed
        assert!(rename_file(&target, &std::env::temp_dir().join("x.JPG")).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn renames_directories_without_overwriting() {
        let base = std::env::temp_dir().join(format!("didrop-dirs-{}", std::process::id()));
        let a = base.join("2026_09_11__1331_Kontrollflug 2");
        let b = base.join("2026_09_11__13_31_Kontrollflug 2");
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("x.JPG"), b"x").unwrap();
        assert_eq!(rename_dir(&a, &b).unwrap(), b);
        assert!(b.join("x.JPG").exists());
        let c = base.join("other");
        fs::create_dir_all(&c).unwrap();
        assert_eq!(rename_dir(&c, &b).unwrap().file_name().unwrap(), "2026_09_11__13_31_Kontrollflug 2_2");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn parses_dji_file_names() {
        let name = parse_dji_name("DJI_20261006143012_0001_T.JPG").unwrap();
        assert_eq!((name.stamp.as_str(), name.index.as_str(), name.variant.as_str()), ("20261006143012", "0001", "T"));
        assert_eq!(name.iso_time(), "2026-10-06T14:30:12");
        assert_eq!(parse_dji_name("DJI_20261006143013_0001_V.JPG").unwrap().seconds - name.seconds, 1);
        assert_eq!(parse_dji_name("IMG_1234.jpg"), None);
    }

    fn file(path: &str) -> ScannedFile {
        let name = Path::new(path).file_name().unwrap().to_str().unwrap().to_string();
        ScannedFile {
            path: path.into(), name, size: 0, fingerprint: String::new(), kind: "image".into(),
            shot_key: String::new(), variant: None, meta: Metadata::default(),
        }
    }

    #[test]
    fn groups_thermal_and_visible_with_one_second_offset() {
        let mut files = vec![
            file("/sd/a/DJI_20260911135744_0001_T.JPG"),
            file("/sd/a/DJI_20260911135745_0001_V.JPG"),
            file("/sd/a/DJI_20260911135816_0002_T.JPG"),
            file("/sd/a/DJI_20260911135816_0002_V.JPG"),
            // sequence number restarts → separate shot
            file("/sd/a/DJI_20260911140029_0001_T.JPG"),
            file("/sd/a/DJI_20260911140029_0001_V.JPG"),
            // same name in another folder → separate shot
            file("/sd/b/DJI_20260911135744_0001_T.JPG"),
        ];
        assign_shot_keys(&mut files);
        let keys: Vec<&str> = files.iter().map(|f| f.shot_key.as_str()).collect();
        assert_eq!(keys[0], "DJI_20260911135744_0001");
        assert_eq!(keys[1], "DJI_20260911135744_0001");
        assert_eq!(keys[2], keys[3]);
        assert_eq!(keys[4], "DJI_20260911140029_0001");
        assert_eq!(keys[4], keys[5]);
        assert_ne!(keys[0], keys[4]);
        assert_eq!(keys[6], "DJI_20260911135744_0001_2"); // same name in another folder stays separate
    }
}

/// Tests scan + import on real images (e.g. from script/make_test_images.sh):
///   DIDROP_TEST_IMAGES=/path/to/sdcard cargo test -- --ignored --nocapture
#[cfg(test)]
mod integration {
    use super::*;

    #[test]
    #[ignore]
    fn scans_and_imports_test_images() {
        let src = std::env::var("DIDROP_TEST_IMAGES").expect("set DIDROP_TEST_IMAGES");
        let result = scan(&[src]);
        assert!(result.skipped.is_empty(), "{:?}", result.skipped);
        assert!(!result.files.is_empty());
        for f in &result.files {
            println!("{} {:?} {:<15} t={:?} yaw={:?} line={:?} target={:?}",
                f.shot_key, f.variant, f.meta.image_source.as_deref().unwrap_or("-"), f.meta.taken_at, f.meta.gimbal_yaw,
                f.meta.flight_line.as_deref().map(|l| &l[..8]), f.meta.target_lat);
        }
        // Every M4TD shot has a thermal and a visible image
        let mut per_shot = std::collections::BTreeMap::<&str, Vec<&str>>::new();
        for f in &result.files { per_shot.entry(&f.shot_key).or_default().push(f.variant.as_deref().unwrap_or("?")); }
        let incomplete: Vec<_> = per_shot.iter().filter(|(_, v)| v.len() != 2).collect();
        println!("{} files, {} shots, incomplete: {:?}", result.files.len(), per_shot.len(), incomplete);

        let out = std::env::temp_dir().join(format!("didrop-test-{}", std::process::id()));
        let items = result.files.iter().map(|f| ImportItem {
            src: f.path.clone(), dest_dir: out.join("flight").display().to_string(), fingerprint: f.fingerprint.clone(), kind: f.kind.clone(),
        }).collect();
        let started = std::time::Instant::now();
        let imported = import(items, &out.join("thumbs"), |_| {});
        println!("Import: {:?}", started.elapsed());
        assert!(imported.iter().all(|r| r.error.is_none() && r.thumb_path.is_some()), "{imported:?}");

        // Second import of the same files: same target paths, no copies with _1
        let again = import(result.files.iter().map(|f| ImportItem {
            src: f.path.clone(), dest_dir: out.join("flight").display().to_string(), fingerprint: f.fingerprint.clone(), kind: f.kind.clone(),
        }).collect(), &out.join("thumbs"), |_| {});
        assert_eq!(again.iter().map(|r| &r.dest_path).collect::<Vec<_>>(), imported.iter().map(|r| &r.dest_path).collect::<Vec<_>>());
        let _ = fs::remove_dir_all(out);
    }
}

/// Thumbnail for a single image file (e.g. a comparison image) in the thumbnail folder.
/// The name depends on path, size and modification time – a changed file gets a new one.
pub fn thumbnail_for(src: &Path, thumbs_dir: &Path) -> Result<PathBuf, String> {
    let ext = src.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("jpg") | Some("jpeg")) {
        return Err("Vorschau nur für JPEG-Bilder".into());
    }
    let meta = std::fs::metadata(src).map_err(|_| format!("Datei fehlt: {}", src.display()))?;
    let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let key = blake3::hash(format!("{}|{}|{}", src.display(), meta.len(), modified).as_bytes()).to_hex();
    let dest = thumbs_dir.join(format!("file-{}.jpg", &key[..24]));
    if !dest.exists() {
        thumbnail::create_sized(src, &dest, 960)?;
    }
    Ok(dest)
}
