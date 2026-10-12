//! Nur für die Entwicklung: macht Scan und Import über die Kommandozeile verfügbar,
//! damit die Browser-Variante (Vite-Dev-Server, siehe config/vite/dev_bridge.js)
//! mit echten Dateien und echtem Rust-Code getestet werden kann.
//!
//!   echo '["/pfad"]' | didrop-dev scan
//!   echo '{"items": [...], "thumbs_dir": "..."}' | didrop-dev import

use std::io::Read;
use std::path::PathBuf;

use di_drop_lib::media;

#[derive(serde::Deserialize)]
struct ImportRequest {
    items: Vec<media::ImportItem>,
    thumbs_dir: PathBuf,
}

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("stdin");
    let output = match std::env::args().nth(1).as_deref() {
        Some("scan") => {
            let paths: Vec<String> = serde_json::from_str(&input).expect("JSON-Liste von Pfaden");
            serde_json::to_string(&media::scan(&paths))
        }
        Some("import") => {
            let req: ImportRequest = serde_json::from_str(&input).expect("Import-Anfrage");
            serde_json::to_string(&media::import(req.items, &req.thumbs_dir, |p| {
                eprintln!("{}", serde_json::to_string(&p).unwrap_or_default())
            }))
        }
        _ => {
            eprintln!("Aufruf: didrop-dev scan|import < anfrage.json");
            std::process::exit(2);
        }
    };
    println!("{}", output.expect("JSON"));
}
