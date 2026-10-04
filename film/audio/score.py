"""The film's mix: the ElevenLabs score (out/music/score-a.mp3), the narration (out/vo/<id>.wav at
the timeline's times) and the ElevenLabs sound effects (out/sfx/) at the cues the scenes registered
(out/cues.json, written by `render.mjs --cues`). The score ducks under the voice. Each sound effect
is one fixed sample reused at every cue of its kind, so identical decisions sound identical.

    node film/render/render.mjs --cues && python3 film/audio/score.py
"""

import json
import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
FILM = HERE.parent
OUT = FILM / "out"
RATE = 48_000
TL = json.loads((FILM / "stage" / "timeline.json").read_text())
CUES = json.loads((OUT / "cues.json").read_text())
DUR = TL["duration"]
N = int(DUR * RATE)

MUSIC = OUT / "music" / "score-a.mp3"
# The score was generated at 243 s with its final chord around 232-236 s; starting it a little late
# puts that chord under the closing line.
MUSIC_AT = 3.0
MUSIC_GAIN = 0.45
DUCK = 0.3  # the score's level while the narrator speaks: about 10 dB under the voice
SFX_GAIN = {"deny": 0.5, "allow": 0.42, "approval": 0.4, "tick": 0.32, "otp": 0.45, "whoosh": 0.3, "boom": 0.55, "shimmer": 0.35}
ALIASES = {"final": ["boom", "shimmer"]}


def load(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(RATE), "-"], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def add(buf: np.ndarray, at: float, sig: np.ndarray, gain: float = 1.0) -> None:
    i = int(round(at * RATE))
    if i >= len(buf):
        return
    j = max(0, -i)
    sig = sig[j : len(buf) - max(i, 0) + j]
    buf[max(i, 0) : max(i, 0) + len(sig)] += sig * gain


music = np.zeros((N, 2))
add(music, MUSIC_AT, load(MUSIC))

fx = np.zeros((N, 2))
samples = {p.stem: load(p) for p in (OUT / "sfx").glob("*.mp3")}
for cue in CUES:
    for kind in ALIASES.get(cue["kind"], [cue["kind"]]):
        if kind not in samples:
            raise SystemExit(f"no sound for cue kind {kind}")
        add(fx, cue["at"], samples[kind], SFX_GAIN.get(kind, 0.4))

voice = np.zeros((N, 2))
for line in TL["vo"]:
    add(voice, line["at"], load(OUT / "vo" / f"{line['id']}.wav"))

# Duck the score under the voice: a smoothed voice-activity envelope, 80 ms in, 450 ms out.
block = RATE // 100
frames = N // block
active = np.abs(voice[: frames * block]).max(axis=1).reshape(frames, block).max(axis=1) > 0.01
env = np.zeros(frames)
level = 0.0
for i, on in enumerate(active):
    target = 1.0 if on else 0.0
    rate = 1 / 8 if target > level else 1 / 45
    level += (target - level) * rate
    env[i] = level
gain = 1 - (1 - DUCK) * np.repeat(env, block)
gain = np.concatenate([gain, np.full(N - len(gain), gain[-1])])

mix = music * (MUSIC_GAIN * gain)[:, None] + fx + voice
fade_in = int(0.8 * RATE)
fade_out = int(1.4 * RATE)
mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
mix[-fade_out:] *= (np.linspace(1, 0, fade_out) ** 2)[:, None]
mix /= np.abs(mix).max() / 0.9

raw = OUT / "mix-raw.wav"
pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(RATE), "-ac", "2", "-i", "-", str(raw)], input=pcm.tobytes(), check=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", "loudnorm=I=-16:TP=-1.0:LRA=11", "-ar", str(RATE), str(OUT / "mix.wav")], check=True)
raw.unlink()
print(OUT / "mix.wav", f"{DUR:.1f} s, {len(CUES)} cues, {len(TL['vo'])} lines")
