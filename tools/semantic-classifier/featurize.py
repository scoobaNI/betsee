"""Feature extraction for the Betsee prompt-injection classifier.

The Gateway re-implements exactly this in Rust (gateway/crates/server/src/semantic.rs). Any change
here is a change to the model format: bump FORMAT and keep the parity fixture in step.
"""

import base64
import binascii
import math
import re

FORMAT = "betsee-ngram-lr/2"
BUCKETS = 1 << 18

FOLD = {
    "ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n", "ó": "o", "ś": "s", "ź": "z", "ż": "z",
    "ä": "a", "ö": "o", "ü": "u", "ß": "ss", "é": "e", "è": "e", "ê": "e", "ë": "e", "à": "a",
    "â": "a", "á": "a", "ç": "c", "î": "i", "ï": "i", "í": "i", "ô": "o", "ò": "o", "û": "u",
    "ù": "u", "ú": "u", "ñ": "n", "ý": "y", "č": "c", "ř": "r", "š": "s", "ž": "z", "ě": "e",
    "ů": "u", "ő": "o", "ű": "u",
    # Cyrillic and Greek letters that render like Latin ones.
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j",
    "ѕ": "s", "к": "k", "м": "m", "т": "t", "в": "b", "н": "h", "ԁ": "d", "ɡ": "g",
    "α": "a", "ο": "o", "ε": "e", "ι": "i", "ρ": "p", "τ": "t", "υ": "u", "ν": "v", "κ": "k",
}
INVISIBLE = {"­", "​", "‌", "‍", "‎", "‏", "⁠", "⁡",
             "⁢", "⁣", "⁤", "﻿"}
LEET = {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s",
        "!": "i", "|": "i"}


def fold_char(c):
    code = ord(c)
    if 0xFF01 <= code <= 0xFF5E:
        c = chr(code - 0xFEE0)
    return FOLD.get(c, c)


def normalize(text):
    out = []
    for c in text.lower():
        if c in INVISIBLE:
            continue
        c = fold_char(c)
        for d in c:
            out.append(d if d.isalnum() else " ")
    return " ".join("".join(out).split())


def fnv1a(data):
    h = 0xCBF29CE484222325
    for b in data:
        h ^= b
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return h


def bucket(feature):
    return fnv1a(feature.encode("utf-8")) % BUCKETS


def intents(words, lexicons):
    """Lexicon groups present in the text, each with the index of the first word that matched."""
    found = {}
    pairs = [w + " " + words[i + 1] for i, w in enumerate(words[:-1])]
    for group, entries in lexicons.items():
        for entry in entries:
            entry = entry.strip()
            if " " in entry:
                hit = next((i for i, p in enumerate(pairs) if p.startswith(entry)), None)
            else:
                hit = next((i for i, w in enumerate(words) if w.startswith(entry)), None)
            if hit is not None:
                found[group] = min(found.get(group, hit), hit)
    return found


def raw_features(norm, lexicons=None, combos=()):
    """Feature strings with the index of the word each one came from."""
    words = norm.split(" ") if norm else []
    feats = []
    if lexicons:
        found = intents(words, lexicons)
        for combo in combos:
            if all(g in found for g in combo):
                feats.append(("x:" + "+".join(combo), min(found[g] for g in combo)))
    for i, w in enumerate(words):
        feats.append(("w:" + w, i))
        if i + 1 < len(words):
            feats.append(("b:" + w + " " + words[i + 1], i))
        padded = " " + w + " "
        chars = list(padded)
        for n in (3, 4, 5):
            for s in range(0, len(chars) - n + 1):
                feats.append(("c:" + "".join(chars[s:s + n]), i))
    return words, feats


INTENT_VALUE = 1.0


def vector(norm, lexicons=None, combos=()):
    """L2-normalized n-gram block plus unnormalized intent features of value INTENT_VALUE."""
    _, feats = raw_features(norm, lexicons, combos)
    counts, intent = {}, {}
    for f, _ in feats:
        k = bucket(f)
        if f.startswith("x:"):
            intent[k] = INTENT_VALUE
        else:
            counts[k] = counts.get(k, 0) + 1
    values = {k: 1.0 + math.log(v) for k, v in counts.items()}
    norm2 = math.sqrt(sum(v * v for v in values.values())) or 1.0
    out = {k: v / norm2 for k, v in values.items()}
    for k, v in intent.items():
        out[k] = out.get(k, 0.0) + v
    return out


def deleet(text):
    """Map leetspeak only inside tokens that mix at least two letters with leet characters."""
    out = []
    for token in re.split(r"(\s+)", text):
        letters = sum(c.isalpha() for c in token)
        leet = sum(c in LEET for c in token)
        if letters >= 2 and leet >= 1 and not re.fullmatch(r"[0-9]+[a-z]{1,2}", token.lower()):
            token = "".join(LEET.get(c, c) for c in token)
        out.append(token)
    return "".join(out)


def collapse_spaced(text):
    """'i g n o r e  a l l' -> 'ignore all': runs of single characters separated by one space."""
    tokens = re.split(r"(\s+)", text)
    out, run = [], []
    for t in tokens:
        if t.strip() == "":
            if run and len(t) >= 2:
                out.append("".join(run))
                out.append(" ")
                run = []
            continue
        if len(t) == 1:
            run.append(t)
        else:
            if run:
                out.append("".join(run) + " ")
                run = []
            out.append(t + " ")
    if run:
        out.append("".join(run))
    return "".join(out)


B64 = re.compile(r"[A-Za-z0-9+/_-]{16,}={0,2}")
HEX = re.compile(r"\b(?:[0-9a-fA-F]{2}){8,}\b")
PCT = re.compile(r"(?:%[0-9a-fA-F]{2}){4,}")


def printable(s):
    return s and sum(ch.isprintable() or ch in "\n\t" for ch in s) / len(s) >= 0.9


def decoded_segments(text):
    out = []
    for m in B64.finditer(text):
        token = m.group(0).rstrip("=")
        altchars = b"-_" if ("-" in token or "_" in token) else None
        padded = token + "=" * (-len(token) % 4)
        try:
            value = base64.b64decode(padded, altchars=altchars, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError):
            continue
        if printable(value) and " " in value:
            out.append(value)
    for m in HEX.finditer(text):
        try:
            value = bytes.fromhex(m.group(0)).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            continue
        if printable(value) and " " in value:
            out.append(value)
    for m in PCT.finditer(text):
        try:
            value = bytes.fromhex(m.group(0).replace("%", "")).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            continue
        if printable(value):
            out.append(value)
    return out


def variants(text):
    """(label, text) pairs the Gateway scores; the verdict uses the highest score."""
    out = [("plain", text)]
    spaced = collapse_spaced(text)
    if spaced.split() != text.split():
        out.append(("spaced_letters", spaced))
    leet = deleet(text)
    if leet != text:
        out.append(("leetspeak", leet))
    for segment in decoded_segments(text):
        out.append(("decoded", segment))
    return out
