#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from demo_env import load_demo_env


ROOT = Path(__file__).resolve().parent.parent


def compose(*arguments, input_text=None):
    return subprocess.run(["docker", "compose", "--project-name", "betsee", *arguments], cwd=ROOT, input=input_text,
                          capture_output=True, text=True, timeout=30, check=True).stdout


def sql(query):
    return compose("exec", "-T", "-e", "PGOPTIONS=-c default_transaction_read_only=on", "postgres",
                   "psql", "-U", "betsee", "-d", "betsee", "-v", "ON_ERROR_STOP=1", "-Atc", query).strip()


def snapshot():
    return sql("""SELECT json_build_object(
      'objects',(SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY kind,id)) FROM gateway_objects t),
      'entities',(SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY entity_type,entity_id)) FROM cedar_entities t),
      'users',(SELECT md5(string_agg(to_jsonb(t)::text,'' ORDER BY sub)) FROM users t),
      'audit_rows',(SELECT count(*) FROM audit_records),
      'security_rows',(SELECT count(*) FROM security_events))::text""")


def containers():
    output = compose("ps", "--all", "--format", "json").strip()
    if output.startswith("["):
        return json.loads(output)
    return [json.loads(line) for line in output.splitlines()]


def http(url, token=None):
    headers = {"Authorization": "Bearer " + token} if token else {}
    try:
        with urlopen(Request(url, headers=headers), timeout=10) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()


def get_api(path, token):
    status, body = http("http://api.betsee.localhost/api/v1/" + path, token)
    if status != 200:
        raise RuntimeError(f"authenticated GET {path} returned HTTP {status}")
    return json.loads(body)


def mcp_tools():
    token = os.environ["MCP_GATEWAY_TOKEN"]
    session_id = None

    def request(method, payload=None):
        nonlocal session_id
        headers = ["Content-Type: application/json", "Accept: application/json, text/event-stream",
                   "Authorization: Bearer " + token]
        if session_id:
            headers += ["Mcp-Session-Id: " + session_id, "MCP-Protocol-Version: 2025-03-26"]
        config = ["url = " + json.dumps(os.environ["MCP_URL"]), "request = " + json.dumps(method)]
        config += ["header = " + json.dumps(header) for header in headers]
        if payload is not None:
            config += ["data = " + json.dumps(json.dumps(payload))]
        raw = compose("exec", "-T", "gateway", "curl", "-si", "--max-time", "10", "--config", "-",
                      input_text="\n".join(config) + "\n")
        head, _, body = raw.partition("\n\n")
        status = int(head.splitlines()[0].split()[1])
        if status not in (200, 202, 204):
            raise RuntimeError(f"MCP {method} returned HTTP {status}")
        for line in head.splitlines()[1:]:
            name, _, value = line.partition(":")
            if name.lower() == "mcp-session-id":
                session_id = value.strip()
        if not payload or "id" not in payload:
            return None
        messages = [json.loads(line[5:].strip()) for line in body.splitlines()
                    if line.startswith("data:") and line[5:].strip()]
        response = next((item for item in messages if item.get("id") == payload["id"]), None)
        response = response or json.loads(body)
        if "error" in response:
            raise RuntimeError("MCP protocol request failed")
        return response["result"]

    try:
        info = request("POST", {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "betsee-stage-check", "version": "1"},
        }})
        if info["protocolVersion"] != "2025-03-26":
            raise RuntimeError("Unexpected MCP protocol version")
        request("POST", {"jsonrpc": "2.0", "method": "notifications/initialized"})
        return request("POST", {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})["tools"]
    finally:
        if session_id:
            request("DELETE")


def main():
    load_demo_env()
    failures = []

    def check(label, operation, describe=str):
        try:
            detail = operation()
            print(f"PASS {label}: {describe(detail)}", flush=True)
            return detail
        except Exception as error:
            failures.append(label)
            reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
            print(f"FAIL {label}: {reason}", flush=True)
            return None

    before = check("read-only baseline", snapshot, lambda _: "captured")
    rows = check("Compose status", containers, lambda value: f"{len(value)} containers inspected")
    if rows is not None:
        by_service = {row["Service"]: row for row in rows}
        for service in ["postgres", "keycloak", "mcp", "mock-llm", "gateway", "demo-runner", "caddy", "init-env", "bootstrap"]:
            def healthy(service=service):
                row = by_service.get(service, {})
                if service in {"init-env", "bootstrap"}:
                    if row.get("State") != "exited" or row.get("ExitCode") != 0:
                        raise RuntimeError("startup preparation did not complete successfully")
                    return "completed"
                if row.get("State") != "running" or row.get("Health") != "healthy":
                    raise RuntimeError("service is absent or unhealthy")
                return "healthy"
            check(service, healthy)
    for label, url, expected in [
        ("Ecosystem", "http://betsee.localhost/", 200),
        ("Director", "http://director.betsee.localhost/", 200),
        ("OIDC discovery", "http://auth.betsee.localhost/realms/betsee/.well-known/openid-configuration", 200),
        ("Keycloak admin blocked", "http://auth.betsee.localhost/admin/", 404),
    ]:
        def status_check(url=url, expected=expected):
            status, _ = http(url)
            if status != expected:
                raise RuntimeError(f"expected HTTP {expected}, received {status}")
            return f"HTTP {status}"
        check(label, status_check)
    def gateway_health():
        body = compose("exec", "-T", "gateway", "curl", "-fsS", "--max-time", "10", "http://127.0.0.1:8080/healthz")
        if json.loads(body)["status"] != "ok":
            raise RuntimeError("Gateway health is not ready")
        return "internal HTTP 200"
    check("Gateway health", gateway_health)
    print("SKIP unauthenticated API probe: would append a security event", flush=True)

    token = None
    def password_login():
        nonlocal token
        helper = runpy.run_path(str(ROOT / "scripts" / "oidc-login.py"))
        tokens, claims, _ = helper["login"]("daniel", os.environ["DEMO_PASSWORD_DANIEL"], acr="1", otp_secret=None)
        if claims.get("sub") != "00000000-0000-4000-8000-000000000002" or claims.get("exp", 0) <= time.time() + 30:
            raise RuntimeError("Daniel identity or token lifetime is unexpected")
        audience = claims.get("aud", [])
        audience = [audience] if isinstance(audience, str) else audience
        if os.environ["OIDC_AUDIENCE"] not in audience:
            raise RuntimeError("Gateway audience missing; authenticated probe skipped")
        token = tokens["access_token"]
        return "acr 1; no OTP"
    check("Daniel password sign-in", password_login)
    if token:
        def me():
            identity = get_api("me", token)
            if identity["human"]["sub"] != "00000000-0000-4000-8000-000000000002" or identity["acr"] != "1":
                raise RuntimeError("Gateway returned another human or authentication level")
            return "HTTP 200; Daniel"
        check("authenticated API", me)

        def agents():
            items = get_api("agents", token)["items"]
            required = {"invoice-assistant", "support-triage", "research-agent", "ops-runner", "report-bot"}
            if not required.issubset({item["id"] for item in items}) or any(item["state"] != "active" for item in items):
                raise RuntimeError("a demo agent is missing, suspended or quarantined")
            return f"all {len(items)} active"
        check("agent states", agents)

        def approvals():
            pending = [item for item in get_api("approvals", token)["items"] if item["state"] == "pending"]
            if pending:
                raise RuntimeError(f"{len(pending)} pending approvals; presenter must reset before stage")
            return "none pending"
        check("approvals", approvals)

    def scenarios():
        output = compose("exec", "-T", "demo-runner", "python", "-m", "runner", "list")
        acts = re.findall(r"\bact\s+([1-6])\b", output)
        if sorted(acts) != ["1", "2", "3", "4", "5", "6"]:
            raise RuntimeError("runner does not list exactly the six acts")
        return "acts 1-6"
    check("scenario runner", scenarios)

    def payments():
        cached = sql("SELECT data::text FROM gateway_objects WHERE kind='tool_status' AND id='payments'")
        pin = sql("SELECT data->'attrs'->>'pinnedDescriptorHash' FROM cedar_entities WHERE entity_type='Betsee::Tool' AND entity_id='payments'")
        if (cached and json.loads(cached)["status"] != "ready") or not pin:
            raise RuntimeError("persisted payments tool is not ready")
        tool = next((tool for tool in mcp_tools() if tool["name"] == "payments"), None)
        actual = "sha256:" + hashlib.sha256(json.dumps(tool, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        if tool is None or actual != pin:
            raise RuntimeError("live payments descriptor differs from its reviewed pin")
        return "ready; live descriptor matches pin; no tool executed"
    check("payments tool", payments)
    def unchanged():
        if before is None or snapshot() != before:
            raise RuntimeError("Betsee state changed during preflight; run alone after final reset")
        return "no audit/security rows or operational data changed"
    check("Betsee state unchanged", unchanged)
    print("NO-GO" if failures else "GO", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
