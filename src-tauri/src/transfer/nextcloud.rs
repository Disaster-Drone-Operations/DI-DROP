//! Ziel "Nextcloud" über WebDAV.
//!
//! Anmeldung bevorzugt per Nextcloud "Login Flow v2": di-drop öffnet die Anmeldeseite der
//! Nextcloud im Browser, der Nutzer meldet sich dort an und di-drop bekommt ein eigenes
//! App-Passwort (jederzeit in der Nextcloud widerrufbar). Alternativ Benutzer + App-Passwort.
//! Der Zugang liegt im Schlüsselbund des Betriebssystems und wird nie an die Oberfläche gegeben.

use super::{check_file_name, suffixed, Outcome, CANCELED, MAX_SUFFIX};
use futures_util::stream;
use reqwest::{Client, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::io::AsyncReadExt;

const SERVICE: &str = "app.didrop.desktop";
const ENTRY: &str = "nextcloud-account";
const CHUNK: usize = 256 * 1024;

#[derive(Serialize, Deserialize, Clone)]
pub struct Account {
    pub server: String,
    pub login_name: String,
    pub user_id: String,
    pub password: String,
}

/// Was die Oberfläche sehen darf (ohne Passwort)
#[derive(Serialize)]
pub struct AccountInfo {
    pub server: String,
    pub login_name: String,
    pub user_id: String,
}

impl From<&Account> for AccountInfo {
    fn from(a: &Account) -> Self {
        AccountInfo { server: a.server.clone(), login_name: a.login_name.clone(), user_id: a.user_id.clone() }
    }
}

fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent(concat!("di-drop/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("HTTP-Client")
    })
}

// ── Zugang speichern ─────────────────────────────────────────────────────
// Für die Entwicklung (Browser-Brücke) kann statt des Schlüsselbunds eine Datei dienen:
// DIDROP_NC_ACCOUNT_FILE=/pfad/datei.json

fn dev_file() -> Option<std::path::PathBuf> {
    std::env::var_os("DIDROP_NC_ACCOUNT_FILE").map(Into::into)
}

pub fn load() -> Result<Option<Account>, String> {
    let raw = if let Some(file) = dev_file() {
        std::fs::read_to_string(file).ok()
    } else {
        match keyring::Entry::new(SERVICE, ENTRY).map_err(|e| e.to_string())?.get_password() {
            Ok(raw) => Some(raw),
            Err(keyring::Error::NoEntry) => None,
            Err(e) => return Err(format!("Schlüsselbund nicht lesbar: {e}")),
        }
    };
    Ok(raw.and_then(|r| serde_json::from_str(&r).ok()))
}

fn store(account: &Account) -> Result<(), String> {
    let raw = serde_json::to_string(account).map_err(|e| e.to_string())?;
    if let Some(file) = dev_file() {
        return std::fs::write(file, raw).map_err(|e| e.to_string());
    }
    keyring::Entry::new(SERVICE, ENTRY)
        .and_then(|e| e.set_password(&raw))
        .map_err(|e| format!("Schlüsselbund nicht beschreibbar: {e}"))
}

pub fn forget() -> Result<(), String> {
    if let Some(file) = dev_file() {
        let _ = std::fs::remove_file(file);
        return Ok(());
    }
    match keyring::Entry::new(SERVICE, ENTRY).map_err(|e| e.to_string())?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn account() -> Result<Account, String> {
    load()?.ok_or_else(|| "Keine Nextcloud eingerichtet (Einstellungen → Nextcloud).".to_string())
}

// ── Adressen ─────────────────────────────────────────────────────────────

/// "cloud.example.de/" → "https://cloud.example.de"; nur https (http nur für localhost-Tests)
pub fn normalize_server(input: &str) -> Result<String, String> {
    let mut s = input.trim().trim_end_matches('/').to_string();
    if !s.contains("://") {
        s = format!("https://{s}");
    }
    for suffix in ["/index.php/login", "/index.php", "/login", "/apps/files"] {
        if let Some(stripped) = s.strip_suffix(suffix) {
            s = stripped.to_string();
        }
    }
    let url = Url::parse(&s).map_err(|_| "Ungültige Adresse".to_string())?;
    let local = matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Die Nextcloud muss über https erreichbar sein.".into());
    }
    Ok(s)
}

/// WebDAV-Adresse einer Datei/eines Ordners, z. B. "/Einsätze/2026_10_11__B3/x.jpg"
fn dav_url(account: &Account, path: &str) -> Result<Url, String> {
    let mut url = Url::parse(&format!("{}/remote.php/dav/files/", account.server)).map_err(|e| e.to_string())?;
    {
        let mut segments = url.path_segments_mut().map_err(|_| "Ungültige Adresse")?;
        segments.pop_if_empty().push(&account.user_id);
        for part in path.split('/').filter(|p| !p.is_empty()) {
            if part == ".." || part == "." {
                return Err("Ungültiger Pfad".into());
            }
            segments.push(part);
        }
    }
    Ok(url)
}

fn http_error(status: StatusCode) -> String {
    match status.as_u16() {
        401 => "Nextcloud-Anmeldung abgelaufen oder widerrufen – in den Einstellungen neu anmelden.".into(),
        403 => "Keine Berechtigung für diesen Ordner in der Nextcloud.".into(),
        404 => "Ordner in der Nextcloud nicht gefunden.".into(),
        423 => "Die Datei ist in der Nextcloud gerade gesperrt.".into(),
        507 => "Der Speicherplatz in der Nextcloud ist voll.".into(),
        s => format!("Nextcloud antwortet mit Status {s}."),
    }
}

fn net_error(e: reqwest::Error) -> String {
    if e.is_timeout() || e.is_connect() {
        "Nextcloud nicht erreichbar – Internetverbindung prüfen.".into()
    } else {
        format!("Verbindung zur Nextcloud gestört: {e}")
    }
}

// ── Anmeldung ────────────────────────────────────────────────────────────

/// Benutzerkennung (für WebDAV), Anzeigename und Speicherplatz über die OCS-Schnittstelle
async fn user_info(server: &str, login: &str, password: &str) -> Result<Value, String> {
    let response = client()
        .get(format!("{server}/ocs/v2.php/cloud/user?format=json"))
        .basic_auth(login, Some(password))
        .header("OCS-APIRequest", "true")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(net_error)?;
    if !response.status().is_success() {
        return Err(if response.status() == StatusCode::UNAUTHORIZED {
            "Benutzername oder App-Passwort stimmen nicht.".into()
        } else {
            http_error(response.status())
        });
    }
    let body: Value = response.json().await.map_err(|_| "Das ist keine Nextcloud (unerwartete Antwort).".to_string())?;
    Ok(body["ocs"]["data"].clone())
}

async fn finish_login(server: &str, login: &str, password: &str) -> Result<AccountInfo, String> {
    let info = user_info(server, login, password).await?;
    let user_id = info["id"].as_str().unwrap_or(login).to_string();
    let account = Account { server: server.into(), login_name: login.into(), user_id, password: password.into() };
    store(&account)?;
    Ok((&account).into())
}

/// Login Flow v2 starten: liefert die Anmeldeseite (im Browser öffnen) und die Abfrage-Daten
pub async fn login_start(server: &str) -> Result<Value, String> {
    let server = normalize_server(server)?;
    let response = client()
        .post(format!("{server}/index.php/login/v2"))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(net_error)?;
    if !response.status().is_success() {
        return Err(format!("Unter dieser Adresse antwortet keine Nextcloud ({}).", response.status().as_u16()));
    }
    let body: Value = response.json().await.map_err(|_| "Unter dieser Adresse antwortet keine Nextcloud.".to_string())?;
    let (Some(login), Some(token), Some(endpoint)) =
        (body["login"].as_str(), body["poll"]["token"].as_str(), body["poll"]["endpoint"].as_str())
    else {
        return Err("Unerwartete Antwort der Nextcloud.".into());
    };
    // Abfrage-Adresse muss zur selben Nextcloud gehören
    let same_host = Url::parse(endpoint).ok().and_then(|u| u.host_str().map(String::from))
        == Url::parse(&server).ok().and_then(|u| u.host_str().map(String::from));
    if !same_host {
        return Err("Unerwartete Antwort der Nextcloud (fremde Adresse).".into());
    }
    Ok(json!({ "server": server, "login_url": login, "token": token, "endpoint": endpoint }))
}

/// Ist die Anmeldung im Browser abgeschlossen? → Zugang speichern (sonst null)
pub async fn login_poll(server: &str, endpoint: &str, token: &str) -> Result<Option<AccountInfo>, String> {
    let response = client()
        .post(endpoint)
        .form(&[("token", token)])
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(net_error)?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None); // noch nicht angemeldet
    }
    if !response.status().is_success() {
        return Err(http_error(response.status()));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    let login = body["loginName"].as_str().ok_or("Unerwartete Antwort der Nextcloud.")?;
    let password = body["appPassword"].as_str().ok_or("Unerwartete Antwort der Nextcloud.")?;
    finish_login(&normalize_server(body["server"].as_str().unwrap_or(server))?, login, password).await.map(Some)
}

/// Manuell: Benutzer + App-Passwort
pub async fn login_manual(server: &str, login: &str, password: &str) -> Result<AccountInfo, String> {
    finish_login(&normalize_server(server)?, login.trim(), password.trim()).await
}

/// Verbindung testen: Anmeldung gültig, WebDAV erreichbar; liefert Anzeigename und freien Speicher
pub async fn test() -> Result<Value, String> {
    let account = account()?;
    let info = user_info(&account.server, &account.login_name, &account.password).await?;
    list(&account, "/").await?;
    Ok(json!({
        "server": account.server,
        "login_name": account.login_name,
        "display_name": info["display-name"].as_str().or(info["displayname"].as_str()),
        "quota_free": info["quota"]["free"].as_i64(),
    }))
}

// ── Ordner ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct Folder {
    pub name: String,
    pub path: String,
}

/// Unterordner eines Ordners (PROPFIND, Tiefe 1)
pub async fn list(account: &Account, path: &str) -> Result<Vec<Folder>, String> {
    let url = dav_url(account, path)?;
    let response = client()
        .request(Method::from_bytes(b"PROPFIND").unwrap(), url.clone())
        .basic_auth(&account.login_name, Some(&account.password))
        .header("Depth", "1")
        .header("Content-Type", "application/xml")
        .body(r#"<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(net_error)?;
    if response.status().as_u16() != 207 {
        return Err(http_error(response.status()));
    }
    let xml = response.text().await.map_err(|e| e.to_string())?;
    let own = url.path().trim_end_matches('/').to_string();
    let base = path.trim_end_matches('/');
    let mut folders = parse_folders(&xml)?
        .into_iter()
        .filter(|href| href.trim_end_matches('/') != own)
        .filter_map(|href| {
            let name = percent_encoding::percent_decode_str(href.trim_end_matches('/').rsplit('/').next()?)
                .decode_utf8()
                .ok()?
                .to_string();
            Some(Folder { path: format!("{base}/{name}"), name })
        })
        .collect::<Vec<_>>();
    folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(folders)
}

/// hrefs aller Ordner in einer PROPFIND-Antwort
fn parse_folders(xml: &str) -> Result<Vec<String>, String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| format!("Unerwartete Antwort der Nextcloud: {e}"))?;
    Ok(doc
        .descendants()
        .filter(|n| n.tag_name().name() == "response")
        .filter(|r| r.descendants().any(|n| n.tag_name().name() == "collection"))
        .filter_map(|r| r.descendants().find(|n| n.tag_name().name() == "href").and_then(|h| h.text()).map(String::from))
        .collect())
}

/// Ordner samt übergeordneten anlegen (vorhandene sind kein Fehler)
pub async fn mkdirs(account: &Account, dir: &str) -> Result<(), String> {
    let mut current = String::new();
    for part in dir.split('/').filter(|p| !p.is_empty()) {
        current.push('/');
        current.push_str(part);
        let response = client()
            .request(Method::from_bytes(b"MKCOL").unwrap(), dav_url(account, &current)?)
            .basic_auth(&account.login_name, Some(&account.password))
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(net_error)?;
        match response.status().as_u16() {
            201 | 405 => {} // angelegt bzw. gibt es schon
            _ => return Err(http_error(response.status())),
        }
    }
    Ok(())
}

pub async fn create_folder(path: &str) -> Result<(), String> {
    mkdirs(&account()?, path).await
}

pub async fn list_folders(path: &str) -> Result<Vec<Folder>, String> {
    list(&account()?, path).await
}

// ── Hochladen ────────────────────────────────────────────────────────────

/// Größe einer vorhandenen Datei in der Nextcloud (None = gibt es nicht)
async fn remote_size(account: &Account, url: &Url) -> Result<Option<u64>, String> {
    let response = client()
        .head(url.clone())
        .basic_auth(&account.login_name, Some(&account.password))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(net_error)?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(http_error(response.status()));
    }
    Ok(response.headers().get("content-length").and_then(|v| v.to_str().ok()?.parse().ok()))
}

/// Zielordner prüfen: "/Einsätze/X/Auftrag" – nie der Hauptordner, keine "."/".."-Teile
pub fn check_dir(dir: &str) -> Result<String, String> {
    let parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return Err("Kein Zielordner gewählt – in den Hauptordner der Nextcloud lädt di-drop nie hoch.".into());
    }
    if parts.iter().any(|p| *p == "." || *p == ".." || p.contains('\\') || p.chars().any(char::is_control)) {
        return Err(format!("Ungültiger Zielordner: {dir}"));
    }
    Ok(format!("/{}", parts.join("/")))
}

enum Put {
    Done,
    Exists, // Nextcloud meldet: Datei gibt es schon (If-None-Match)
}

/// Datei in einen Ordner der Nextcloud laden. Schreibt ausschließlich in `dir`
/// (Basisordner des Einsatzes + Auftragsordner) und überschreibt nie eine vorhandene Datei:
/// gleiche Größe → übersprungen, sonst Ausweichname "…_2.JPG".
pub async fn upload(
    src: &Path,
    dir: &str,
    file_name: &str,
    cancel: Arc<AtomicBool>,
    progress: Arc<dyn Fn(u64, u64) + Send + Sync>,
) -> Result<Outcome, String> {
    let dir = check_dir(dir)?;
    check_file_name(file_name)?;
    let account = account()?;
    let meta = tokio::fs::metadata(src).await.map_err(|_| format!("Quelldatei fehlt: {}", src.display()))?;
    let total = meta.len();
    mkdirs(&account, &dir).await?;

    for n in 1..=MAX_SUFFIX {
        let name = if n == 1 { file_name.to_string() } else { suffixed(file_name, n) };
        let renamed = (n > 1).then(|| name.clone());
        let url = dav_url(&account, &format!("{dir}/{name}"))?;
        match remote_size(&account, &url).await? {
            Some(size) if size == total => {
                progress(total, total);
                return Ok(Outcome { bytes: 0, skipped: true, name: renamed });
            }
            Some(_) => continue, // andere Datei gleichen Namens → nicht anfassen
            None => {}
        }
        match put(&account, url, src, &meta, cancel.clone(), progress.clone()).await? {
            Put::Done => return Ok(Outcome { bytes: total, skipped: false, name: renamed }),
            Put::Exists => continue, // zwischenzeitlich entstanden → nächster Name
        }
    }
    Err("Zu viele gleichnamige Dateien im Zielordner.".into())
}

async fn put(
    account: &Account,
    url: Url,
    src: &Path,
    meta: &std::fs::Metadata,
    cancel: Arc<AtomicBool>,
    progress: Arc<dyn Fn(u64, u64) + Send + Sync>,
) -> Result<Put, String> {
    let total = meta.len();
    let file = tokio::fs::File::open(src).await.map_err(|e| e.to_string())?;
    let flag = cancel.clone();
    let body = stream::unfold((file, 0u64, false), move |(mut file, done, finished)| {
        let flag = flag.clone();
        let report = progress.clone();
        async move {
            if finished {
                return None;
            }
            if flag.load(Ordering::SeqCst) {
                return Some((Err(std::io::Error::other(CANCELED)), (file, done, true)));
            }
            let mut buf = vec![0u8; CHUNK];
            match file.read(&mut buf).await {
                Ok(0) => None,
                Ok(n) => {
                    buf.truncate(n);
                    let done = done + n as u64;
                    report(done, total);
                    Some((Ok(bytes::Bytes::from(buf)), (file, done, false)))
                }
                Err(e) => Some((Err(e), (file, done, true))),
            }
        }
    });

    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs().to_string());
    let mut request = client()
        .put(url)
        .basic_auth(&account.login_name, Some(&account.password))
        // Sicherung auf Serverseite: nur anlegen, nie eine vorhandene Datei ersetzen
        .header("If-None-Match", "*")
        .header("Content-Length", total.to_string())
        .header("Content-Type", mime_for(src))
        .body(reqwest::Body::wrap_stream(body));
    if let Some(mtime) = mtime {
        request = request.header("X-OC-MTime", mtime); // Aufnahmezeitpunkt der Datei behalten
    }

    let response = match request.send().await {
        Ok(r) => r,
        Err(_) if cancel.load(Ordering::SeqCst) => return Err(CANCELED.into()),
        Err(e) => return Err(net_error(e)),
    };
    if cancel.load(Ordering::SeqCst) {
        return Err(CANCELED.into());
    }
    match response.status().as_u16() {
        412 => Ok(Put::Exists),
        s if (200..300).contains(&s) => Ok(Put::Done),
        _ => Err(http_error(response.status())),
    }
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("mp4") => "video/mp4",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_server_addresses() {
        assert_eq!(normalize_server("cloud.example.de/").unwrap(), "https://cloud.example.de");
        assert_eq!(normalize_server("https://x.de/nc/index.php/login").unwrap(), "https://x.de/nc");
        assert_eq!(normalize_server("http://127.0.0.1:8088").unwrap(), "http://127.0.0.1:8088");
        assert!(normalize_server("http://cloud.example.de").is_err());
    }

    #[test]
    fn encodes_dav_paths() {
        let a = Account { server: "https://x.de".into(), login_name: "a@b.de".into(), user_id: "anna b".into(), password: "".into() };
        assert_eq!(
            dav_url(&a, "/Einsätze/2026_10_11__B3 Musterdorf/a#1.jpg").unwrap().as_str(),
            "https://x.de/remote.php/dav/files/anna%20b/Eins%C3%A4tze/2026_10_11__B3%20Musterdorf/a%231.jpg"
        );
        assert!(dav_url(&a, "/a/../b").is_err());
    }

    #[test]
    fn upload_dir_must_not_be_root_or_escape() {
        assert!(check_dir("/").is_err());
        assert!(check_dir("").is_err());
        assert!(check_dir("/Einsätze/../x").is_err());
        assert_eq!(check_dir("Einsätze//B3/").unwrap(), "/Einsätze/B3");
        assert!(super::super::check_file_name("a/b.jpg").is_err());
        assert!(super::super::check_file_name("..").is_err());
        assert_eq!(super::super::suffixed("x.y.JPG", 2), "x.y_2.JPG");
    }

    #[test]
    fn parses_propfind_folders() {
        let xml = r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
          <d:response><d:href>/remote.php/dav/files/anna/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
          <d:response><d:href>/remote.php/dav/files/anna/Eins%C3%A4tze/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
          <d:response><d:href>/remote.php/dav/files/anna/a.jpg</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
        </d:multistatus>"#;
        assert_eq!(parse_folders(xml).unwrap(), vec!["/remote.php/dav/files/anna/", "/remote.php/dav/files/anna/Eins%C3%A4tze/"]);
    }
}
