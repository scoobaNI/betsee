#!/usr/bin/env bash
set -eu
tests_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
exec python3 "$tests_dir/security/run.py" "$@"
