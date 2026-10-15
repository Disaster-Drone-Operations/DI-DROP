//! Development only (as an example program, so it never ends up in the app bundles):
//!   cargo build --example didrop-dev
//! exposes scan and import on the command line,
//! so the browser variant (Vite dev server, see config/vite/dev_bridge.js)
//! can be tested with real files and real Rust code.
//!
//!   echo '["/path"]' | didrop-dev scan
//!   echo '{"items": [...], "thumbs_dir": "..."}' | didrop-dev import
//!   echo '{"src": "...", "dest": "..."}' | didrop-dev copy            (progress on stderr)
//!   echo '{"src": "...", "dir": "/folder", "file_name": "x.jpg"}' | didrop-dev nc-upload
//!   echo '{"action": "test", ...}' | didrop-dev nc                    (Nextcloud management)
//!   echo '{}' | didrop-dev sdcard-list                                (cards; test cards via DIDROP_SDCARD_ROOTS)
//!   echo '{"root": "...", "items": [{"src", "copy"}]}' | didrop-dev sdcard-delete
//! Nextcloud credentials of the bridge: file from DIDROP_NC_ACCOUNT_FILE instead of the keychain.

use std::io::Read;
use std::path::PathBuf;

use di_drop_lib::media;
use di_drop_lib::transfer::{folder, nextcloud};
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

fn report(done: u64, total: u64) {
    eprintln!("{}", json!({ "done": done, "total": total }));
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread().enable_all().build().expect("runtime")
}

/// Result as JSON; errors as {"error": "..."} (exit code stays 0 so the bridge passes it on)
fn result<T: serde::Serialize>(r: Result<T, String>) -> Result<String, serde_json::Error> {
    match r {
        Ok(v) => serde_json::to_string(&v),
        Err(e) => serde_json::to_string(&json!({ "error": e })),
    }
}

fn to_value<T: serde::Serialize>(v: Result<T, String>) -> Result<Value, String> {
    v.map(|x| serde_json::to_value(x).unwrap())
}

fn nc(req: Value) -> Result<Value, String> {
    let s = |k: &str| req[k].as_str().unwrap_or_default().to_string();
    let rt = runtime();
    match s("action").as_str() {
        "account" => to_value(nextcloud::load().map(|a| a.as_ref().map(nextcloud::AccountInfo::from))),
        "login_start" => rt.block_on(nextcloud::login_start(&s("server"))),
        "login_poll" => to_value(rt.block_on(nextcloud::login_poll(&s("server"), &s("endpoint"), &s("token")))),
        "login_manual" => to_value(rt.block_on(nextcloud::login_manual(&s("server"), &s("login"), &s("password")))),
        "test" => rt.block_on(nextcloud::test()),
        "forget" => to_value(nextcloud::forget()),
        "list" => to_value(rt.block_on(nextcloud::list_folders(&s("path")))),
        "mkdir" => to_value(rt.block_on(nextcloud::create_folder(&s("path")))),
        other => Err(format!("Unknown action: {other}")),
    }
}

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
            let paths: Vec<String> = serde_json::from_str(&input).expect("JSON list of paths");
            serde_json::to_string(&media::scan(&paths))
        }
        Some("import") => {
            let req: ImportRequest = serde_json::from_str(&input).expect("import request");
            serde_json::to_string(&media::import(req.items, &req.thumbs_dir, |p| {
                eprintln!("{}", serde_json::to_string(&p).unwrap_or_default())
            }))
        }
        Some("copy") => {
            let req: Value = serde_json::from_str(&input).expect("JSON");
            let flag = AtomicBool::new(false);
            result(folder::copy(req["src"].as_str().unwrap_or("").as_ref(), req["dest"].as_str().unwrap_or("").as_ref(), &flag, report))
        }
        Some("nc-upload") => {
            let req: Value = serde_json::from_str(&input).expect("JSON");
            let src = std::path::PathBuf::from(req["src"].as_str().unwrap_or(""));
            let s = |k: &str| req[k].as_str().unwrap_or("").to_string();
            result(runtime().block_on(nextcloud::upload(&src, &s("dir"), &s("file_name"), Arc::new(AtomicBool::new(false)), Arc::new(report))))
        }
        Some("thumb") => {
            let req: Value = serde_json::from_str(&input).expect("JSON");
            let dir = std::path::PathBuf::from(req["thumbs_dir"].as_str().unwrap_or(""));
            result(media::thumbnail_for(req["path"].as_str().unwrap_or("").as_ref(), &dir).map(|p| p.to_string_lossy().into_owned()))
        }
        Some("flightlogs-import") | Some("flightlogs-scan") => {
            let req: Value = serde_json::from_str(&input).expect("JSON");
            let known = req["known"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
            let dest = std::path::PathBuf::from(req["dest"].as_str().unwrap_or(""));
            if std::env::args().nth(1).as_deref() == Some("flightlogs-scan") {
                result(Ok::<_, String>(di_drop_lib::flightlogs::scan_local(&dest, &known)))
            } else {
                result(di_drop_lib::flightlogs::import_folder(req["src"].as_str().unwrap_or("").as_ref(), &dest, &known, req["include_dat"].as_bool().unwrap_or(false)))
            }
        }
        Some("sdcard-list") => serde_json::to_string(&di_drop_lib::sdcard::list()),
        Some("sdcard-delete") => {
            let req: Value = serde_json::from_str(&input).expect("JSON");
            let items: Vec<di_drop_lib::sdcard::DeleteItem> = serde_json::from_value(req["items"].clone()).expect("items");
            result(di_drop_lib::sdcard::delete_imported(req["root"].as_str().unwrap_or("").as_ref(), &items))
        }
        Some("nc") => result(nc(serde_json::from_str(&input).expect("JSON"))),
        _ => {
            eprintln!("Usage: didrop-dev scan|import|copy|nc-upload|thumb|flightlogs-import|flightlogs-scan|sdcard-list|sdcard-delete|nc < request.json");
            std::process::exit(2);
        }
    };
    println!("{}", output.expect("JSON"));
}
