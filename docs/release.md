# Releases und Auto-Update

di-drop wird über **GitHub Actions** für macOS (Apple Silicon + Intel) und Windows gebaut.
Installierte Apps holen sich neue Versionen selbst: beim Start (höchstens alle 6 Stunden),
über *di-drop → Nach Updates suchen …* oder *Einstellungen → Aktualisierungen*.
Nichts wird ohne Rückfrage installiert; laufende Uploads gehen nach dem Neustart weiter.

## Neue Version veröffentlichen

```bash
node script/bump_version.mjs 0.2.0
git commit -am "Version 0.2.0"
git tag v0.2.0
git push && git push --tags
```

1. Der Workflow *Release* (`.github/workflows/release.yml`) baut beide Systeme (~15 Minuten).
2. Unter *Releases* liegt danach ein **Entwurf** „di-drop 0.2.0“ mit Installern und `latest.json`.
3. Versionshinweise in den Entwurf schreiben (auf Deutsch, kurz – sie erscheinen im Update-Dialog).
4. **Veröffentlichen.** Ab jetzt bekommen alle installierten Apps das Update angeboten.

Ein Release-Entwurf wird von den Apps nicht gesehen – erst der veröffentlichte Release zählt
(`…/releases/latest/download/latest.json`).

## Signatur der Updates (einmalig einrichten)

Updates sind mit einem eigenen Schlüssel signiert; die App installiert nur, was dazu passt.

- Öffentlicher Schlüssel: in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
- Privater Schlüssel: **nur** beim Maintainer, `~/.tauri/di-drop-updater.key` – nie ins Repository!
- In GitHub unter *Settings → Secrets and variables → Actions*:
  - `TAURI_SIGNING_PRIVATE_KEY` = Inhalt der Datei `~/.tauri/di-drop-updater.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = leer lassen (Schlüssel ohne Passwort) bzw. das Passwort

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/di-drop-updater.key --repo Disaster-Drone-Operations/DI-DROP
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body "" --repo Disaster-Drone-Operations/DI-DROP
```

**Geht der private Schlüssel verloren**, können installierte Apps keine Updates mehr annehmen –
dann muss jeder einmal von Hand neu installieren. Den Schlüssel daher sicher aufbewahren
(z. B. zusätzlich im Passwort-Manager).

## Noch nicht eingerichtet: Code-Signatur der Installer

Ohne Signatur warnen die Systeme beim **ersten** Start (Updates danach laufen ohne Warnung):

- **macOS:** Rechtsklick auf di-drop → „Öffnen“. Lösung: Apple Developer Program + Notarisierung
  (Secrets `APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_TEAM_ID` … für `tauri-action`).
- **Windows:** SmartScreen „Windows hat den PC geschützt“ → „Weitere Informationen“ → „Trotzdem ausführen“.
  Lösung: z. B. SignPath Foundation (kostenlos für Open Source) oder ein Code-Signing-Zertifikat.

## Lokal bauen

```bash
npx tauri build --debug --no-bundle    # Entwickler-App mit eingebauter Oberfläche (ohne Installer)
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/di-drop-updater.key)" npx tauri build   # vollständige Installer
```
