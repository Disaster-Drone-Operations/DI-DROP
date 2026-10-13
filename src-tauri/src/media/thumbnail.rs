//! Vorschaubilder für die Übersicht.
//!
//! Drohnenfotos haben 20–50 Megapixel. Statt das ganze Bild zu dekodieren,
//! lässt `jpeg-decoder` schon beim Dekodieren auf 1/2, 1/4 oder 1/8 herunterskalieren –
//! das ist um ein Vielfaches schneller.
//!
//! Noch schneller: DJI bettet in jedes Foto ein Vorschaubild (960×720) nach dem
//! MPF-Standard ein. Ist es vorhanden, wird nur dieses dekodiert.

use std::fs::{self, File};
use std::io::{BufWriter, Cursor};
use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::{imageops, GrayImage, RgbImage};
use jpeg_decoder::{Decoder, PixelFormat};

pub const MAX_EDGE: u32 = 480;

pub fn create(src: &Path, dest: &Path) -> Result<(), String> {
    create_sized(src, dest, MAX_EDGE)
}

/// Wie `create`, mit eigener Kantenlänge (Vergleichsbilder sind sehr breit → größer)
pub fn create_sized(src: &Path, dest: &Path, max_edge: u32) -> Result<(), String> {
    let bytes = fs::read(src).map_err(|e| e.to_string())?;
    let jpeg = mpf_preview(&bytes).unwrap_or(&bytes);
    let mut decoder = Decoder::new(Cursor::new(jpeg));
    decoder.read_info().map_err(|e| e.to_string())?;
    decoder.scale(max_edge as u16, max_edge as u16).map_err(|e| e.to_string())?;
    let pixels = decoder.decode().map_err(|e| e.to_string())?;
    let info = decoder.info().ok_or("Keine Bildinformationen")?;
    let (w, h) = (u32::from(info.width), u32::from(info.height));

    let rgb = match info.pixel_format {
        PixelFormat::RGB24 => RgbImage::from_raw(w, h, pixels),
        PixelFormat::L8 => GrayImage::from_raw(w, h, pixels).map(|g| image::DynamicImage::ImageLuma8(g).to_rgb8()),
        PixelFormat::L16 => {
            let gray: Vec<u8> = pixels.chunks_exact(2).map(|c| c[0]).collect();
            GrayImage::from_raw(w, h, gray).map(|g| image::DynamicImage::ImageLuma8(g).to_rgb8())
        }
        PixelFormat::CMYK32 => {
            let rgb: Vec<u8> = pixels
                .chunks_exact(4)
                .flat_map(|p| {
                    let k = 255 - u16::from(p[3]);
                    [p[0], p[1], p[2]].map(|c| ((255 - u16::from(c)) * k / 255) as u8)
                })
                .collect();
            RgbImage::from_raw(w, h, rgb)
        }
    }
    .ok_or("Unerwartete Bildgröße")?;

    let scale = (max_edge as f32 / w.max(h) as f32).min(1.0);
    let (tw, th) = (((w as f32 * scale).round() as u32).max(1), ((h as f32 * scale).round() as u32).max(1));
    let thumb = if scale < 1.0 { imageops::thumbnail(&rgb, tw, th) } else { rgb };

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = dest.with_extension("tmp");
    {
        let mut out = BufWriter::new(File::create(&tmp).map_err(|e| e.to_string())?);
        JpegEncoder::new_with_quality(&mut out, 80).encode_image(&thumb).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

/// Sucht das eingebettete Vorschaubild ("Large Thumbnail") im MPF-Segment (APP2).
///
/// Aufbau: APP2 "MPF\0" → TIFF-Header (Byte-Reihenfolge) → IFD mit Tag 0xB002 (MP Entries,
/// je 16 Bytes: Attribute, Größe, Offset relativ zum TIFF-Header, 2× Abhängigkeit).
/// Eintrag 0 ist das Hauptbild, der nächste mit Größe/Offset das Vorschaubild.
fn mpf_preview(bytes: &[u8]) -> Option<&[u8]> {
    let mut pos = 2; // nach SOI
    while pos + 4 <= bytes.len() && bytes[pos] == 0xFF {
        let marker = bytes[pos + 1];
        if marker == 0xDA || marker == 0xD9 {
            return None; // Bilddaten beginnen – kein MPF gefunden
        }
        let len = u16::from_be_bytes([bytes[pos + 2], bytes[pos + 3]]) as usize;
        let segment = bytes.get(pos + 4..pos + 2 + len)?;
        if marker == 0xE2 && segment.starts_with(b"MPF\0") {
            let base = pos + 8;
            return parse_mp_entries(bytes, base).filter(|p| p.len() > 1000 && p.starts_with(&[0xFF, 0xD8]));
        }
        pos += 2 + len;
    }
    None
}

fn parse_mp_entries(bytes: &[u8], base: usize) -> Option<&[u8]> {
    let tiff = bytes.get(base..)?;
    let le = tiff.starts_with(b"II");
    let u16_at = |o: usize| tiff.get(o..o + 2).map(|b| if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) });
    let u32_at = |o: usize| tiff.get(o..o + 4).map(|b| {
        let a = [b[0], b[1], b[2], b[3]];
        if le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) }
    });

    let ifd = u32_at(4)? as usize;
    let count = u16_at(ifd)? as usize;
    for i in 0..count {
        let entry = ifd + 2 + i * 12;
        if u16_at(entry)? != 0xB002 {
            continue;
        }
        let (size, offset) = (u32_at(entry + 4)? as usize, u32_at(entry + 8)? as usize);
        let entries = tiff.get(offset..offset + size)?;
        for e in entries.chunks_exact(16).skip(1) {
            let read = |o: usize| {
                let a = [e[o], e[o + 1], e[o + 2], e[o + 3]];
                (if le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) }) as usize
            };
            let (len, start) = (read(4), read(8));
            if len > 0 && start > 0 {
                return bytes.get(base + start..base + start + len);
            }
        }
    }
    None
}

#[cfg(test)]
mod bench {
    /// DIDROP_TEST_IMAGE=/pfad/bild.jpg cargo test --release bench -- --ignored --nocapture
    #[test]
    #[ignore]
    fn thumbnail_speed() {
        let src = std::path::PathBuf::from(std::env::var("DIDROP_TEST_IMAGE").unwrap());
        let dest = std::env::temp_dir().join("didrop-bench.jpg");
        let t = std::time::Instant::now();
        super::create(&src, &dest).unwrap();
        println!("thumbnail: {:?}", t.elapsed());
        let t = std::time::Instant::now();
        std::fs::copy(&src, std::env::temp_dir().join("didrop-bench-copy.jpg")).unwrap();
        println!("copy: {:?}", t.elapsed());
    }
}
