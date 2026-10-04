"""Turns each voiced chunk (out/vo/<chunk>.mp3 + .align.json from narrate.mjs) into a trimmed 48 kHz
stereo out/vo/<chunk>.wav and records, for every line, where it sits in its chunk: offset, length,
phrase starts and word starts, all from ElevenLabs' character timestamps. Writes out/vo/spans.json,
which stage/plan.py lays the film out from.

eleven_v4 ignores the API's speed setting, so narration.json's "tempo" tightens the read here with
rubberband (pitch and formants preserved), and every timestamp is scaled to match.

    python3 film/audio/trim_vo.py
"""

import json
import re
import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
OUT = HERE.parent / "out" / "vo"
RATE = 48_000
PAD = 0.04
SCRIPT = json.loads((HERE / "narration.json").read_text())
LINES = {line["id"]: line["text"] for line in SCRIPT["lines"]}
TEMPO = SCRIPT.get("tempo", 1.0)


def decode(path: Path) -> np.ndarray:
    tempo = ["-af", f"rubberband=tempo={TEMPO}:formant=preserved:pitchq=quality"] if TEMPO != 1.0 else []
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), *tempo, "-f", "f32le", "-ac", "1", "-ar", str(RATE), "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


spans: dict[str, dict] = {}
chunks: dict[str, dict] = {}
for chunk in json.loads((OUT / "chunks.json").read_text()):
    meta = json.loads((OUT / f"{chunk['id']}.align.json").read_text())
    text = meta["text"]
    a = meta["alignment"]
    starts = [x / TEMPO for x in a["character_start_times_seconds"]]
    ends = [x / TEMPO for x in a["character_end_times_seconds"]]
    spoken = [i for i, c in enumerate(a["characters"]) if c.strip()]
    t0 = max(0.0, starts[spoken[0]] - PAD)
    t1 = ends[spoken[-1]] + PAD
    samples = decode(OUT / f"{chunk['id']}.mp3")
    clip = samples[int(t0 * RATE) : int(t1 * RATE)]
    stereo = np.repeat(clip[:, None], 2, axis=1).astype(np.float32)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", "-", str(OUT / f"{chunk['id']}.wav")], input=stereo.tobytes(), check=True)
    chunks[chunk["id"]] = {"dur": round(len(clip) / RATE, 3), "lines": chunk["lines"]}
    cursor = 0
    for line_id in chunk["lines"]:
        line = LINES[line_id]
        at = text.index(line, cursor)
        cursor = at + len(line)
        begin = starts[at] - t0
        finish = ends[at + len(line) - 1] - t0
        # Phrases start after punctuation; words after spaces. Times are relative to the line.
        phrase_at = [0] + [m.end() for m in re.finditer(r"[,.:;?!]\s+", line)]
        word_at = [0] + [m.end() for m in re.finditer(r"\s+", line)]
        spans[line_id] = {
            "chunk": chunk["id"],
            "offset": round(begin, 3),
            "dur": round(finish - begin, 3),
            "phrases": [round(starts[at + i] - t0 - begin, 3) for i in phrase_at if i < len(line)],
            "words": [[i, round(starts[at + i] - t0 - begin, 3)] for i in word_at if i < len(line)],
        }
        print(f"{line_id} {spans[line_id]['dur']:5.2f}s  {len(spans[line_id]['phrases'])} phrases  {line[:60]}")
(OUT / "spans.json").write_text(json.dumps({"chunks": chunks, "lines": spans}, indent=1))
