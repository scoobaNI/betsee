#!/usr/bin/env bash
# Starts agent-host on this machine: the employee chat's Claude Code runner, governed by Betsee.
# It runs outside Docker because the claude CLI and its login live here. Caddy reaches it through
# host.docker.internal, so it listens on loopback and on the Docker bridge gateway address.
#
#   scripts/agent-host.sh                    build and run
#   scripts/agent-host.sh --reset-workspace  restore the demo workspace from demo/workspace first
set -euo pipefail
cd "$(dirname "$0")/.."

workspace=state/agent-workspace
if [[ "${1:-}" == "--reset-workspace" || ! -d "$workspace" ]]; then
  rm -rf "$workspace"
  mkdir -p state
  cp -R demo/workspace "$workspace"
  echo "agent-host: demo workspace restored at $workspace"
fi

command -v claude >/dev/null || { echo "agent-host: the claude CLI is not on PATH" >&2; exit 1; }

secret="${AGENT_CLIENT_SECRET_EMPLOYEE_ASSISTANT:-}"
if [[ -z "$secret" && -f .env ]]; then
  secret="$(sed -n 's/^AGENT_CLIENT_SECRET_EMPLOYEE_ASSISTANT=//p' .env | tail -n 1)"
fi
export AGENT_CLIENT_SECRET="${secret:-employee-assistant-demo-secret}"

bridge="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
listen="127.0.0.1:8095"
[[ -n "$bridge" ]] && listen="$listen,$bridge:8095"
export AGENT_HOST_LISTEN="${AGENT_HOST_LISTEN:-$listen}"
export AGENT_WORKSPACE="$workspace"
export AGENT_HOST_STATE="${AGENT_HOST_STATE:-state/agent-host}"

cargo build --release --manifest-path gateway/Cargo.toml -p betsee-agent-host
exec gateway/target/release/agent-host serve
