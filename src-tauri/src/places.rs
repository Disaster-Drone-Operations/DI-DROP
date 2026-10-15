//! Place list for offline address lookup (place names from GeoNames, CC BY 4.0).
//! public/data/places_de.tsv is bundled; "Aktualisieren" (update) downloads the current list
//! and stores it in the app data – it then takes precedence.

use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SOURCE: &str = "https://download.geonames.org/export/dump/DE.zip";
const FILE: &str = "places_de.tsv";
/// Skip historical, abandoned or destroyed places
const SKIP: [&str; 4] = ["PPLH", "PPLQ", "PPLW", "PPLCH"];

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(FILE))
}

/// GeoNames raw data (DE.txt) → "name\tlatitude\tlongitude\tpopulation" per populated place
/// (same format as script/build_places.mjs)
pub fn build(raw: &str) -> (String, usize) {
    let mut out = String::from("# GeoNames (geonames.org), CC BY 4.0 – updated by di-drop\n");
    let mut count = 0;
    for line in raw.lines() {
        let c: Vec<&str> = line.split('\t').collect();
        if c.len() < 15 || c[6] != "P" || SKIP.contains(&c[7]) {
            continue;
        }
        let name = c[1].split_whitespace().collect::<Vec<_>>().join(" ");
        let (Ok(lat), Ok(lon)) = (c[4].parse::<f64>(), c[5].parse::<f64>()) else { continue };
        if name.is_empty() {
            continue;
        }
        let population: u64 = c[14].parse().unwrap_or(0);
        out.push_str(&format!("{name}\t{lat:.5}\t{lon:.5}\t{population}\n"));
        count += 1;
    }
    (out, count)
}

fn count_lines(text: &str) -> usize {
    text.lines().filter(|l| !l.is_empty() && !l.starts_with('#')).count()
}

/// State of the downloaded list: { count, updatedAt } or null (= bundled list)
#[tauri::command]
pub fn places_info(app: AppHandle) -> Result<Value, String> {
    let file = path(&app)?;
    let Ok(meta) = std::fs::metadata(&file) else { return Ok(Value::Null) };
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let updated: chrono_like::Millis = meta.modified().map_err(|e| e.to_string())?.into();
    Ok(json!({ "count": count_lines(&text), "updatedAt": updated.0 }))
}

/// Reads the downloaded list (null = none present → use the bundled one)
#[tauri::command]
pub fn places_read(app: AppHandle) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path(&app)?) {
        Ok(text) => Ok(Some(text)),
        Err(_) => Ok(None),
    }
}

/// Downloads the current place list from GeoNames, unzips, filters and stores it
#[tauri::command]
pub async fn places_update(app: AppHandle) -> Result<Value, String> {
    let bytes = reqwest::Client::builder()
        .user_agent(concat!("di-drop/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?
        .get(SOURCE)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Download nicht möglich: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Download abgebrochen: {e}"))?;

    let (text, count) = tauri::async_runtime::spawn_blocking(move || -> Result<(String, usize), String> {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("Datei beschädigt: {e}"))?;
        let mut raw = String::new();
        archive.by_name("DE.txt").map_err(|_| "DE.txt fehlt im Download".to_string())?
            .read_to_string(&mut raw).map_err(|e| e.to_string())?;
        Ok(build(&raw))
    })
    .await
    .map_err(|e| e.to_string())??;

    // Sanity check: never accept an almost empty list
    if count < 10_000 {
        return Err(format!("Die geladene Liste enthält nur {count} Orte – sie wird nicht übernommen."));
    }
    let file = path(&app)?;
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    places_info(app)
}

mod chrono_like {
    /// SystemTime → milliseconds since 1970 (for JS Date)
    pub struct Millis(pub u64);
    impl From<std::time::SystemTime> for Millis {
        fn from(t: std::time::SystemTime) -> Self {
            Millis(t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn keeps_only_populated_places() {
        let raw = "1\tMusterdorf\tMusterdorf\t\t50.50000\t11.00000\tP\tPPL\tDE\t\t15\t\t\t\t0\n\
                   2\tSchneekopf\tSchneekopf\t\t50.68\t10.75\tT\tMT\tDE\t\t15\t\t\t\t0\n\
                   3\tWüstung\tWuestung\t\t50.1\t11.1\tP\tPPLQ\tDE\t\t15\t\t\t\t0\n";
        let (text, count) = super::build(raw);
        assert_eq!(count, 1);
        assert!(text.contains("Musterdorf\t50.50000\t11.00000\t0\n"));
    }
}
