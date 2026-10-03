#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from demo_env import load_demo_env


class Keycloak:
    def __init__(self):
        self.base = os.getenv("KEYCLOAK_ADMIN_URL", "http://auth.betsee.localhost").rstrip("/")
        form = urlencode({
            "grant_type": "password", "client_id": "admin-cli",
            "username": os.getenv("KEYCLOAK_ADMIN", "admin"),
            "password": os.getenv("KEYCLOAK_ADMIN_PASSWORD", "admin-demo"),
        }).encode()
        request = Request(self.base + "/realms/master/protocol/openid-connect/token", data=form)
        with urlopen(request, timeout=15) as response:
            self.token = json.load(response)["access_token"]

    def request(self, method, path, payload=None, allowed=(200, 201, 204)):
        request = Request(self.base + "/admin/realms/betsee" + path, method=method,
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={"Authorization": "Bearer " + self.token,
                                   "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=15) as response:
                data = response.read()
                return json.loads(data) if data else None
        except HTTPError as error:
            if error.code in allowed:
                return None
            raise RuntimeError(f"Keycloak {method} {path} failed ({error.code}): "
                               + error.read().decode()) from error


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def upsert_local(user):
    values = [user["sub"], user["username"], user["display_name"], user["organization_id"],
              user["team_id"], json.dumps(user["roles"]), True, user["clearance"],
              json.dumps(user["entitlements"])]
    literal_values = [sql_literal(value) for value in values]
    literal_values[5] += "::jsonb"
    literal_values[6] = "TRUE"
    literal_values[7] = str(user["clearance"])
    literal_values[8] += "::jsonb"
    columns = ["sub", "username", "display_name", "organization_id", "team_id", "roles",
               "active", "clearance", "entitlements"]
    sql = ("INSERT INTO users (" + ",".join(columns) + ") VALUES ("
           + ",".join(literal_values) + ") ON CONFLICT (sub) DO UPDATE SET "
           + ",".join(column + "=EXCLUDED." + column for column in columns[1:] if column not in {"entitlements", "active", "clearance"})
           + " RETURNING sub;")
    database = os.getenv("DATABASE_URL")
    if database and os.getenv("BETSEE_BOOTSTRAP_LOCAL_PSQL") == "true" and shutil.which("psql"):
        command = ["psql", database, "-X", "-v", "ON_ERROR_STOP=1", "-tA"]
    else:
        command = ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "betsee",
                   "-d", "betsee", "-X", "-v", "ON_ERROR_STOP=1", "-tA"]
    result = subprocess.run(command, input=sql, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("PostgreSQL link failed; Keycloak user is retained and retry is safe: "
                           + result.stderr.strip())


def provision(keycloak, username, display_name, roles, team, password, clearance=1, entitlements=None):
    users = keycloak.request("GET", "/users?" + urlencode({"username": username, "exact": "true"}))
    if not users:
        first, _, last = display_name.partition(" ")
        keycloak.request("POST", "/users", {
            "username": username, "enabled": True, "firstName": first, "lastName": last,
            "email": username + "@acme.example", "emailVerified": True,
            "credentials": [{"type": "password", "value": password, "temporary": False}],
            "attributes": {"organization": ["acme"], "team": [team]},
        }, allowed=(200, 201, 204, 409))
        users = keycloak.request("GET", "/users?" + urlencode({"username": username, "exact": "true"}))
    if len(users) != 1:
        raise RuntimeError("Expected exactly one Keycloak user after creation")
    sub = users[0]["id"]
    path = "/users/" + quote(sub, safe="")
    role_models = [keycloak.request("GET", "/roles/" + quote(role, safe="")) for role in roles]
    keycloak.request("POST", path + "/role-mappings/realm", role_models)
    existing_roles = keycloak.request("GET", path + "/role-mappings/realm/composite")
    betsee_roles = {"org-admin", "security-officer", "approver", "employee", "demo-initiator"}
    user = {"sub": sub, "username": username, "display_name": display_name,
            "organization_id": "acme", "team_id": team,
            "roles": sorted(role["name"] for role in existing_roles if role["name"] in betsee_roles),
            "clearance": clearance, "entitlements": entitlements or []}
    upsert_local(user)
    return user


def main():
    load_demo_env()
    parser = argparse.ArgumentParser(description="Provision a Keycloak identity and its Betsee user link")
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--username")
    parser.add_argument("--display-name")
    parser.add_argument("--role", action="append", choices=["employee", "approver", "security-officer", "org-admin"])
    parser.add_argument("--team", choices=["finance", "support", "strategy", "platform", "security", "administration"])
    parser.add_argument("--password-env", default="BETSEE_USER_PASSWORD")
    parser.add_argument("--clearance", type=int, choices=range(4), default=1)
    args = parser.parse_args()
    if not args.seed and not all([args.username, args.display_name, args.role, args.team,
                                 os.getenv(args.password_env)]):
        parser.error("Specify username, display-name, role, team and password through the password-env variable")
    keycloak = Keycloak()
    if args.seed:
        all_caps = ["crm.read", "tickets.write", "files.read", "payments.transfer", "email.send",
                    "shell.exec", "memory.write", "agent.message", "llm.complete", "tickets.read"]
        cast = [
            ("maya", "Maya Chen", ["employee", "demo-initiator"], "finance", os.environ["DEMO_PASSWORD_MAYA"]),
            ("daniel", "Daniel Ortiz", ["security-officer", "approver"], "security", os.environ["DEMO_PASSWORD_DANIEL"]),
            ("priya", "Priya Raman", ["org-admin", "demo-initiator"], "administration", os.environ["DEMO_PASSWORD_PRIYA"]),
        ]
        for username, name, roles, team, password in cast:
            caps = ["crm.read", "files.read", "payments.transfer", "email.send", "llm.complete", "agent.message"] if username == "maya" else all_caps
            print(json.dumps(provision(keycloak, username, name, roles, team, password, clearance=3, entitlements=caps)))
    else:
        print(json.dumps(provision(keycloak, args.username, args.display_name, args.role,
                                   args.team, os.environ[args.password_env], args.clearance)))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
