"""Builds stage/timeline.json from stage/acts.json and the spoken length of each voiced line
(out/vo/spans.json): every act runs lead + its lines with their gaps + tail, back to back. Scenes
time themselves against their act's lines, so re-voicing only needs this script to run again.

    python3 film/stage/plan.py
"""

import json
from pathlib import Path

HERE = Path(__file__).parent
plan = json.loads((HERE / "acts.json").read_text())
spans = json.loads((HERE.parent / "out" / "vo" / "spans.json").read_text())

acts, vo, t = [], [], 0.0
for act in plan["acts"]:
    start = t
    t += act["lead"]
    for line_id, gap in act["lines"]:
        t += gap
        span = spans[line_id]
        vo.append({"id": line_id, "at": round(t, 3), "dur": span["dur"], "phrases": span["phrases"], "act": act["id"]})
        t += span["dur"]
    t += act["tail"]
    acts.append({"id": act["id"], "start": round(start, 3), "end": round(t, 3)})

timeline = {"fps": plan["fps"], "duration": round(t, 3), "acts": acts, "vo": vo}
(HERE / "timeline.json").write_text(json.dumps(timeline, indent=2) + "\n")
print(f"{t:.1f} s, {len(acts)} acts, {len(vo)} lines")
for a in acts:
    print(f"  {a['id']:<9} {a['start']:7.2f} {a['end']:7.2f}  ({a['end'] - a['start']:.1f} s)")
