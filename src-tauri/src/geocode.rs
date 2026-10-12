//! Adresse zu Koordinaten über den OpenStreetMap-Dienst Nominatim.
//! Nutzungsregeln: eindeutige App-Kennung (User-Agent), höchstens eine Anfrage pro Sekunde.
//! https://operations.osmfoundation.org/policies/nominatim/

use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

static LAST_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

#[tauri::command]
pub async fn reverse_geocode(lat: f64, lon: f64) -> Result<Value, String> {
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return Err("Ungültige Koordinaten".into());
    }
    // Abstand zur vorigen Anfrage einhalten
    let wait = {
        let mut last = LAST_REQUEST.lock().map_err(|e| e.to_string())?;
        let now = Instant::now();
        let next = last.map(|t| t + Duration::from_millis(1100)).unwrap_or(now).max(now);
        *last = Some(next);
        next - now
    };
    tokio::time::sleep(wait).await;

    let response = reqwest::Client::builder()
        .user_agent(concat!("di-drop/", env!("CARGO_PKG_VERSION"), " (Drohnen-App Bergwacht Thueringen)"))
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?
        .get(format!(
            "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={lat:.6}&lon={lon:.6}&zoom=18&addressdetails=1&accept-language=de"
        ))
        .send()
        .await
        .map_err(|e| format!("Adressdienst nicht erreichbar: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Adressdienst antwortet mit Status {}", response.status()));
    }
    response.json().await.map_err(|e| e.to_string())
}
