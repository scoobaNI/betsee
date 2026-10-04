"""Trims each voiced line to its speech (with a short pad) and reports the spoken length, which the
film's timeline is fitted to. Writes out/vo/<id>.wav (48 kHz stereo) and out/vo/spans.json.

narration.json's "tempo" (default 1.0) speeds every line up without changing pitch (ffmpeg atempo)."""
import json
import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
OUT = HERE.parent / "out" / "vo"
RATE = 48_000
PAD = 0.03


SCRIPT = json.loads((HERE / "narration.json").read_text())
TEMPO = SCRIPT.get("tempo", 1.0)


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-af", f"atempo={TEMPO}", "-f", "f32le", "-ac", "1", "-ar", str(RATE), "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def phrases(samples: np.ndarray, min_gap: float = 0.16) -> list[float]:
    """Start times (s) of the phrases in a trimmed line: speech after a pause of at least min_gap."""
    window = RATE // 100
    frames = len(samples) // window
    rms = np.sqrt(np.mean(samples[: frames * window].reshape(frames, window) ** 2, axis=1))
    loud = rms > max(rms.max() * 0.05, 1e-3)
    starts, quiet = [], int(min_gap * 100)
    run = quiet
    for i, on in enumerate(loud):
        if on and run >= quiet:
            starts.append(round(i / 100, 2))
        run = 0 if on else run + 1
    return starts


def speech_span(samples: np.ndarray) -> tuple[int, int]:
    window = RATE // 100
    frames = len(samples) // window
    rms = np.sqrt(np.mean(samples[: frames * window].reshape(frames, window) ** 2, axis=1))
    loud = np.nonzero(rms > max(rms.max() * 0.03, 1e-3))[0]
    return loud[0] * window, (loud[-1] + 1) * window


spans = {}
for line in SCRIPT["lines"]:
    samples = decode(OUT / f"{line['id']}.mp3")
    start, end = speech_span(samples)
    pad = int(PAD * RATE)
    clip = samples[max(0, start - pad) : min(len(samples), end + pad)]
    stereo = np.repeat(clip[:, None], 2, axis=1).astype(np.float32)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", "-", str(OUT / f"{line['id']}.wav")],
        input=stereo.tobytes(),
        check=True,
    )
    spans[line["id"]] = {"dur": round(len(clip) / RATE, 3), "phrases": phrases(clip)}
    print(f"{line['id']} {spans[line['id']]['dur']:5.2f}s  {spans[line['id']]['phrases']}  {line['text']}")
(OUT / "spans.json").write_text(json.dumps(spans, indent=1))
