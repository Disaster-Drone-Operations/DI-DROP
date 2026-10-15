//! App updates from the GitHub releases (signed, see docs/release.md).
//!
//! By default the endpoint from tauri.conf.json is used (`…/releases/latest/download/latest.json`),
//! which GitHub resolves to the newest *full* release. Testers can opt in to pre-releases: then the
//! newest non-draft release – pre-release or not – that carries a `latest.json` is looked up via the
//! GitHub API and its `latest.json` is used instead. Signature checks are the same in both cases.

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const RELEASES_API: &str = "https://api.github.com/repos/Disaster-Drone-Operations/DI-DROP/releases?per_page=20";

/// Update found by the last check, kept until it is installed
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    body: Option<String>,
    date: Option<String>,
    prerelease: bool,
}

/// `latest.json` of the newest non-draft release including pre-releases → (url, is_prerelease)
async fn newest_release_manifest() -> Result<Option<(String, bool)>, String> {
    let releases: Vec<Value> = reqwest::Client::builder()
        .user_agent(concat!("di-drop/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Update-Server nicht erreichbar: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    // GitHub lists releases newest first
    Ok(releases
        .iter()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false))
        .find_map(|r| {
            let manifest = r["assets"].as_array()?.iter().find(|a| a["name"] == "latest.json")?;
            let url = manifest["browser_download_url"].as_str()?.to_string();
            Some((url, r["prerelease"].as_bool().unwrap_or(false)))
        }))
}

#[tauri::command]
pub async fn app_update_check(
    app: AppHandle,
    include_prereleases: bool,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let mut builder = app.updater_builder();
    let mut prerelease = false;
    if include_prereleases {
        match newest_release_manifest().await? {
            Some((url, is_pre)) => {
                prerelease = is_pre;
                let url = url.parse().map_err(|e| format!("Invalid manifest URL: {e}"))?;
                builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
            }
            None => return Ok(None), // no release with a manifest yet
        }
    }
    let update = builder.build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        body: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
        prerelease,
    });
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

/// Download and install the update found by the last check. Progress events mirror the
/// JS plugin: { event: "Started" | "Progress" | "Finished", data }
#[tauri::command]
pub async fn app_update_install(pending: State<'_, PendingUpdate>, on_progress: Channel<Value>) -> Result<(), String> {
    let update = pending.0.lock().unwrap().take().ok_or("Kein Update gefunden – bitte erneut suchen.")?;
    let mut started = false;
    update
        .download_and_install(
            |chunk, total| {
                if !started {
                    started = true;
                    let _ = on_progress.send(json!({ "event": "Started", "data": { "contentLength": total } }));
                }
                let _ = on_progress.send(json!({ "event": "Progress", "data": { "chunkLength": chunk } }));
            },
            || {
                let _ = on_progress.send(json!({ "event": "Finished" }));
            },
        )
        .await
        .map_err(|e| e.to_string())
}
