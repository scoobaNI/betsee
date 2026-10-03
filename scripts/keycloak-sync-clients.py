#!/usr/bin/env python3
"""Create realm clients that infra/keycloak/betsee-realm.json defines but the running realm lacks.

Keycloak imports the realm file only when the realm does not exist yet, so a client added to the
file later never reaches a stack that is already running. This adds it through kcadm.sh inside the
keycloak container, with the container's own bootstrap admin credentials. Existing clients are
left untouched.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Demo defaults for secrets that infra/compose.yml also defaults; an exported variable wins.
DEFAULTS = {"AGENT_CLIENT_SECRET_EMPLOYEE_ASSISTANT": "employee-assistant-demo-secret"}


def kcadm(script, stdin=None):
    login = ('/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 '
             '--realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" '
             '--password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null && ')
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "keycloak", "bash", "-ec", login + script],
        cwd=ROOT, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout


def substitute(client):
    def value(match):
        name = match.group(1)
        found = os.environ.get(name) or DEFAULTS.get(name)
        if found is None:
            raise RuntimeError(f"{name} is not set; export it before syncing {client['clientId']}")
        return found
    return json.loads(re.sub(r"\$\{([A-Z0-9_]+)\}", value, json.dumps(client)))


def main(wanted):
    realm = json.loads((ROOT / "infra/keycloak/betsee-realm.json").read_text())
    existing = {client["clientId"] for client in json.loads(
        kcadm("/opt/keycloak/bin/kcadm.sh get clients -r betsee --fields clientId"))}
    for client in realm["clients"]:
        client_id = client["clientId"]
        if wanted and client_id not in wanted:
            continue
        if client_id in existing:
            print(f"{client_id}: present")
            continue
        kcadm("/opt/keycloak/bin/kcadm.sh create clients -r betsee -f -",
              json.dumps(substitute(client)))
        print(f"{client_id}: created")


if __name__ == "__main__":
    try:
        main(set(sys.argv[1:]))
    except RuntimeError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
