//! File scanning for CTL-FILE-001: what a file is (from its bytes, not its name), the text Betsee
//! can read out of it, and the classes Cedar decides on. A file is never accepted on trust: an
//! executable, the EICAR test signature, an archive, an unknown binary or anything with no text
//! to scan is a class of its own, and the text that is found goes through the same detectors as
//! typed input (CTL-IN-001).

use crate::content::{self, Finding, GuardedName};
use serde::Serialize;
use std::io::{Read, Write};
use std::process::{Command, Stdio};

/// Largest file the Gateway scans; larger files are refused, never sampled.
pub const MAX_BYTES: usize = 8 * 1024 * 1024;
const EICAR: &str = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const EXECUTABLE_EXTENSIONS: [&str; 17] = [
    "exe", "dll", "so", "dylib", "bin", "sh", "bash", "zsh", "bat", "cmd", "ps1", "msi", "dmg",
    "app", "jar", "vbs", "scr",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Scan {
    /// text, pdf, docx, xlsx, image, archive, executable, binary
    pub kind: &'static str,
    pub size: usize,
    pub sha256: String,
    pub scanned_characters: usize,
    pub findings: Vec<Finding>,
    /// Decision classes for Cedar: content classes plus file classes.
    pub classes: Vec<&'static str>,
}

fn finding(class: &'static str, label: &'static str, masked: impl Into<String>) -> Finding {
    Finding {
        class,
        label,
        masked: masked.into(),
        span: (0, 0),
    }
}

fn kind_of(bytes: &[u8], name: &str) -> &'static str {
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    let starts = |magic: &[u8]| bytes.starts_with(magic);
    if starts(b"\x7fELF")
        || starts(b"MZ")
        || starts(b"\xfe\xed\xfa\xce")
        || starts(b"\xfe\xed\xfa\xcf")
        || starts(b"\xcf\xfa\xed\xfe")
        || starts(b"\xce\xfa\xed\xfe")
        || starts(b"\xca\xfe\xba\xbe")
        || starts(b"#!")
        || EXECUTABLE_EXTENSIONS.contains(&extension.as_str())
    {
        return "executable";
    }
    if starts(b"%PDF-") {
        return "pdf";
    }
    if starts(b"\x89PNG") || starts(b"\xff\xd8\xff") || starts(b"GIF8") {
        return "image";
    }
    if bytes.len() > 12 && starts(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return "image";
    }
    if starts(b"PK\x03\x04") {
        return match office_kind(bytes) {
            Some(kind) => kind,
            None => "archive",
        };
    }
    if starts(b"\x1f\x8b") || starts(b"7z\xbc\xaf") || starts(b"Rar!") {
        return "archive";
    }
    if !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok() {
        return "text";
    }
    "binary"
}

fn office_kind(bytes: &[u8]) -> Option<&'static str> {
    let archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?;
    let names: Vec<&str> = archive.file_names().collect();
    if names.contains(&"word/document.xml") {
        Some("docx")
    } else if names.contains(&"xl/workbook.xml") {
        Some("xlsx")
    } else {
        None
    }
}

/// Text inside XML elements, with tags dropped and paragraph-ish breaks kept.
fn xml_text(xml: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    let mut tag = String::new();
    for c in xml.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' => {
                in_tag = false;
                if tag.starts_with("/w:p") || tag.starts_with("/si") || tag.starts_with("/c") {
                    text.push('\n');
                } else if tag.starts_with("w:tab") {
                    text.push(' ');
                }
            }
            _ if in_tag => tag.push(c),
            _ => text.push(c),
        }
    }
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn office_text(bytes: &[u8]) -> Option<String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?;
    let mut text = String::new();
    let names: Vec<String> = archive.file_names().map(str::to_owned).collect();
    for name in names {
        let wanted = name == "word/document.xml"
            || name == "xl/sharedStrings.xml"
            || (name.starts_with("xl/worksheets/") && name.ends_with(".xml"))
            || (name.starts_with("word/") && (name.contains("header") || name.contains("footer")));
        if !wanted {
            continue;
        }
        let mut entry = archive.by_name(&name).ok()?;
        // Refuse a decompression bomb rather than read past the scan limit.
        if entry.size() > (MAX_BYTES * 4) as u64 {
            return None;
        }
        let mut xml = String::new();
        entry.read_to_string(&mut xml).ok()?;
        text.push_str(&xml_text(&xml));
        text.push('\n');
    }
    Some(text)
}

/// pdftotext (poppler) reads the PDF from stdin; a timeout or failure means "no text".
fn pdf_text(bytes: &[u8]) -> Option<String> {
    let mut child = Command::new("pdftotext")
        .args(["-q", "-enc", "UTF-8", "-", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let input = bytes.to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        match child.try_wait().ok()? {
            Some(status) if status.success() => break,
            Some(_) => return None,
            None if std::time::Instant::now() > deadline => {
                let _ = child.kill();
                return None;
            }
            None => std::thread::sleep(std::time::Duration::from_millis(20)),
        }
    }
    let _ = writer.join();
    let mut text = String::new();
    child.stdout.take()?.read_to_string(&mut text).ok()?;
    Some(text)
}

pub fn scan(name: &str, bytes: &[u8], guarded: &[GuardedName]) -> Scan {
    let sha256 = format!("sha256:{:x}", <sha2::Sha256 as sha2::Digest>::digest(bytes));
    let mut findings = Vec::new();
    let mut classes: Vec<&'static str> = Vec::new();
    let kind = kind_of(bytes, name);
    if bytes.len() > MAX_BYTES {
        findings.push(finding(
            "oversize",
            "file over the 8 MiB scan limit",
            format!("{} bytes", bytes.len()),
        ));
    }
    // The test signature is checked on the raw bytes, whatever the file claims to be.
    if bytes
        .windows(EICAR.len())
        .any(|window| window == EICAR.as_bytes())
    {
        findings.push(finding(
            "malware_test",
            "EICAR anti-malware test signature",
            "EICAR test file",
        ));
    }
    let text = match kind {
        "text" => std::str::from_utf8(bytes).ok().map(str::to_owned),
        "pdf" => pdf_text(bytes),
        "docx" | "xlsx" => office_text(bytes),
        _ => None,
    };
    match kind {
        "executable" => findings.push(finding("executable", "executable or script", kind)),
        "archive" | "binary" => findings.push(finding(
            "type_not_allowed",
            "file type Betsee does not accept",
            kind,
        )),
        _ => {}
    }
    let scanned_characters = text
        .as_deref()
        .map_or(0, |text| text.trim().chars().count());
    if matches!(kind, "image" | "pdf" | "docx" | "xlsx") && scanned_characters == 0 {
        findings.push(finding("unscannable", "no text Betsee can scan", kind));
    }
    if let Some(text) = &text {
        findings.extend(content::detect(text, guarded));
    }
    for found in &findings {
        if !classes.contains(&found.class) {
            classes.push(found.class);
        }
    }
    Scan {
        kind,
        size: bytes.len(),
        sha256,
        scanned_characters,
        findings,
        classes,
    }
}

/// A file name the workspace can hold: plain characters, no path, no leading dot.
pub fn safe_name(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_start_matches('.').trim_matches('-').to_owned();
    (!cleaned.is_empty() && cleaned.len() <= 120 && cleaned != "..").then_some(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classes(name: &str, bytes: &[u8]) -> Vec<&'static str> {
        scan(name, bytes, &[]).classes
    }

    fn docx(body: &str) -> Vec<u8> {
        let mut buffer = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut buffer);
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("[Content_Types].xml", options).unwrap();
        writer.write_all(b"<Types/>").unwrap();
        writer.start_file("word/document.xml", options).unwrap();
        writer
            .write_all(format!("<w:document><w:body><w:p><w:r><w:t>{body}</w:t></w:r></w:p></w:body></w:document>").as_bytes())
            .unwrap();
        writer.finish().unwrap();
        buffer.into_inner()
    }

    #[test]
    fn plain_text_is_scanned_with_the_input_detectors() {
        assert!(classes("notes.md", b"Q4 carrier scorecard due 10 October").is_empty());
        assert_eq!(
            classes("pay.csv", b"name,card\nMaya,4111 1111 1111 1111\n"),
            ["payment_card"]
        );
        assert_eq!(classes("k.txt", b"key AKIAIOSFODNN7EXAMPLE"), ["secret"]);
    }

    #[test]
    fn type_comes_from_the_bytes_not_the_name() {
        assert_eq!(
            classes("report.pdf", b"\x7fELF\x02\x01\x01"),
            ["executable"]
        );
        assert_eq!(
            classes("setup.txt", b"#!/bin/sh\nrm -rf /\n"),
            ["executable"]
        );
        assert_eq!(classes("tool.exe", b"hello"), ["executable"]);
        assert_eq!(
            classes("data.dat", b"\x00\x01\x02\x03"),
            ["type_not_allowed"]
        );
        assert_eq!(
            classes("a.tar.gz", b"\x1f\x8b\x08\x00"),
            ["type_not_allowed"]
        );
        assert_eq!(
            classes("photo.png", b"\x89PNG\r\n\x1a\n...."),
            ["unscannable"]
        );
    }

    #[test]
    fn the_eicar_signature_is_found_inside_any_file() {
        let file = format!("harmless prefix {EICAR} suffix");
        assert_eq!(classes("readme.txt", file.as_bytes()), ["malware_test"]);
    }

    #[test]
    fn office_documents_are_read_from_their_xml() {
        let clean = docx("Quarterly plan for the Gdansk hub");
        let scan = scan("plan.docx", &clean, &[]);
        assert_eq!(scan.kind, "docx");
        assert!(scan.classes.is_empty() && scan.scanned_characters > 10);
        assert_eq!(
            classes("iban.docx", &docx("Pay PL61 1090 1014 0000 0712 1981 2874")),
            ["iban"]
        );
        assert_eq!(classes("empty.docx", &docx("")), ["unscannable"]);
    }

    #[test]
    fn pdf_text_is_extracted_when_poppler_is_present() {
        if Command::new("pdftotext").arg("-v").output().is_err() {
            return;
        }
        let pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 54>>stream\nBT /F1 12 Tf 10 50 Td (PESEL 44051401359) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
        let scan = scan("id.pdf", pdf, &[]);
        assert_eq!(scan.kind, "pdf");
        assert_eq!(scan.classes, ["pesel"], "{scan:?}");
    }

    #[test]
    fn names_never_carry_a_path() {
        assert_eq!(safe_name("../../etc/passwd").as_deref(), Some("passwd"));
        assert_eq!(
            safe_name("C:\\Users\\m\\Q4 plan (final).docx").as_deref(),
            Some("Q4-plan--final-.docx")
        );
        assert_eq!(safe_name(".bashrc").as_deref(), Some("bashrc"));
        assert_eq!(safe_name("..").as_deref(), None);
        assert_eq!(safe_name("").as_deref(), None);
    }
}
