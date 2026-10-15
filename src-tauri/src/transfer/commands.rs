//! Tauri commands for delivering files (called from lib/platform/tauri.js)

use super::{folder, nextcloud, register, unregister, Outcome};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

#[derive(Serialize, Clone)]
pub struct Progress {
    pub done: u64,
    pub total: u64,
}

/// Report progress at most every 100 ms (and always at the end)
fn throttled(channel: Channel<Progress>) -> Arc<dyn Fn(u64, u64) + Send + Sync> {
    let last = Mutex::new(Instant::now() - Duration::from_secs(1));
    Arc::new(move |done, total| {
        let mut last = last.lock().unwrap();
        if done == total || last.elapsed() >= Duration::from_millis(100) {
            *last = Instant::now();
            let _ = channel.send(Progress { done, total });
        }
    })
}

#[tauri::command]
pub async fn transfer_copy(id: String, src: PathBuf, dest: PathBuf, on_progress: Channel<Progress>) -> Result<Outcome, String> {
    let cancel = register(&id);
    let report = throttled(on_progress);
    let result = tauri::async_runtime::spawn_blocking(move || folder::copy(&src, &dest, &cancel, |d, t| report(d, t)))
        .await
        .map_err(|e| e.to_string())?;
    unregister(&id);
    result
}

#[tauri::command]
pub async fn transfer_nextcloud(id: String, src: PathBuf, dir: String, file_name: String, on_progress: Channel<Progress>) -> Result<Outcome, String> {
    let cancel = register(&id);
    let result = nextcloud::upload(&src, &dir, &file_name, cancel, throttled(on_progress)).await;
    unregister(&id);
    result
}

#[tauri::command]
pub fn transfer_cancel(id: String) -> bool {
    super::cancel(&id)
}

#[tauri::command]
pub fn nc_account() -> Result<Option<nextcloud::AccountInfo>, String> {
    Ok(nextcloud::load()?.as_ref().map(Into::into))
}

#[tauri::command]
pub async fn nc_login_start(server: String) -> Result<serde_json::Value, String> {
    nextcloud::login_start(&server).await
}

#[tauri::command]
pub async fn nc_login_poll(server: String, endpoint: String, token: String) -> Result<Option<nextcloud::AccountInfo>, String> {
    nextcloud::login_poll(&server, &endpoint, &token).await
}

#[tauri::command]
pub async fn nc_login_manual(server: String, login: String, password: String) -> Result<nextcloud::AccountInfo, String> {
    nextcloud::login_manual(&server, &login, &password).await
}

#[tauri::command]
pub async fn nc_test() -> Result<serde_json::Value, String> {
    nextcloud::test().await
}

#[tauri::command]
pub fn nc_forget() -> Result<(), String> {
    nextcloud::forget()
}

#[tauri::command]
pub async fn nc_list(path: String) -> Result<Vec<nextcloud::Folder>, String> {
    nextcloud::list_folders(&path).await
}

#[tauri::command]
pub async fn nc_mkdir(path: String) -> Result<(), String> {
    nextcloud::create_folder(&path).await
}
