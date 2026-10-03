import argparse
import json
import os
import subprocess
from pathlib import Path

from harness import HttpClient


def command(argv, env=None):
    result = subprocess.run(argv, capture_output=True, text=True, env=env, timeout=60)
    if result.returncode:
        raise AssertionError(f"{argv[0]} operation failed with exit {result.returncode}")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description="Independent F06 bootstrap/linkage review on the supplied isolated stack")
    parser.add_argument("--isolated-compose", type=Path, default=Path("/tmp/betsee-identity-check.json"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    isolated = json.loads(args.isolated_compose.read_text())
    if isolated["name"] == "betsee" or any(service.get("ports") for service in isolated["services"].values()):
        raise AssertionError("Bootstrap review requires an isolated project with no published ports")
    compose = ["docker", "compose", "-f", str(args.isolated_compose)]

    def query(database, sql):
        output = command(compose + ["exec", "-T", "postgres", "psql", "-U", "betsee", "-d", database, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql])
        return json.loads(output)

    keycloak_env = isolated["services"]["keycloak"]["environment"]
    overlay = root / "tests/security/identity-overlay.local.json"
    overlay.write_text(json.dumps({"services": {"bootstrap": {
        "image": "betsee-bootstrap:latest", "environment": {"DATABASE_URL": "postgres://betsee:" + keycloak_env["POSTGRES_PASSWORD"] + "@postgres:5432/betsee", "KEYCLOAK_ADMIN_URL": "http://keycloak:8080", "KEYCLOAK_ADMIN": keycloak_env["KEYCLOAK_ADMIN"], "KEYCLOAK_ADMIN_PASSWORD": keycloak_env["KEYCLOAK_ADMIN_PASSWORD"], **{key: value for key, value in keycloak_env.items() if key.startswith("DEMO_PASSWORD_")}},
        "volumes": [f"{root}/scripts/bootstrap.py:/app/bootstrap.py:ro", f"{root}/scripts/demo_env.py:/app/demo_env.py:ro"],
    }}}))
    bootstrap = compose + ["-f", str(overlay), "run", "--rm", "--no-deps", "bootstrap"]
    cast_query = "SELECT json_agg(row_to_json(u) ORDER BY username) FROM (SELECT username,sub,team_id,roles,active,clearance,entitlements FROM users WHERE username IN ('maya','daniel','priya')) u;"
    first = None
    for _ in range(2):
        command(bootstrap + ["--seed"])
        rows = query("betsee", cast_query)
        if first is not None and rows != first:
            raise AssertionError("Second bootstrap seed changed identity linkage")
        first = rows
    if len(first) != 3:
        raise AssertionError("Bootstrap did not retain exactly three cast users")
    keycloak_users = query("keycloak", "SELECT json_agg(row_to_json(u) ORDER BY username) FROM (SELECT username,id,enabled FROM user_entity WHERE realm_id=(SELECT id FROM realm WHERE name='betsee') AND username IN ('maya','daniel','priya')) u;")
    ids = {user["username"]: user["id"] for user in keycloak_users if user["enabled"]}
    policy = json.loads((root / "policies/tests/acme-cases.json").read_text())
    entitlements = {entity["uid"]["id"]: {cap["__entity"]["id"] for cap in entity["attrs"]["entitlements"]} for entity in policy["entities"] if entity["uid"]["type"] == "Betsee::Human"}
    expected = {"maya": ("finance", {"employee", "demo-initiator"}), "daniel": ("security", {"security-officer", "approver"}), "priya": ("administration", {"org-admin", "demo-initiator"})}
    for user in first:
        name = user["username"]
        team, roles = expected[name]
        if user["sub"] != ids[name] or user["team_id"] != team or set(user["roles"]) != roles or not user["active"] or user["clearance"] != 3 or set(user["entitlements"]) != entitlements[name]:
            raise AssertionError(f"Wrong live bootstrap linkage or authority for {name}")
    print("PASS: two seed runs retain three stable Keycloak sub / PostgreSQL team, role and entitlement links")

    clients = query("keycloak", "SELECT json_agg(row_to_json(c) ORDER BY client_id) FROM (SELECT client_id,public_client,direct_access_grants_enabled,service_accounts_enabled FROM client WHERE realm_id=(SELECT id FROM realm WHERE name='betsee') AND client_id IN ('betsee-ecosystem','betsee-director','invoice-assistant','support-triage','research-agent','ops-runner','report-bot')) c;")
    if len(clients) != 7:
        raise AssertionError("Cold realm missing public browser or confidential agent clients")
    for client in clients:
        browser = client["client_id"] in ("betsee-ecosystem", "betsee-director")
        if client["public_client"] != browser or client["direct_access_grants_enabled"] or bool(client["service_accounts_enabled"]) == browser:
            raise AssertionError("Live client confidentiality, direct-grant or service-account settings differ from the identity contract")
    pkce = query("keycloak", "SELECT json_agg(row_to_json(a)) FROM (SELECT c.client_id,ca.value FROM client c JOIN client_attributes ca ON ca.client_id=c.id WHERE c.realm_id=(SELECT id FROM realm WHERE name='betsee') AND c.client_id IN ('betsee-ecosystem','betsee-director') AND ca.name='pkce.code.challenge.method') a;")
    if len(pkce) != 2 or any(item["value"] != "S256" for item in pkce):
        raise AssertionError("Browser clients do not enforce S256 PKCE")
    print("PASS: cold imported realm has two public S256 PKCE clients and five confidential service-account clients")

    env = os.environ | {"BETSEE_USER_PASSWORD": "security-tester-probe-demo"}
    probe = bootstrap[:-1] + ["-e", "BETSEE_USER_PASSWORD", "bootstrap", "--username", "security-tester-probe", "--display-name", "Security Tester Probe", "--role", "employee", "--team", "support"]
    probe_first = None
    for _ in range(2):
        created = json.loads(command(probe, env=env))
        if probe_first is not None and created["sub"] != probe_first:
            raise AssertionError("Repeated new-user bootstrap changed Keycloak sub")
        probe_first = created["sub"]
    rows = query("betsee", "SELECT json_agg(row_to_json(u)) FROM (SELECT username,sub,team_id,roles FROM users WHERE username='security-tester-probe') u;")
    if len(rows) != 1 or rows[0]["sub"] != probe_first or rows[0]["team_id"] != "support" or rows[0]["roles"] != ["employee"]:
        raise AssertionError("New-user bootstrap duplicated or incorrectly linked the probe")
    print("PASS: two new-user bootstrap runs retain one employee/support row and the same Keycloak sub")

    realm = json.loads((root / "infra/keycloak/betsee-realm.json").read_text())
    for client in realm["clients"]:
        if client.get("secret") and not client["secret"].startswith("${"):
            raise AssertionError("Realm import contains a literal client secret")
    for user in realm["users"]:
        for credential in user.get("credentials", []):
            if credential["type"] == "password" and not credential["value"].startswith("${"):
                raise AssertionError("Realm import contains a literal password")
            if credential["type"] == "otp" and "${BETSEE_TOTP_SECRET}" not in credential["secretData"]:
                raise AssertionError("Realm import contains a literal OTP seed")
    print("PASS: realm import contains environment references for client secrets, passwords and OTP seed")
    http = HttpClient({"auth": "http://auth.betsee.localhost"})
    for path in ("/admin/", "/realms/master", "/realms/master/.well-known/openid-configuration"):
        if http.request({"base": "auth", "path": path}, {}).status != 404:
            raise AssertionError(f"Caddy exposes protected Keycloak path {path}")
    print("PASS: Caddy returns404 for Keycloak admin and master realm paths")


if __name__ == "__main__":
    main()
