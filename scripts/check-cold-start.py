#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description="Verify startup with isolated volumes and no published ports")
    parser.add_argument("--project", default="betsee-cold-check")
    parser.add_argument("--build", action="store_true", help="Build images; coordinate the team's build window first")
    parser.add_argument("--config-only", action="store_true")
    args = parser.parse_args()
    if args.project == "betsee" or not re.fullmatch(r"betsee-cold-[a-z0-9-]+", args.project):
        parser.error("Use a dedicated betsee-cold-* project, never the shared betsee project")
    root = Path(__file__).resolve().parent.parent
    config = json.loads(subprocess.check_output(["docker", "compose", "config", "--format", "json"], cwd=root))
    original_project = config["name"]
    config["name"] = args.project
    for name, volume in config.get("volumes", {}).items():
        volume["name"] = args.project + "_" + name
    for name, network in config.get("networks", {}).items():
        network["name"] = args.project + "_" + name
    workspace = Path(tempfile.mkdtemp(prefix=args.project + "-"))
    (workspace / ".env.example").write_bytes((root / ".env.example").read_bytes())
    for name, service in config["services"].items():
        service.pop("ports", None)
        if "build" in service and "image" not in service:
            service["image"] = original_project + "-" + name
        if name == "init-env":
            for mount in service.get("volumes", []):
                if mount.get("target") == "/workspace":
                    mount["source"] = str(workspace)
        if name == "caddy":
            service["networks"]["default"] = service["networks"].get("default") or {}
            service["networks"]["default"]["aliases"] = [
                "betsee.localhost", "director.betsee.localhost", "auth.betsee.localhost", "api.betsee.localhost",
            ]
    path = workspace / "compose.json"
    path.touch(mode=0o600)
    path.write_text(json.dumps(config))
    print("Isolated Compose configuration:", path, flush=True)
    if args.config_only:
        return
    command = ["docker", "compose", "-f", str(path)]
    started = time.monotonic()
    subprocess.run(command + ["up", "-d", "--wait", "--build" if args.build else "--no-build"], check=True, cwd=root)
    assert (workspace / ".env").read_bytes() == (workspace / ".env.example").read_bytes()
    rows = subprocess.check_output(command + ["exec", "-T", "postgres", "psql", "-U", "betsee", "-d", "betsee", "-Atc",
        "SELECT username || ':' || sub || ':' || team_id FROM users ORDER BY username"], text=True)
    expected = [
        "daniel:00000000-0000-4000-8000-000000000002:security",
        "maya:00000000-0000-4000-8000-000000000001:finance",
        "priya:00000000-0000-4000-8000-000000000003:administration",
    ]
    assert rows.strip().splitlines() == expected, rows
    for host in ["betsee.localhost", "director.betsee.localhost"]:
        page = subprocess.check_output(command + ["exec", "-T", "caddy", "wget", "-qO-", "--header", "Host: " + host, "http://127.0.0.1/"], text=True)
        assert '<div id="root"' in page, host
    print(f"Cold convergence, generated .env, seeded identity links and both static hosts: passed in {time.monotonic() - started:.1f}s", flush=True)
    print("Retained isolated stack for independent verification:", args.project, flush=True)


if __name__ == "__main__":
    main()
