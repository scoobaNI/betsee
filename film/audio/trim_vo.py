"""Trims each voiced line to its speech (with a short pad) and reports the spoken length, which the
film's timeline is fitted to. Writes out/vo/<id>.wav (48 kHz stereo) and out/vo/spans.json."""
import json
import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
OUT = HERE.parent / "out" / "vo"
RATE = 48_000
PAD = 0.03


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(RATE), "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def speech_span(samples: np.ndarray) -> tuple[int, int]:
    window = RATE // 100
    frames = len(samples) // window
    rms = np.sqrt(np.mean(samples[: frames * window].reshape(frames, window) ** 2, axis=1))
    loud = np.nonzero(rms > max(rms.max() * 0.03, 1e-3))[0]
    return loud[0] * window, (loud[-1] + 1) * window


spans = {}
for line in json.loads((HERE / "narration.json").read_text())["lines"]:
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
    spans[line["id"]] = round(len(clip) / RATE, 3)
    print(f"{line['id']} {spans[line['id']]:5.2f}s  {line['text']}")
(OUT / "spans.json").write_text(json.dumps(spans, indent=1))
