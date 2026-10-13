//! Ziel "Ordner": Datei kopieren, z. B. auf einen USB-Stick.
//! Schreibt erst in "<name>.didrop-part" und benennt am Ende um – ein abgebrochener
//! Vorgang hinterlässt keine halbe Datei unter dem richtigen Namen.
//! Vorhandene Dateien werden nie überschrieben: gleiche Größe → übersprungen,
//! sonst Ausweichname "…_2.JPG".

use super::{check_file_name, suffixed, Outcome, CANCELED, MAX_SUFFIX};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

const CHUNK: usize = 1 << 20;

pub fn copy(src: &Path, dest: &Path, cancel: &AtomicBool, mut progress: impl FnMut(u64, u64)) -> Result<Outcome, String> {
    let total = std::fs::metadata(src).map_err(|_| format!("Quelldatei fehlt: {}", src.display()))?.len();
    let dir = dest.parent().ok_or("Ungültiges Ziel")?;
    let file_name = dest.file_name().and_then(|n| n.to_str()).ok_or("Ungültiges Ziel")?;
    check_file_name(file_name)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Zielordner nicht beschreibbar ({}): {e}", dir.display()))?;

    // Freien Namen suchen (oder dieselbe Datei, die schon da ist)
    let mut target = None;
    for n in 1..=MAX_SUFFIX {
        let name = if n == 1 { file_name.to_string() } else { suffixed(file_name, n) };
        let candidate = dir.join(&name);
        match std::fs::metadata(&candidate) {
            Ok(m) if m.len() == total => {
                progress(total, total);
                return Ok(Outcome { bytes: 0, skipped: true, name: (n > 1).then_some(name) });
            }
            Ok(_) => continue, // andere Datei gleichen Namens → nicht anfassen
            Err(_) => {
                target = Some((candidate, (n > 1).then_some(name)));
                break;
            }
        }
    }
    let (dest, renamed) = target.ok_or("Zu viele gleichnamige Dateien im Zielordner.")?;
    let part = dir.join(format!("{}.didrop-part", dest.file_name().unwrap().to_string_lossy()));

    let result = (|| -> Result<u64, String> {
        let mut input = File::open(src).map_err(|e| e.to_string())?;
        let mut output = File::create(&part).map_err(|e| format!("Ziel nicht beschreibbar: {e}"))?;
        let mut buf = vec![0u8; CHUNK];
        let mut done = 0u64;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(CANCELED.into());
            }
            let n = input.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            output.write_all(&buf[..n]).map_err(|e| format!("Schreiben fehlgeschlagen (Datenträger voll oder entfernt?): {e}"))?;
            done += n as u64;
            progress(done, total);
        }
        output.sync_all().map_err(|e| e.to_string())?;
        Ok(done)
    })();

    let finish = |bytes| {
        // Kurz vor dem Umbenennen erneut prüfen: nie eine inzwischen entstandene Datei ersetzen
        if dest.exists() {
            return Err("Im Zielordner ist währenddessen eine gleichnamige Datei entstanden – bitte erneut versuchen.".to_string());
        }
        std::fs::rename(&part, &dest).map_err(|e| e.to_string())?;
        Ok(Outcome { bytes, skipped: false, name: renamed.clone() })
    };
    match result.and_then(finish) {
        Ok(outcome) => Ok(outcome),
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("didrop-folder-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copies_with_progress_and_skips_identical() {
        let dir = tmp("copy");
        let src = dir.join("a.jpg");
        std::fs::write(&src, vec![7u8; 3 * CHUNK + 10]).unwrap();
        let dest = dir.join("out/sub/a.jpg");
        let mut steps = vec![];
        let flag = AtomicBool::new(false);
        let r = copy(&src, &dest, &flag, |d, t| steps.push((d, t))).unwrap();
        assert_eq!(r, Outcome { bytes: 3 * CHUNK as u64 + 10, skipped: false, name: None });
        assert_eq!(steps.len(), 4);
        assert_eq!(std::fs::read(&dest).unwrap().len(), 3 * CHUNK + 10);
        assert!(copy(&src, &dest, &flag, |_, _| {}).unwrap().skipped);
    }

    #[test]
    fn never_overwrites_other_files() {
        let dir = tmp("keep");
        let src = dir.join("a.jpg");
        std::fs::write(&src, b"neu").unwrap();
        std::fs::create_dir_all(dir.join("out")).unwrap();
        std::fs::write(dir.join("out/a.jpg"), b"fremde datei").unwrap();
        let flag = AtomicBool::new(false);
        let r = copy(&src, &dir.join("out/a.jpg"), &flag, |_, _| {}).unwrap();
        assert_eq!(r.name.as_deref(), Some("a_2.jpg"));
        assert_eq!(std::fs::read(dir.join("out/a.jpg")).unwrap(), b"fremde datei");
        assert_eq!(std::fs::read(dir.join("out/a_2.jpg")).unwrap(), b"neu");
        // erneut: a_2.jpg ist dieselbe Datei → übersprungen
        assert!(copy(&src, &dir.join("out/a.jpg"), &flag, |_, _| {}).unwrap().skipped);
    }

    #[test]
    fn cancel_leaves_no_file() {
        let dir = tmp("cancel");
        let src = dir.join("b.jpg");
        std::fs::write(&src, vec![1u8; 2 * CHUNK]).unwrap();
        let dest = dir.join("b-out.jpg");
        let flag = AtomicBool::new(true);
        assert_eq!(copy(&src, &dest, &flag, |_, _| {}).unwrap_err(), CANCELED);
        assert!(!dest.exists());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    }
}
