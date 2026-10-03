"""python -m runner [serve | list | run <scenario-id> | reset]

serve  HTTP service for the Director's scenario dock (default; port from PORT, default 8090).
list   print the scenarios.
run    play one scenario from the terminal (the stage fallback); exit 1 if any step mismatches.
reset  restore the demo; needs a presenter token in BETSEE_PRESENTER_TOKEN.
"""

import json
import os
import sys

from . import core, server


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "serve"
    if cmd == "serve":
        server.serve(int(os.environ.get("PORT", "8090")))
        return 0
    if cmd == "list":
        for s in core.load_scenarios().values():
            print(f"{s['id']:<34} act {s['act']}  {' '.join(s['asi']) or '-':<24} {s['title']}")
        return 0
    if cmd == "run" and len(argv) > 2:
        scenario = core.load_scenarios().get(argv[2])
        if scenario is None:
            print(f"unknown scenario {argv[2]}", file=sys.stderr)
            return 2
        run = core.Run(scenario)
        core.RUNS[run.id] = run
        core.execute(run, scenario, log=lambda line: print(line, flush=True))
        print(f"{run.id}: {run.status}" + (f" ({run.error})" if run.error else ""))
        return 0 if run.status == "passed" else 1
    if cmd == "reset":
        token = core.env("BETSEE_PRESENTER_TOKEN")
        if core.token_azp(token) not in core.PRESENTER_CLIENTS:
            print("BETSEE_PRESENTER_TOKEN must be the presenter's browser token (D8)", file=sys.stderr)
            return 2
        result = core.reset(token)
        print(json.dumps(result, indent=2))
        return 0 if result["ok"] else 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
