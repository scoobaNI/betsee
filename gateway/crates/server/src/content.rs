//! Deterministic detectors for text a human types to an agent (CTL-IN-001). Each candidate is
//! validated, not just pattern-matched: a Luhn check for card numbers, ISO 13616 mod-97 for
//! IBANs, the PESEL checksum and birth date, known key formats with a randomness floor, and
//! catalogued resource names. Findings carry a masked value only; the matched text never leaves
//! this module.

use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Finding {
    pub class: &'static str,
    pub label: &'static str,
    pub masked: String,
    /// Byte range of the match in the scanned text; never serialized.
    #[serde(skip)]
    pub span: (usize, usize),
}

/// A catalogued resource the session may not reach, with the names a person would type for it.
pub struct GuardedName {
    pub resource_id: String,
    pub needles: Vec<String>,
}

/// Classes a file scan decides on (CTL-FILE-001); unchanged by the guardrail profiles.
pub const CLASSES: [&str; 5] = [
    "payment_card",
    "iban",
    "pesel",
    "secret",
    "resource_above_tier",
];

/// Classes the input filter reports; a guardrail profile says which of them block (CTL-IN-001),
/// which are redacted (CTL-IN-002) and which are only recorded.
pub const INPUT_CLASSES: [&str; 7] = [
    "payment_card",
    "iban",
    "pesel",
    "secret",
    "email",
    "phone",
    "resource_above_tier",
];

/// Classes the output filter looks for in model and tool results (CTL-OUT-002).
pub const OUTPUT_CLASSES: [&str; 6] = ["payment_card", "iban", "pesel", "secret", "email", "phone"];

pub fn detect(text: &str, guarded: &[GuardedName]) -> Vec<Finding> {
    let mut findings = Vec::new();
    findings.extend(cards(text));
    findings.extend(ibans(text));
    findings.extend(pesels(text));
    findings.extend(secrets(text));
    let lower = text.to_lowercase();
    for name in guarded {
        let hit = name
            .needles
            .iter()
            .find_map(|needle| word_position(&lower, &needle.to_lowercase()));
        if let Some(position) = hit {
            // Lowercasing can change byte lengths; then the name is reported but not located.
            let span = if lower.len() == text.len() {
                position
            } else {
                (0, 0)
            };
            findings.push(Finding {
                class: "resource_above_tier",
                label: "resource above the session ceiling",
                masked: name.resource_id.clone(),
                span,
            });
        }
    }
    findings
}

/// detect() plus the personal-data classes only the profile-driven filters use: email addresses
/// and phone numbers. A phone match inside a card, IBAN or PESEL number is not reported twice.
pub fn detect_all(text: &str, guarded: &[GuardedName]) -> Vec<Finding> {
    let mut findings = detect(text, guarded);
    for m in EMAIL.find_iter(text) {
        let address = m.as_str();
        let (_, domain) = address.split_once('@').unwrap_or(("", address));
        findings.push(Finding {
            class: "email",
            label: "email address",
            masked: format!("{}***@{domain}", address.chars().next().unwrap_or('*')),
            span: (m.start(), m.end()),
        });
    }
    for pattern in [&*PHONE_PL, &*PHONE_INTL] {
        for m in pattern.find_iter(text) {
            let span = (m.start(), m.end());
            if findings
                .iter()
                .any(|f| f.span.0 < span.1 && span.0 < f.span.1)
            {
                continue;
            }
            let digits: String = m.as_str().chars().filter(char::is_ascii_digit).collect();
            findings.push(Finding {
                class: "phone",
                label: "phone number",
                masked: format!("phone ending {}", &digits[digits.len().saturating_sub(2)..]),
                span,
            });
        }
    }
    findings
}

static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b").unwrap()
});
static PHONE_PL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\+48[ -]?)?\b[1-9][0-9]{2}[ -]?[0-9]{3}[ -]?[0-9]{3}\b").unwrap()
});
static PHONE_INTL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\+[1-9][0-9]{0,2}[ -]?[0-9]{2,4}(?:[ -]?[0-9]{2,4}){2,3}\b").unwrap()
});

/// Replaces every finding whose class is in `classes` with [REDACTED:<CLASS>]. Overlapping
/// findings collapse into one replacement.
pub fn redact(text: &str, findings: &[Finding], classes: &[&str]) -> (String, Vec<Finding>) {
    let mut chosen: Vec<&Finding> = findings
        .iter()
        .filter(|f| classes.contains(&f.class) && f.span.1 > f.span.0 && f.span.1 <= text.len())
        .collect();
    chosen.sort_by_key(|f| f.span);
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    let mut applied = Vec::new();
    for finding in chosen {
        let (start, end) = finding.span;
        if start < at || !text.is_char_boundary(start) || !text.is_char_boundary(end) {
            continue;
        }
        out.push_str(&text[at..start]);
        out.push_str(&format!("[REDACTED:{}]", finding.class.to_uppercase()));
        at = end;
        applied.push(finding.clone());
    }
    out.push_str(&text[at..]);
    (out, applied)
}

fn word_position(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    let boundary =
        |c: Option<char>| c.is_none_or(|c| !(c.is_alphanumeric() || c == '_' || c == '-'));
    haystack
        .match_indices(needle)
        .find(|(start, _)| {
            boundary(haystack[..*start].chars().next_back())
                && boundary(haystack[start + needle.len()..].chars().next())
        })
        .map(|(start, _)| (start, start + needle.len()))
}

/// Digit runs where single spaces or dashes may separate groups: the digit string and the byte
/// range it covers in the text.
fn digit_runs(text: &str) -> Vec<(String, (usize, usize))> {
    let indexed: Vec<(usize, char)> = text.char_indices().collect();
    let chars: Vec<char> = indexed.iter().map(|(_, c)| *c).collect();
    let byte = |index: usize| indexed.get(index).map_or(text.len(), |(b, _)| *b);
    let mut runs = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let previous_alnum = index > 0 && chars[index - 1].is_alphanumeric();
        if !chars[index].is_ascii_digit() || previous_alnum {
            index += 1;
            continue;
        }
        let start = index;
        let mut digits = String::new();
        while index < chars.len() {
            if chars[index].is_ascii_digit() {
                digits.push(chars[index]);
                index += 1;
            } else if matches!(chars[index], ' ' | '-')
                && chars.get(index + 1).is_some_and(char::is_ascii_digit)
            {
                index += 1;
            } else {
                break;
            }
        }
        if !chars.get(index).is_some_and(|c| c.is_alphanumeric()) {
            runs.push((digits, (byte(start), byte(index))));
        }
    }
    runs
}

pub fn luhn(digits: &str) -> bool {
    let mut sum = 0;
    for (position, digit) in digits.bytes().rev().enumerate() {
        let mut value = u32::from(digit - b'0');
        if position % 2 == 1 {
            value *= 2;
            if value > 9 {
                value -= 9;
            }
        }
        sum += value;
    }
    sum % 10 == 0
}

/// Issuer prefixes and lengths of the card networks a payment card number can belong to.
fn card_network(digits: &str) -> bool {
    let length = digits.len();
    let prefix = |n: usize| digits[..n].parse::<u32>().unwrap_or(0);
    (digits.starts_with('4') && matches!(length, 13 | 16 | 19))
        || ((51..=55).contains(&prefix(2)) || (2221..=2720).contains(&prefix(4))) && length == 16
        || matches!(prefix(2), 34 | 37) && length == 15
        || (prefix(4) == 6011 || prefix(2) == 65 || (644..=649).contains(&prefix(3)))
            && (16..=19).contains(&length)
        || (3528..=3589).contains(&prefix(4)) && (16..=19).contains(&length)
        || prefix(2) == 62 && (16..=19).contains(&length)
        || (matches!(prefix(2), 36 | 38 | 39) || (300..=305).contains(&prefix(3)))
            && (14..=19).contains(&length)
}

fn cards(text: &str) -> Vec<Finding> {
    digit_runs(text)
        .into_iter()
        .filter(|(digits, _)| {
            (13..=19).contains(&digits.len()) && card_network(digits) && luhn(digits)
        })
        .map(|(digits, span)| Finding {
            class: "payment_card",
            label: "payment card number",
            masked: format!("card ending {}", &digits[digits.len() - 4..]),
            span,
        })
        .collect()
}

const IBAN_LENGTHS: [(&str, usize); 34] = [
    ("AT", 20),
    ("BE", 16),
    ("BG", 22),
    ("CH", 21),
    ("CY", 28),
    ("CZ", 24),
    ("DE", 22),
    ("DK", 18),
    ("EE", 20),
    ("ES", 24),
    ("FI", 18),
    ("FR", 27),
    ("GB", 22),
    ("GR", 27),
    ("HR", 21),
    ("HU", 28),
    ("IE", 22),
    ("IS", 26),
    ("IT", 27),
    ("LI", 21),
    ("LT", 20),
    ("LU", 20),
    ("LV", 21),
    ("MT", 31),
    ("NL", 18),
    ("NO", 15),
    ("PL", 28),
    ("PT", 25),
    ("RO", 24),
    ("SE", 24),
    ("SI", 19),
    ("SK", 24),
    ("UA", 29),
    ("TR", 26),
];

pub fn iban_valid(iban: &str) -> bool {
    let Some(&(_, length)) = IBAN_LENGTHS
        .iter()
        .find(|(country, _)| iban.starts_with(country))
    else {
        return false;
    };
    if iban.len() != length
        || !iban[2..4].bytes().all(|b| b.is_ascii_digit())
        || !iban
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
    {
        return false;
    }
    let rearranged = iban[4..].chars().chain(iban[..4].chars());
    let mut remainder: u32 = 0;
    for c in rearranged {
        let value = c.to_digit(36).expect("alphanumeric checked");
        for digit in value.to_string().chars() {
            remainder = (remainder * 10 + digit.to_digit(10).expect("decimal")) % 97;
        }
    }
    remainder == 1
}

fn ibans(text: &str) -> Vec<Finding> {
    let indexed: Vec<(usize, char)> = text.char_indices().collect();
    let chars: Vec<char> = indexed.iter().map(|(_, c)| *c).collect();
    let byte = |index: usize| indexed.get(index).map_or(text.len(), |(b, _)| *b);
    let mut found: Vec<(String, (usize, usize))> = Vec::new();
    for start in 0..chars.len() {
        if start > 0 && chars[start - 1].is_alphanumeric() {
            continue;
        }
        let country: String = chars[start..]
            .iter()
            .take(2)
            .collect::<String>()
            .to_uppercase();
        let Some(&(_, length)) = IBAN_LENGTHS.iter().find(|(code, _)| *code == country) else {
            continue;
        };
        let mut compact = String::new();
        let mut index = start;
        while index < chars.len() && compact.len() < length {
            if chars[index].is_ascii_alphanumeric() {
                compact.push(chars[index].to_ascii_uppercase());
            } else if chars[index] != ' '
                || compact.is_empty()
                || !chars
                    .get(index + 1)
                    .is_some_and(char::is_ascii_alphanumeric)
            {
                break;
            }
            index += 1;
        }
        if compact.len() == length
            && !chars.get(index).is_some_and(|c| c.is_alphanumeric())
            && iban_valid(&compact)
        {
            found.push((compact, (byte(start), byte(index))));
        }
    }
    // A Polish account number (NRB) is the IBAN without its country code.
    for (digits, span) in digit_runs(text) {
        if digits.len() == 26 && iban_valid(&format!("PL{digits}")) {
            found.push((format!("PL{digits}"), span));
        }
    }
    found.sort();
    found.dedup_by(|a, b| a.0 == b.0);
    found
        .into_iter()
        .map(|(iban, span)| Finding {
            class: "iban",
            label: "bank account number (IBAN)",
            masked: format!("{} **** {}", &iban[..4], &iban[iban.len() - 4..]),
            span,
        })
        .collect()
}

pub fn pesel_valid(digits: &str) -> bool {
    if digits.len() != 11 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let d: Vec<u32> = digits.bytes().map(|b| u32::from(b - b'0')).collect();
    let weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
    let sum: u32 = weights.iter().zip(&d).map(|(w, v)| w * v).sum();
    if (10 - sum % 10) % 10 != d[10] {
        return false;
    }
    let encoded_month = d[2] * 10 + d[3];
    let (century, month) = match encoded_month {
        1..=12 => (1900, encoded_month),
        21..=32 => (2000, encoded_month - 20),
        41..=52 => (2100, encoded_month - 40),
        61..=72 => (2200, encoded_month - 60),
        81..=92 => (1800, encoded_month - 80),
        _ => return false,
    };
    let year = century + d[0] * 10 + d[1];
    let day = d[4] * 10 + d[5];
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    (1..=days).contains(&day)
}

fn pesels(text: &str) -> Vec<Finding> {
    digit_runs(text)
        .into_iter()
        .filter(|(digits, _)| pesel_valid(digits))
        .map(|(digits, span)| Finding {
            class: "pesel",
            label: "PESEL number",
            masked: format!("PESEL ending {}", &digits[9..]),
            span,
        })
        .collect()
}

/// Shannon entropy in bits per character; random key material sits well above prose.
fn entropy(value: &str) -> f64 {
    let mut counts = std::collections::HashMap::new();
    for c in value.chars() {
        *counts.entry(c).or_insert(0usize) += 1;
    }
    let length = value.chars().count() as f64;
    counts
        .values()
        .map(|&count| {
            let p = count as f64 / length;
            -p * p.log2()
        })
        .sum()
}

const KEY_FORMATS: [(&str, &str, usize); 12] = [
    ("sk-ant-", "Anthropic API key", 32),
    ("sk-proj-", "OpenAI API key", 32),
    ("sk-", "OpenAI API key", 32),
    ("sk_live_", "Stripe secret key", 24),
    ("rk_live_", "Stripe restricted key", 24),
    ("ghp_", "GitHub token", 36),
    ("gho_", "GitHub token", 36),
    ("ghs_", "GitHub token", 36),
    ("github_pat_", "GitHub token", 40),
    ("glpat-", "GitLab token", 20),
    ("xoxb-", "Slack token", 24),
    ("AIza", "Google API key", 35),
];

fn secrets(text: &str) -> Vec<Finding> {
    let mut findings = Vec::new();
    if let Some(start) = text.find("-----BEGIN ")
        && let Some(header) = text[start..].split("-----").nth(1)
        && header.ends_with("PRIVATE KEY")
    {
        let footer = format!("-----END {}-----", header.trim_start_matches("BEGIN "));
        let end = text[start..]
            .find(&footer)
            .map_or(text.len(), |at| start + at + footer.len());
        findings.push(Finding {
            class: "secret",
            label: "private key",
            masked: format!("-----BEGIN {} ...", header.trim_start_matches("BEGIN ")),
            span: (start, end),
        });
    }
    let token_char = |c: char| c.is_ascii_alphanumeric() || matches!(c, '-' | '_');
    let mut tokens = Vec::new();
    let mut token_start = None;
    for (at, c) in text.char_indices().chain(std::iter::once((text.len(), ' '))) {
        match (token_char(c), token_start) {
            (true, None) => token_start = Some(at),
            (false, Some(start)) => {
                tokens.push((start, &text[start..at]));
                token_start = None;
            }
            _ => {}
        }
    }
    for (start, token) in tokens {
        let aws = (token.starts_with("AKIA") || token.starts_with("ASIA"))
            && token.len() == 20
            && token[4..]
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
        let known = KEY_FORMATS.iter().find(|(prefix, _, minimum)| {
            token.starts_with(prefix) && token.len() - prefix.len() >= *minimum
        });
        let label = if aws {
            Some("AWS access key")
        } else {
            known
                .filter(|(prefix, _, _)| entropy(&token[prefix.len()..]) >= 3.5)
                .map(|(_, label, _)| *label)
        };
        if let Some(label) = label {
            findings.push(Finding {
                class: "secret",
                label,
                masked: format!("{}****", &token[..token.len().min(6)]),
                span: (start, start + token.len()),
            });
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classes(text: &str) -> Vec<&'static str> {
        let guarded = [GuardedName {
            resource_id: "workspace/hr/salaries-2026.csv".into(),
            needles: vec!["hr/salaries-2026.csv".into(), "salaries-2026.csv".into()],
        }];
        detect(text, &guarded)
            .into_iter()
            .map(|f| f.class)
            .collect()
    }

    #[test]
    fn card_numbers_need_a_network_prefix_and_a_luhn_check() {
        assert_eq!(
            classes("my card is 4111 1111 1111 1111, thanks"),
            ["payment_card"]
        );
        assert_eq!(classes("5500-0000-0000-0004"), ["payment_card"]);
        assert_eq!(classes("amex 378282246310005"), ["payment_card"]);
        assert!(classes("4111 1111 1111 1112").is_empty(), "Luhn fails");
        assert!(
            classes("order 1234567812345670 shipped").is_empty(),
            "no network prefix"
        );
        assert!(classes("call 555 0100 today").is_empty());
    }

    #[test]
    fn ibans_are_validated_by_length_and_mod_97() {
        assert_eq!(
            classes("pay PL61 1090 1014 0000 0712 1981 2874 today"),
            ["iban"]
        );
        assert_eq!(classes("DE89370400440532013000"), ["iban"]);
        assert_eq!(classes("gb82 west 1234 5698 7654 32"), ["iban"]);
        assert_eq!(
            classes("konto 61109010140000071219812874"),
            ["iban"],
            "Polish NRB"
        );
        assert!(
            classes("PL61 1090 1014 0000 0712 1981 2875").is_empty(),
            "checksum"
        );
        assert!(classes("DE89 3704").is_empty());
        let finding = &detect("DE89370400440532013000", &[])[0];
        assert_eq!(finding.masked, "DE89 **** 3000");
    }

    #[test]
    fn pesel_needs_checksum_and_a_real_birth_date() {
        assert_eq!(classes("PESEL 44051401359"), ["pesel"]);
        assert_eq!(classes("02270803624"), ["pesel"], "born 2002-07-08");
        assert!(classes("44051401358").is_empty(), "checksum");
        assert!(classes("44133101353").is_empty(), "month 13");
        assert!(classes("ticket 12345678901").is_empty());
    }

    #[test]
    fn keys_need_a_known_format_and_random_material() {
        assert_eq!(
            classes("use sk-ant-api03-Xk9fQ2LmZp7RtV4wYb8NcD1eGh5JsU3aKoPq6Tx"),
            ["secret"]
        );
        assert_eq!(classes("AKIAIOSFODNN7EXAMPLE"), ["secret"]);
        assert_eq!(
            classes("token ghp_8fK2mQ9xLp4ZrT7vWc1NbY6dHs3JeU0aGi5o"),
            ["secret"]
        );
        assert_eq!(
            classes(
                "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----"
            ),
            ["secret"]
        );
        assert!(
            classes("sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").is_empty(),
            "no entropy"
        );
        assert!(classes("the sk- prefix is used by keys").is_empty());
        let masked = &detect("AKIAIOSFODNN7EXAMPLE", &[])[0].masked;
        assert!(!masked.contains("IOSFODNN7EXAMPLE"));
    }

    #[test]
    fn guarded_resource_names_match_whole_names_only() {
        assert_eq!(
            classes("summarise hr/salaries-2026.csv"),
            ["resource_above_tier"]
        );
        assert_eq!(
            classes("what is in Salaries-2026.csv?"),
            ["resource_above_tier"]
        );
        assert!(classes("old-salaries-2026.csv.bak is elsewhere").is_empty());
    }

    #[test]
    fn email_and_phone_are_found_only_by_detect_all() {
        let text = "Write to jan.kowalski@acme.pl or call +48 601 234 567, card 4111 1111 1111 1111";
        let classes: Vec<_> = detect_all(text, &[]).into_iter().map(|f| f.class).collect();
        assert_eq!(classes, ["payment_card", "email", "phone"]);
        assert!(detect(text, &[]).iter().all(|f| f.class == "payment_card"));
        assert!(detect_all("call 555 0100 today, invoice 2026-10-03", &[]).is_empty());
        assert!(detect_all("PESEL 44051401359", &[]).iter().all(|f| f.class == "pesel"));
    }

    #[test]
    fn redaction_replaces_exactly_the_chosen_classes() {
        let text = "PESEL 44051401359, mail jan@acme.pl, IBAN PL61 1090 1014 0000 0712 1981 2874.";
        let findings = detect_all(text, &[]);
        let (redacted, applied) = redact(text, &findings, &["pesel", "iban"]);
        assert_eq!(
            redacted,
            "PESEL [REDACTED:PESEL], mail jan@acme.pl, IBAN [REDACTED:IBAN]."
        );
        assert_eq!(applied.len(), 2);
        let (all, _) = redact("klucz AKIAIOSFODNN7EXAMPLE ok", &detect_all("klucz AKIAIOSFODNN7EXAMPLE ok", &[]), &["secret"]);
        assert_eq!(all, "klucz [REDACTED:SECRET] ok");
    }

    #[test]
    fn plain_text_passes() {
        assert!(classes("Can you summarise the onboarding handbook for me?").is_empty());
        assert!(classes("Meeting at 10:30 on 2026-10-03, room 4, budget 12000 EUR").is_empty());
    }
}
