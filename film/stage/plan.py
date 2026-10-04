"""Builds stage/timeline.json from stage/acts.json and the voiced chunks (out/vo/spans.json): every
act runs lead + its chunks with the pauses between them + tail, back to back. Each line keeps its
phrase and word starts, so scenes can land on a word. Re-voicing only needs this script to run again.

    python3 film/stage/plan.py
"""

import json
from pathlib import Path

HERE = Path(__file__).parent
plan = json.loads((HERE / "acts.json").read_text())
spans = json.loads((HERE.parent / "out" / "vo" / "spans.json").read_text())

acts, vo, chunks, t = [], [], [], 0.0
for act in plan["acts"]:
    start = t
    t += act["lead"]
    chunk_at = None
    for line_id, gap in act["lines"]:
        span = spans["lines"][line_id]
        if span["chunk"] == line_id:
            # A new chunk: after the pause, its audio starts here.
            t += gap
            chunk_at = t
            chunks.append({"id": line_id, "at": round(t, 3)})
            t += spans["chunks"][line_id]["dur"]
        vo.append(
            {
                "id": line_id,
                "act": act["id"],
                "at": round(chunk_at + span["offset"], 3),
                "dur": span["dur"],
                "phrases": span["phrases"],
                "words": span["words"],
            }
        )
    t += act["tail"]
    acts.append({"id": act["id"], "start": round(start, 3), "end": round(t, 3)})

texts = {line["id"]: line["text"] for line in json.loads((HERE.parent / "audio" / "narration.json").read_text())["lines"]}
timeline = {"fps": plan["fps"], "duration": round(t, 3), "acts": acts, "vo": vo, "chunks": chunks, "lines": {v["id"]: texts[v["id"]] for v in vo}}
(HERE / "timeline.json").write_text(json.dumps(timeline, indent=2) + "\n")
print(f"{t:.1f} s, {len(acts)} acts, {len(vo)} lines, {len(chunks)} chunks")
for a in acts:
    print(f"  {a['id']:<9} {a['start']:7.2f} {a['end']:7.2f}  ({a['end'] - a['start']:.1f} s)")
