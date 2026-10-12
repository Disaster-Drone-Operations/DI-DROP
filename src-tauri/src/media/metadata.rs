//! Liest Aufnahme-Metadaten aus Drohnenbildern.
//!
//! * EXIF: Aufnahmezeit, Kamera, GPS, Brennweite
//! * XMP (DJI, Namensraum `drone-dji:`): Gimbal-/Flugrichtung, Höhen, exakte GPS-Werte
//!
//! Die Werte für Position, Blickrichtung und Zoom brauchen wir später, um
//! Vergleichsaufnahmen (gleiche Stelle, gleicher Blickwinkel) zu erkennen.

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Cursor;

use exif::{In, Tag, Value};

#[derive(Debug, Default, Serialize, Clone)]
pub struct Metadata {
    /// Lokale Aufnahmezeit, "YYYY-MM-DDTHH:MM:SS"
    pub taken_at: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub abs_alt: Option<f64>,
    pub rel_alt: Option<f64>,
    pub gimbal_yaw: Option<f64>,
    pub gimbal_pitch: Option<f64>,
    pub flight_yaw: Option<f64>,
    pub focal_length: Option<f64>,
    pub focal_length_35mm: Option<f64>,
    pub digital_zoom: Option<f64>,
    /// Kamera laut DJI: "InfraredCamera", "WideCamera", "ZoomCamera" …
    pub image_source: Option<String>,
    /// Kennung des Wegpunkts bei Flugaufträgen (gleich über alle Wiederholungen der Route)
    pub flight_line: Option<String>,
    /// Punkt am Boden, auf den die Kamera zeigt (Laser-Entfernungsmesser)
    pub target_lat: Option<f64>,
    pub target_lon: Option<f64>,
    pub target_distance: Option<f64>,
    /// Alle `drone-dji:`-Felder im Rohformat
    pub dji: BTreeMap<String, String>,
}

pub fn read(head: &[u8]) -> Metadata {
    let mut meta = Metadata::default();
    read_exif(head, &mut meta);
    read_dji_xmp(head, &mut meta);
    meta
}

// ── EXIF ────────────────────────────────────────────────────────────────────

fn read_exif(head: &[u8], meta: &mut Metadata) {
    let Ok(exif) = exif::Reader::new().read_from_container(&mut Cursor::new(head)) else {
        return;
    };
    let field = |tag| exif.get_field(tag, In::PRIMARY);

    meta.make = field(Tag::Make).and_then(ascii);
    meta.model = field(Tag::Model).and_then(ascii);
    meta.width = field(Tag::PixelXDimension).and_then(|f| f.value.get_uint(0));
    meta.height = field(Tag::PixelYDimension).and_then(|f| f.value.get_uint(0));
    meta.focal_length = field(Tag::FocalLength).and_then(|f| rational(f, 0));
    meta.focal_length_35mm = field(Tag::FocalLengthIn35mmFilm).and_then(|f| f.value.get_uint(0)).map(f64::from);
    meta.digital_zoom = field(Tag::DigitalZoomRatio).and_then(|f| rational(f, 0));
    meta.abs_alt = field(Tag::GPSAltitude).and_then(|f| rational(f, 0));

    // "2026:10:06 14:30:12" → "2026-10-06T14:30:12"
    meta.taken_at = field(Tag::DateTimeOriginal)
        .or_else(|| field(Tag::DateTime))
        .and_then(ascii)
        .filter(|s| s.len() >= 19)
        .map(|s| format!("{}-{}-{}T{}", &s[0..4], &s[5..7], &s[8..10], &s[11..19]));

    meta.lat = gps_coordinate(&exif, Tag::GPSLatitude, Tag::GPSLatitudeRef, "S");
    meta.lon = gps_coordinate(&exif, Tag::GPSLongitude, Tag::GPSLongitudeRef, "W");
}

fn ascii(field: &exif::Field) -> Option<String> {
    match &field.value {
        Value::Ascii(values) => values
            .first()
            .map(|b| String::from_utf8_lossy(b).trim_matches(char::from(0)).trim().to_string())
            .filter(|s| !s.is_empty()),
        _ => None,
    }
}

fn rational(field: &exif::Field, index: usize) -> Option<f64> {
    match &field.value {
        Value::Rational(v) => v.get(index).map(|r| r.to_f64()),
        Value::SRational(v) => v.get(index).map(|r| r.to_f64()),
        _ => None,
    }
    .filter(|n| n.is_finite())
}

fn gps_coordinate(exif: &exif::Exif, tag: Tag, ref_tag: Tag, negative: &str) -> Option<f64> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    let value = rational(field, 0)? + rational(field, 1).unwrap_or(0.0) / 60.0 + rational(field, 2).unwrap_or(0.0) / 3600.0;
    let sign = match exif.get_field(ref_tag, In::PRIMARY).and_then(ascii) {
        Some(r) if r.eq_ignore_ascii_case(negative) => -1.0,
        _ => 1.0,
    };
    Some(value * sign)
}

// ── DJI XMP ─────────────────────────────────────────────────────────────────

fn read_dji_xmp(head: &[u8], meta: &mut Metadata) {
    let Some(start) = find(head, b"<x:xmpmeta") else { return };
    let end = find(&head[start..], b"</x:xmpmeta>").map(|e| start + e).unwrap_or(head.len());
    let xml = String::from_utf8_lossy(&head[start..end]);

    meta.dji = parse_prefixed(&xml, "drone-dji:");

    let num = |keys: &[&str]| {
        keys.iter()
            .find_map(|k| meta.dji.get(*k))
            .and_then(|v| v.trim().trim_start_matches('+').parse::<f64>().ok())
            .filter(|n| n.is_finite())
    };

    // XMP-Werte sind genauer als EXIF und haben Vorrang
    if let Some(v) = num(&["GpsLatitude"]) { meta.lat = Some(v) }
    if let Some(v) = num(&["GpsLongitude", "GpsLongtitude"]) { meta.lon = Some(v) } // DJI-Tippfehler bei manchen Modellen
    if let Some(v) = num(&["AbsoluteAltitude"]) { meta.abs_alt = Some(v) }
    meta.rel_alt = num(&["RelativeAltitude"]);
    meta.gimbal_yaw = num(&["GimbalYawDegree"]);
    meta.gimbal_pitch = num(&["GimbalPitchDegree"]);
    meta.flight_yaw = num(&["FlightYawDegree"]);
    if let Some(v) = num(&["DigitalZoomRatio", "ZoomRatio"]) { meta.digital_zoom = Some(v) }

    let text = |key: &str| meta.dji.get(key).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    meta.image_source = text("ImageSource");
    meta.flight_line = text("FlightLineInfo");
    // Ohne Laser-Messung (z. B. Blick in den Himmel) schreibt DJI 0.0 → als "unbekannt" behandeln
    let target = |key| num(&[key]).filter(|v| *v != 0.0);
    meta.target_lat = target("LRFTargetLat");
    meta.target_lon = target("LRFTargetLon");
    meta.target_distance = target("LRFTargetDistance");
}

/// Sammelt `prefix:Name="Wert"` (Attribut-Form) und `<prefix:Name>Wert</prefix:Name>` (Element-Form).
fn parse_prefixed(xml: &str, prefix: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let mut pos = 0;
    while let Some(found) = xml[pos..].find(prefix) {
        let at = pos + found;
        pos = at + prefix.len();
        if xml[..at].ends_with("</") || xml[..at].ends_with("xmlns:") {
            continue;
        }
        let rest = &xml[pos..];
        let name_len = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).unwrap_or(rest.len());
        if name_len == 0 {
            continue;
        }
        let name = &rest[..name_len];
        let after = rest[name_len..].trim_start();

        let value = if let Some(v) = after.strip_prefix('=') {
            let v = v.trim_start();
            let quote = v.chars().next().filter(|q| *q == '"' || *q == '\'');
            quote.and_then(|q| v[1..].find(q).map(|close| v[1..1 + close].to_string()))
        } else if xml[..at].ends_with('<') {
            after.strip_prefix('>').and_then(|v| v.find('<').map(|close| v[..close].trim().to_string()))
        } else {
            None
        };
        if let Some(value) = value {
            out.insert(name.to_string(), value);
        }
    }
    out
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dji_attributes_and_elements() {
        let xml = r#"<x:xmpmeta><rdf:Description xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"
            drone-dji:GimbalYawDegree="+45.20" drone-dji:RelativeAltitude="+80.123">
            <drone-dji:Model>M4TD</drone-dji:Model></rdf:Description></x:xmpmeta>"#;
        let map = parse_prefixed(xml, "drone-dji:");
        assert_eq!(map.get("GimbalYawDegree").unwrap(), "+45.20");
        assert_eq!(map.get("RelativeAltitude").unwrap(), "+80.123");
        assert_eq!(map.get("Model").unwrap(), "M4TD");
        assert_eq!(map.len(), 3);

        let mut meta = Metadata::default();
        read_dji_xmp(xml.as_bytes(), &mut meta);
        assert_eq!(meta.gimbal_yaw, Some(45.2));
    }
}
