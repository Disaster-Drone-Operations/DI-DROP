//! Marked copy of an image ("…_markiert.JPG", markings drawn in the frontend): lives next to the original,
//! is rewritten after every change and removed when the markings are gone. The original is never touched.
//!
//! The frontend renders the image with its markings into a JPEG (canvas – without any metadata); here the
//! original's EXIF (time, GPS, camera) and XMP (DJI data) are put back in, so the copy can be placed on a map
//! like the original. The embedded EXIF thumbnail is dropped – it would show the image *without* markings.

use std::fs;
use std::path::{Path, PathBuf};

pub const SUFFIX: &str = "_markiert";

/// "…/DJI_0001_T.JPG" → "…/DJI_0001_T_markiert.JPG"
pub fn marked_path(original: &Path) -> PathBuf {
    let stem = original.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    let ext = original.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
    original.with_file_name(format!("{stem}{SUFFIX}.{ext}"))
}

/// A marked copy (never imported as an image of its own) – also "…_markiert_2.JPG": a changed marking provided
/// again gets a number at the target, and such a folder may well be imported again later (USB stick, Nextcloud sync)
pub fn is_marked(path: &Path) -> bool {
    let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { return false };
    let base = stem.trim_end_matches(|c: char| c.is_ascii_digit());
    stem.ends_with(SUFFIX) || (base.len() < stem.len() && base.strip_suffix('_').is_some_and(|b| b.ends_with(SUFFIX)))
}

fn check_original(original: &Path) -> Result<(), String> {
    let jpeg = original.extension().and_then(|e| e.to_str()).is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "jpg" | "jpeg"));
    if !jpeg || is_marked(original) || !original.is_file() {
        return Err("Markieren nur für vorhandene JPEG-Bilder".into());
    }
    Ok(())
}

/// Writes the marked copy of `original` (overwrites an older one) → its path
pub fn write(original: &Path, rendered: &[u8]) -> Result<PathBuf, String> {
    check_original(original)?;
    let source = fs::read(original).map_err(|e| e.to_string())?;
    let bytes = with_metadata(&source, rendered)?;
    let target = marked_path(original);
    let temp = target.with_extension("tmp");
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, &target).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })?;
    Ok(target)
}

/// Removes the marked copy of `original` (if there is one)
pub fn remove(original: &Path) -> Result<(), String> {
    let target = marked_path(original);
    if target.is_file() && is_marked(&target) {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── JPEG segments ───────────────────────────────────────────────────────────

/// Marker segments before the image data: [(marker, whole segment incl. FF xx and length)], offset of the rest
fn segments(jpeg: &[u8]) -> Result<(Vec<(u8, &[u8])>, usize), String> {
    if jpeg.len() < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return Err("Kein JPEG".into());
    }
    let mut out = Vec::new();
    let mut i = 2;
    while i + 4 <= jpeg.len() && jpeg[i] == 0xFF {
        let marker = jpeg[i + 1];
        if marker == 0xDA {
            break; // start of scan – image data follows
        }
        let len = u16::from_be_bytes([jpeg[i + 2], jpeg[i + 3]]) as usize;
        let end = (i + 2 + len).min(jpeg.len());
        out.push((marker, &jpeg[i..end]));
        i = end;
    }
    Ok((out, i))
}

/// Rendered JPEG with the original's EXIF (without thumbnail) and XMP
pub fn with_metadata(original: &[u8], rendered: &[u8]) -> Result<Vec<u8>, String> {
    let (source, _) = segments(original)?;
    let (own, rest) = segments(rendered)?;
    let mut out = vec![0xFF, 0xD8];
    for (marker, seg) in &source {
        if *marker != 0xE1 {
            continue; // APP1 only: EXIF and XMP (not MPF previews, maker debug data …)
        }
        if seg[4..].starts_with(b"Exif\0\0") {
            out.extend(without_thumbnail(seg));
        } else if seg[4..].starts_with(b"http://ns.adobe.com/xap/1.0/\0") {
            out.extend_from_slice(seg);
        }
    }
    for (marker, seg) in &own {
        if *marker != 0xE1 {
            out.extend_from_slice(seg); // JFIF, tables, frame header of the rendered image – not its own (empty) APP1
        }
    }
    out.extend_from_slice(&rendered[rest..]);
    Ok(out)
}

/// EXIF segment with the link to IFD1 (embedded thumbnail) cut – the data stays, nobody finds it anymore
fn without_thumbnail(seg: &[u8]) -> Vec<u8> {
    let mut seg = seg.to_vec();
    let tiff = 10; // FF E1, length (2), "Exif\0\0"
    let Some(head) = seg.get(tiff..tiff + 8) else { return seg };
    let little = &head[0..2] == b"II";
    let u16_at = |b: &[u8], at: usize| if little { u16::from_le_bytes([b[at], b[at + 1]]) } else { u16::from_be_bytes([b[at], b[at + 1]]) };
    let u32_at = |b: &[u8], at: usize| {
        let x = [b[at], b[at + 1], b[at + 2], b[at + 3]];
        if little { u32::from_le_bytes(x) } else { u32::from_be_bytes(x) }
    };
    let ifd0 = tiff + u32_at(&seg, tiff + 4) as usize;
    if ifd0 + 2 > seg.len() {
        return seg;
    }
    let next = ifd0 + 2 + u16_at(&seg, ifd0) as usize * 12;
    if next + 4 <= seg.len() {
        seg[next..next + 4].copy_from_slice(&[0, 0, 0, 0]);
    }
    seg
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal JPEG from the image crate (as a canvas would deliver it: no metadata)
    fn rendered() -> Vec<u8> {
        let img = image::RgbImage::from_pixel(16, 8, image::Rgb([200, 30, 30]));
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut out).encode_image(&img).unwrap();
        out
    }

    // EXIF (little endian) with IFD0 → IFD1, plus XMP and a segment that must not be taken over
    fn original() -> Vec<u8> {
        let mut tiff = b"II*\0\x08\0\0\0".to_vec();
        tiff.extend([1, 0]); // IFD0: one entry
        tiff.extend([0x0F, 0x01, 2, 0, 4, 0, 0, 0, b'D', b'J', b'I', 0]); // Make = "DJI"
        tiff.extend(26u32.to_le_bytes()); // next IFD (IFD1, thumbnail) at 26
        tiff.extend([0, 0, 0, 0, 0, 0]);
        let app1 = |payload: &[u8]| {
            let mut s = vec![0xFF, 0xE1];
            s.extend(((payload.len() + 2) as u16).to_be_bytes());
            s.extend_from_slice(payload);
            s
        };
        let mut exif = b"Exif\0\0".to_vec();
        exif.extend(&tiff);
        let mut jpeg = vec![0xFF, 0xD8];
        jpeg.extend(app1(&exif));
        jpeg.extend(app1(b"http://ns.adobe.com/xap/1.0/\0<x:xmpmeta drone-dji:GimbalYawDegree=\"1\"/>"));
        jpeg.extend([0xFF, 0xE7, 0, 6, b'D', b'B', b'G', 0]);
        jpeg.extend(&rendered()[2..]);
        jpeg
    }

    #[test]
    fn keeps_exif_and_xmp_but_not_the_thumbnail() {
        let out = with_metadata(&original(), &rendered()).unwrap();
        let (segs, _) = segments(&out).unwrap();
        let app1: Vec<_> = segs.iter().filter(|(m, _)| *m == 0xE1).collect();
        assert_eq!(app1.len(), 2);
        assert!(!segs.iter().any(|(m, _)| *m == 0xE7));
        let exif = exif::Reader::new().read_from_container(&mut std::io::Cursor::new(&out)).unwrap();
        assert!(exif.get_field(exif::Tag::Make, exif::In::PRIMARY).is_some());
        assert!(exif.get_field(exif::Tag::Make, exif::In::THUMBNAIL).is_none());
        assert!(image::load_from_memory(&out).is_ok()); // still a valid image
    }

    #[test]
    fn writes_and_removes_next_to_the_original() {
        let dir = std::env::temp_dir().join(format!("didrop-marked-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let original_path = dir.join("DJI_0001_T.JPG");
        fs::write(&original_path, original()).unwrap();
        let target = write(&original_path, &rendered()).unwrap();
        assert_eq!(target.file_name().unwrap(), "DJI_0001_T_markiert.JPG");
        assert!(is_marked(&target));
        assert!(write(&target, &rendered()).is_err()); // never a marked copy of a marked copy
        assert!(is_marked(&dir.join("DJI_0001_T_markiert_2.JPG")) && is_marked(&dir.join("Vergleich_Ost_markiert_12.jpg")));
        assert!(!is_marked(&dir.join("DJI_0001_T.JPG")) && !is_marked(&dir.join("DJI_0001_T_2.JPG")) && !is_marked(&dir.join("markiert_2.JPG")));
        write(&original_path, &rendered()).unwrap(); // overwrites its own copy
        remove(&original_path).unwrap();
        assert!(!target.exists() && original_path.exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
