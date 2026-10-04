"""Writes out/betsee-launch.srt: the narration as captions, timed from the timeline and the spoken
length of each voiced line (out/vo/spans.json), for autoplay without sound."""

import json
from pathlib import Path

HERE = Path(__file__).parent
FILM = HERE.parent
lines = {line["id"]: line["text"] for line in json.loads((HERE / "narration.json").read_text())["lines"]}
spans = json.loads((FILM / "out" / "vo" / "spans.json").read_text())
timeline = json.loads((FILM / "stage" / "timeline.json").read_text())


def stamp(seconds: float) -> str:
    ms = round(seconds * 1000)
    return f"{ms // 3_600_000:02d}:{ms // 60_000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


cues = []
for index, vo in enumerate(timeline["vo"], start=1):
    start = vo["at"]
    end = start + spans[vo["id"]]["dur"] + 0.25
    cues.append(f"{index}\n{stamp(start)} --> {stamp(end)}\n{lines[vo['id']]}\n")
(FILM / "out" / "betsee-launch.srt").write_text("\n".join(cues))
print(FILM / "out" / "betsee-launch.srt")
