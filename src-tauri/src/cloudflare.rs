//! Zugriff auf die Cloudflare-API für den Einrichtungsassistenten des Standort-Relays.
//!
//! Der API-Token liegt ausschließlich im Schlüsselbund des Betriebssystems (macOS-Schlüsselbund,
//! Windows-Anmeldeinformationsverwaltung). Die Oberfläche kann ihn speichern und löschen,
//! aber nie auslesen – nur diese Befehle benutzen ihn. Er landet nie in Logs, im Worker,
//! im QR-Code oder in WebSocket-Nachrichten und wird für den normalen Standortbetrieb nicht gebraucht.

use serde_json::Value;

const SERVICE: &str = "app.didrop.desktop";
const TOKEN_ENTRY: &str = "cloudflare-api-token";
const API: &str = "https://api.cloudflare.com/client/v4";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, TOKEN_ENTRY).map_err(|e| format!("Schlüsselbund nicht verfügbar: {e}"))
}

fn token() -> Result<String, String> {
    entry()?.get_password().map_err(|_| "Kein Cloudflare-Schlüssel gespeichert".to_string())
}

#[tauri::command]
pub fn cf_set_token(token: String) -> Result<(), String> {
    let token = token.trim();
    if token.len() < 20 || !token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Das sieht nicht wie ein Cloudflare-API-Token aus".into());
    }
    entry()?.set_password(token).map_err(|e| format!("Konnte nicht im Schlüsselbund speichern: {e}"))
}

#[tauri::command]
pub fn cf_has_token() -> bool {
    token().is_ok()
}

#[tauri::command]
pub fn cf_delete_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Nur die Endpunkte, die der Assistent braucht – keine beliebigen API-Aufrufe
fn check_path(path: &str) -> Result<(), String> {
    let allowed = path == "/user/tokens/verify" || path.starts_with("/accounts");
    let clean = !path.contains("..") && path.chars().all(|c| c.is_ascii_alphanumeric() || "/_-?=&.".contains(c));
    if allowed && clean { Ok(()) } else { Err(format!("Nicht erlaubter API-Pfad: {path}")) }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("di-drop/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

/// Antwort der Cloudflare-API: { status: <HTTP-Status>, body: <JSON> }
async fn respond(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status().as_u16();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    Ok(serde_json::json!({ "status": status, "body": body }))
}

#[tauri::command]
pub async fn cf_api(method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    check_path(&path)?;
    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let mut request = client()?.request(method, format!("{API}{path}")).bearer_auth(token()?);
    if let Some(body) = body {
        request = request.json(&body);
    }
    respond(request.send().await.map_err(|e| format!("Cloudflare nicht erreichbar: {e}"))?).await
}

/// Worker als ES-Modul hochladen (PUT …/workers/scripts/{name}, multipart) – deployt sofort
#[tauri::command]
pub async fn cf_upload_worker(account_id: String, script_name: String, metadata: Value, script: String) -> Result<Value, String> {
    let valid_account = account_id.len() == 32 && account_id.chars().all(|c| c.is_ascii_hexdigit());
    let valid_name = !script_name.is_empty() && script_name.len() <= 63
        && script_name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !script_name.starts_with('-') && !script_name.ends_with('-');
    if !valid_account || !valid_name {
        return Err("Ungültige Konto-ID oder ungültiger Worker-Name".into());
    }
    let form = reqwest::multipart::Form::new()
        .part("metadata", reqwest::multipart::Part::text(metadata.to_string()).mime_str("application/json").map_err(|e| e.to_string())?)
        .part("worker.js", reqwest::multipart::Part::text(script).file_name("worker.js")
            .mime_str("application/javascript+module").map_err(|e| e.to_string())?);
    let response = client()?
        .put(format!("{API}/accounts/{account_id}/workers/scripts/{script_name}"))
        .bearer_auth(token()?)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Cloudflare nicht erreichbar: {e}"))?;
    respond(response).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_wizard_paths_are_allowed() {
        assert!(super::check_path("/user/tokens/verify").is_ok());
        assert!(super::check_path("/accounts?per_page=50").is_ok());
        assert!(super::check_path("/accounts/abc/workers/subdomain").is_ok());
        assert!(super::check_path("/zones").is_err());
        assert!(super::check_path("/accounts/../user").is_err());
        assert!(super::check_path("/accounts/x/y?a=<script>").is_err());
    }
}
