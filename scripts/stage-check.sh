#!/bin/sh
set -eu
stage_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec python3 "$stage_root/scripts/stage-check.py"
