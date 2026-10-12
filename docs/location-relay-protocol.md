# Location Relay Protocol v1

Normative Beschreibung des Protokolls zwischen Desktop (di-drop), Relay und
Smartphone-Webseite. Grundlage: `location-relay-feature-requirements.md` (Anforderungen).
Implementierungen: `relay/protocol.js` (Krypto + Nachrichten, von Desktop **und**
Smartphone genutzt), `relay/worker.js` (Cloudflare-Relay), `lib/location/` (Desktop-Client).

Der Relay ist austauschbar: Jeder Server, der dieses Dokument umsetzt, funktioniert mit
denselben Clients. Einzige Konfiguration auf dem Desktop: `relayBaseUrl` (HTTPS).

## 1. Identifikatoren und Geheimnisse

Alle Werte stammen aus einem kryptografisch sicheren Zufallsgenerator des **Desktops** und
werden Base64url (ohne Padding) kodiert.

| Wert | Länge | Wer kennt ihn | Zweck |
|---|---|---|---|
| `sessionId` | 16 Byte (128 Bit) | Desktop, Relay, Smartphone | Rendezvous der beiden Verbindungen |
| `phoneSecret` | 32 Byte (256 Bit) | Desktop, Smartphone – **nie** der Relay | Schlüsselableitung (Ende-zu-Ende) |
| `desktopToken` | 32 Byte (256 Bit) | Desktop, Relay (nur als Hash gespeichert) | Nachweis der Desktop-Rolle |

QR-Code / Pairing-URL:

```
{relayBaseUrl}/#v1:{sessionId}:{phoneSecret}
```

Das Fragment (`#…`) wird vom Browser nie an den Server geschickt. Die Smartphone-Seite liest
es aus und entfernt es sofort mit `history.replaceState`. `desktopToken` steht **nicht** im QR.

## 2. Schlüssel (HKDF-SHA-256 → AES-256-GCM)

```
ikm  = phoneSecret (32 Byte)
salt = UTF-8 "di-drop location relay v1"
kPD  = HKDF(ikm, salt, info = "v1 phone->desktop " + sessionId)   Smartphone → Desktop
kDP  = HKDF(ikm, salt, info = "v1 desktop->phone " + sessionId)   Desktop → Smartphone
```

Getrennte Schlüssel je Richtung schließen Nonce-Kollisionen zwischen den Richtungen aus.

Verschlüsselte Nachricht:

```json
{ "v": 1, "type": "data", "iv": "<12 Byte, b64url>", "ct": "<Ciphertext+Tag, b64url>" }
```

- IV: 96 Bit Zufall je Nachricht (pro Session werden nur wenige tausend Nachrichten erwartet).
- AAD: UTF-8 `"v1|" + sessionId + "|" + richtung` mit `richtung` = `phone->desktop` bzw. `desktop->phone`.
- Klartext: JSON mit Feld `seq` (Ganzzahl, je Richtung streng steigend, beginnt bei 1).
  Empfänger verwirft Nachrichten mit `seq <= letzte seq` (Replay-Schutz).
- Entschlüsselungsfehler → Nachricht verwerfen, Verbindung als kompromittiert behandeln (fail closed).

## 3. Transport

`WSS {relayBaseUrl}/v1/sessions/{sessionId}` (aus `https://` wird `wss://`).
Alle Steuernachrichten sind JSON mit `"v": 1`. Maximale Nachrichtengröße 4096 Byte.
Die erste Nachricht jeder Verbindung muss `hello` sein (innerhalb von 10 s).

### 3.1 Desktop

```
Desktop → Relay   {"v":1,"type":"hello","role":"desktop","token":"<desktopToken>"}
Relay → Desktop   {"v":1,"type":"desktop-ready","expiresAt":<ms>}
```

- **Erstes** `hello` einer Session beansprucht sie: Der Relay merkt sich `SHA-256(desktopToken)`.
- Jedes weitere Desktop-`hello` (Reconnect) muss denselben Token liefern, sonst
  `UNAUTHORIZED` und Trennen. Eine bestehende, gültige Desktop-Verbindung wird dabei ersetzt.
- Der Desktop zeigt den QR-Code **erst nach** `desktop-ready`. Da die `sessionId` vorher
  niemandem bekannt ist, kann kein Angreifer die Session vorab beanspruchen.

### 3.2 Smartphone und Pairing

```
Phone → Relay     {"v":1,"type":"hello","role":"phone"}
Relay → Desktop   {"v":1,"type":"phone-connected","phoneId":"<vom Relay vergeben>"}
Phone → Relay     {"v":1,"type":"data",…}          verschlüsselt mit kPD: {"type":"pair","seq":1,"ts":…}
Relay → Desktop   {"v":1,"type":"data","phoneId":…,"iv":…,"ct":…}
Desktop → Relay   {"v":1,"type":"accept","phoneId":…}   wenn Entschlüsselung + Inhalt gültig
                  {"v":1,"type":"reject","phoneId":…}   sonst
Relay → Phone     {"v":1,"type":"paired"}               bzw. Fehler UNAUTHORIZED + Trennen
```

- Ohne verbundenen Desktop: `NO_RECEIVER` und Trennen (nichts wird gepuffert).
- Ist bereits ein Smartphone gepaart: `ALREADY_PAIRED` und Trennen.
- Ein noch nicht bestätigtes Smartphone darf genau **eine** Nachricht (`pair`) senden.
  Ein neues unbestätigtes Smartphone ersetzt ein älteres unbestätigtes (gegen Blockieren).
- Nur der Besitz von `phoneSecret` (aus dem QR) erlaubt eine gültige `pair`-Nachricht.
  Der Relay kann das nicht prüfen – das entscheidet der Desktop.

### 3.3 Nutzdaten nach dem Pairing

Der Relay leitet `data` nur zwischen Desktop und **gepaartem** Smartphone weiter.
Klartexte (Auszug):

Desktop → Smartphone (kDP):
```json
{"type":"request","seq":1,"mode":"single"}      // Einzelposition anfordern
{"type":"request","seq":2,"mode":"stream"}      // Live-Übertragung anfordern
{"type":"stop","seq":3}                          // Live-Übertragung beenden
{"type":"ack","seq":4,"ackSeq":7}                // Empfang bestätigt (Position seq 7)
```

Smartphone → Desktop (kPD):
```json
{"type":"position","seq":7,"timestamp":1791366405123,"lat":50.977500,"lon":11.023600,
 "alt":427.3,"accuracy":4.8,"altAccuracy":7.1,"heading":237.4,"speed":3.2}
{"type":"status","seq":8,"state":"streaming"|"stopped"}
{"type":"error","seq":9,"code":"PERMISSION_DENIED"|"POSITION_UNAVAILABLE"|"TIMEOUT"}
```

Koordinaten WGS84 in Dezimalgrad; Höhe/Genauigkeit in Metern, Geschwindigkeit m/s,
Kurs in Grad. Fehlende Werte: `null`.

### 3.4 Beenden und Fehler

```
{"v":1,"type":"close"}                       beide Seiten → Relay trennt beide Verbindungen
{"v":1,"type":"error","code":"…","message":"…"}   Relay → Client
```

Fehlercodes: `NO_RECEIVER`, `SESSION_EXPIRED`, `ALREADY_PAIRED`, `UNAUTHORIZED`,
`INVALID_MESSAGE`, `RATE_LIMITED`, `DESKTOP_GONE`.

- Trennt sich der Desktop, erhält das Smartphone `DESKTOP_GONE`; der Desktop kann sich
  innerhalb der Session mit seinem Token neu verbinden.
- Grenzen: Session höchstens 8 Stunden; höchstens 20 Nachrichten je 10 Sekunden je Verbindung.

## 4. Was der Relay sieht

Session-ID, IP-Adressen, Verbindungszeiten, Länge der verschlüsselten Nachrichten und den
Hash des Desktop-Tokens. Er sieht **keine** Positionen und **keinen** Schlüssel und speichert
nichts dauerhaft. Personenbezogene Metadaten (IP-Adressen) fallen technisch bedingt trotzdem an.

## 5. Health

`GET {relayBaseUrl}/health` → `{"ok":true,"protocol":1,"relay":"<Implementierung>","bundle":"<Version>"}`
