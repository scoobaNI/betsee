import json
import os
import re
import subprocess
import time
import unittest
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


@dataclass
class Response:
    status: int
    body: object


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def field(value, path):
    for part in path.split(".") if path else ():
        if isinstance(value, list):
            value = value[int(part)]
        else:
            value = value[part]
    return value


def resolve(value, variables):
    if isinstance(value, dict):
        if set(value) == {"$ref"}:
            return variables[value["$ref"]]
        if set(value) == {"$env"}:
            return os.environ[value["$env"]]
        if set(value) == {"$format"}:
            return value["$format"].format_map(variables)
        return {key: resolve(item, variables) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve(item, variables) for item in value]
    return value


class HttpClient:
    def __init__(self, bases, timeout=8):
        self.bases = bases
        self.timeout = timeout
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.credential_cache = {}

    def request(self, spec, variables):
        spec = resolve(spec, variables)
        path = spec["path"]
        parsed = urlsplit(path)
        if not path.startswith("/") or path.startswith("//") or parsed.scheme or parsed.netloc:
            raise ValueError("Request paths must stay on the configured service origin")
        base = self.bases[spec.get("base", "api")].rstrip("/")
        headers = dict(spec.get("headers", {}))
        data = None
        if "json" in spec:
            headers["Content-Type"] = "application/json"
            data = json.dumps(spec["json"]).encode()
        elif "form" in spec:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            data = urlencode(spec["form"]).encode()
        request = Request(base + path, data=data, headers=headers, method=spec.get("method", "GET"))
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                status, raw = response.status, response.read()
        except HTTPError as error:
            status, raw = error.code, error.read()
        except (URLError, TimeoutError, OSError) as error:
            raise AssertionError(f"Cannot reach {spec.get('base', 'api')} service: {type(error).__name__}") from None
        try:
            body = json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            body = None
        return Response(status, body)


DEFAULT_FIELDS = {
    "decision": "decision",
    "executed": "executed",
    "output": "output",
    "trace_id": "trace_id",
    "controls": "control_ids",
    "deterministic_decision": "deterministic_decision",
    "analysis_verdict": "analyzer.verdict",
    "analysis_label": "analyzer.model_label",
    "events": "items",
    "event_trace_id": "trace_id",
    "event_decision": "decision",
}


def read_required(body, paths, name):
    try:
        return field(body, paths[name])
    except (KeyError, TypeError, ValueError, IndexError):
        raise AssertionError(f"Missing required {name} at {paths[name]}") from None


def assert_action(response, expected, paths):
    if not 200 <= response.status < 300:
        raise AssertionError(f"Expected decision envelope, got HTTP {response.status}")
    actual = read_required(response.body, paths, "decision")
    if actual != expected:
        raise AssertionError(f"Expected {expected}, got {actual!r}")
    executed = read_required(response.body, paths, "executed")
    if executed is not (expected == "allow"):
        raise AssertionError(f"Decision {expected} requires executed={expected == 'allow'}, got {executed!r}")
    if expected == "allow" and read_required(response.body, paths, "output") is None:
        raise AssertionError("Allowed action has no connector output")
    for name in ("trace_id",):
        value = read_required(response.body, paths, name)
        if not isinstance(value, str) or not value.strip():
            raise AssertionError(f"Action has no nonempty {name}")


def assert_audit(response, action, expected, paths):
    if response.status != 200:
        raise AssertionError(f"Audit endpoint returned HTTP {response.status}")
    events = read_required(response.body, paths, "events")
    if not isinstance(events, list):
        raise AssertionError("Audit endpoint did not return an event list")
    trace_id = read_required(action, paths, "trace_id")
    matching = []
    for event in events:
        event_trace = read_required(event, paths, "event_trace_id")
        if not isinstance(event_trace, str) or not event_trace.strip():
            raise AssertionError("An audit event is missing its correlation ID")
        if event_trace == trace_id:
            matching.append(event)
    if not matching:
        raise AssertionError("No persisted audit event matches the trace_id")
    if not any(
        read_required(event, paths, "event_trace_id") == trace_id
        and read_required(event, paths, "event_decision") == expected
        for event in matching
    ):
        raise AssertionError("Persisted audit event does not match action correlation ID and decision")


def prerequisites(plan):
    missing = []

    def visit(value):
        if isinstance(value, dict):
            if set(value) == {"$env"} and not os.environ.get(value["$env"]):
                missing.append(value["$env"])
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(plan)
    return sorted(set(missing))


class LiveCase(unittest.TestCase):
    def __init__(self, case, config, client):
        super().__init__("runTest")
        self.case, self.config, self.client = case, config, client
        self.observations = []

    def id(self):
        return self.case.id

    def __str__(self):
        return f"{self.case.id} [{' '.join(self.case.asi)}]"

    def shortDescription(self):
        return self.case.title

    def setup_requests(self, requests, variables):
        for request in requests:
            if "oidc" in request:
                from identity import browser_token, claims

                spec = request["oidc"]
                key = (spec["username"], spec.get("acr", "1"))
                cached = self.client.credential_cache.get(key)
                if cached is None or claims(cached)["exp"] < time.time() + 60:
                    cached = browser_token(*key)
                    self.client.credential_cache[key] = cached
                response = Response(200, {"access_token": cached})
            elif "tamper_token" in request:
                token = resolve(request["tamper_token"], variables)
                header, payload, signature = token.split(".")
                signature = ("A" if signature[0] != "A" else "B") + signature[1:]
                response = Response(200, {"access_token": ".".join((header, payload, signature))})
            elif "wait_expired" in request:
                from identity import claims

                token = resolve(request["wait_expired"], variables)
                wait = max(0, claims(token)["exp"] + 1 - time.time())
                self.assertLessEqual(wait, 10, "Expiry fixture must have a short token lifespan")
                time.sleep(wait)
                continue
            elif "shell" in request:
                # The MCP admin descriptor route is in-network only, so a fixture reaches it through
                # the demo-runner container. Run from the repository root (the compose project dir).
                argv = resolve(request["shell"], variables)
                root = Path(__file__).resolve().parents[2]
                completed = subprocess.run(argv, cwd=str(root), capture_output=True, text=True, timeout=self.config.get("shell_timeout_seconds", 60))
                self.assertEqual(completed.returncode, 0, f"Fixture shell step failed: {(completed.stderr or completed.stdout).strip()[:300]}")
                continue
            else:
                response = self.client.request(request, variables)
            self.assertTrue(200 <= response.status < 300, f"Fixture setup returned HTTP {response.status}")
            if "find" in request:
                spec = request["find"]
                expected = resolve(spec["where"], variables)
                matches = [item for item in field(response.body, spec.get("items", "items")) if all(field(item, path) == value for path, value in expected.items())]
                self.assertEqual(len(matches), 1, "Fixture lookup must identify exactly one matching object")
                response.body = matches[0]
            for variable, path in request.get("save", {}).items():
                try:
                    variables[variable] = field(response.body, path)
                except (KeyError, TypeError, ValueError, IndexError):
                    self.fail(f"Fixture setup lacks saved field {path}")
            for path, expected in request.get("check", {}).items():
                self.assertEqual(field(response.body, path), resolve(expected, variables), f"Setup precondition at {path}")

    def run_route_matrix(self, variables):
        from route_matrix import negative_routes, request_body

        tokens = {"A": variables["agent_token"], "H": variables["browser_token"], "R": variables["viewer_token"], "employee": variables["browser_token"]}
        for method, route, principal, status in negative_routes():
            with self.subTest(method=method, route=route, principal=principal):
                path = route.replace("{id}", "ffffffff-ffff-4fff-8fff-ffffffffffff").replace("{trace_id}", "f" * 32)
                headers = {"Cookie": "betsee_session=" + variables["viewer_token"]} if principal == "cookie" else {"Authorization": "Bearer " + tokens[principal]}
                request = {"method": method, "path": path, "headers": headers}
                if method == "POST":
                    request["json"] = request_body(route)
                response = self.client.request(request, variables)
                self.assertEqual(response.status, status, "Route accepted forbidden principal or returned the wrong refusal status")

    def runTest(self):
        plan = self.config.get("cases", {}).get(self.case.id)
        if plan is None:
            self.skipTest(f"PENDING: {self.case.pending}")
        if plan.get("pending"):
            self.skipTest(f"PENDING: {plan['pending']}")
        missing = prerequisites([plan, self.config.get("setup", [])])
        if missing:
            self.skipTest(f"PENDING: missing environment variables {', '.join(missing)}")
        steps = plan.get("steps", [])
        self.assertEqual(len(steps), len(self.case.outcomes), "Fixture must exercise every catalog outcome")
        paths = DEFAULT_FIELDS | self.config.get("fields", {})
        variables = dict(self.config.get("variables", {}))
        self.setup_requests(self.config.get("setup", []), variables)
        try:
            self.setup_requests(plan.get("setup", []), variables)
            if self.case.id == "route_principal_matrix":
                self.run_route_matrix(variables)
                return
            for index, (step, expected) in enumerate(zip(steps, self.case.outcomes)):
                self.setup_requests(step.get("before", []), variables)
                response = self.client.request(step["request"], variables)
                if expected in ("unauthorized", "reject"):
                    permitted = (401,) if expected == "unauthorized" else (403,)
                    self.assertIn(response.status, permitted, f"Expected authentication/authorization rejection at step {index + 1}, got HTTP {response.status}")
                    self.assertTrue(read_required(response.body, paths, "trace_id"), "Rejection must carry its correlation ID")
                    continue
                for variable, path in step.get("save", {}).items():
                    variables[variable] = field(response.body, path)
                self.assertTrue(200 <= response.status < 300, f"Expected action decision at step {index + 1}, got HTTP {response.status}")
                action = field(response.body, step.get("action_path", ""))
                variables["trace_id"] = read_required(action, paths, "trace_id")
                if "trace" in step:
                    detail = self.client.request(step["trace"], variables)
                    self.assertEqual(detail.status, 200, "A2A decision requires its execution trace")
                    self.assertEqual(read_required(detail.body, paths, "trace_id"), variables["trace_id"])
                    self.assertEqual(read_required(detail.body, paths, "decision"), read_required(action, paths, "decision"))
                    action = detail.body
                decision_expected = expected
                if expected == "step_up_required":
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.body["status"], "step_up_required")
                    self.assertEqual(response.body["acr_values"], "2")
                    decision_expected = "require_approval"
                self.observations.append({"trace_id": variables["trace_id"], "decision": read_required(action, paths, "decision"), "executed": read_required(action, paths, "executed"), "control_ids": read_required(action, paths, "controls")})
                print(f"TRACE {self.case.id} step={index + 1} decision={self.observations[-1]['decision']} trace_id={variables['trace_id']} executed={self.observations[-1]['executed']}", flush=True)
                assert_action(Response(response.status, action), decision_expected, paths)
                if self.case.id in ("foreign_session", "forged_session"):
                    for name in ("human", "use_case", "session_id"):
                        self.assertNotIn(name, action, f"Identity denial must not disclose resolved {name}")
                if self.case.id == "trace_id_reused" and index == 1:
                    original_id = variables["original_trace_id"]
                    self.assertNotEqual(variables["trace_id"], original_id, "Reused caller trace must receive a fresh server trace_id")
                    self.assertEqual(action["caller_trace_id"], original_id)
                    original = self.client.request(plan["original_trace"], variables)
                    self.assertEqual(original.status, 200)
                    self.assertEqual(original.body, variables["original_trace_snapshot"], "Caller trace reuse overwrote the original evidence")
                    events = self.client.request(plan["security_events"], variables)
                    self.assertEqual(events.status, 200)
                    self.assertTrue(any(event.get("type") == "trace_id_reused" and event.get("trace_id") == variables["trace_id"] and event.get("attributes", {}).get("caller_trace_id") == original_id for event in events.body["items"]), "Trace reuse must emit a correlated security event")
                if expected != "allow" and self.case.controls:
                    controls = read_required(action, paths, "controls")
                    self.assertTrue(set(self.case.controls) & set(controls), "Expected security control did not decide the blocked action")
                if self.case.id == "analyzer_cannot_loosen":
                    self.assertEqual(read_required(action, paths, "deterministic_decision"), "deny")
                    self.assertEqual(read_required(action, paths, "analysis_verdict"), "skipped", "Architect requires analyzer skip on deterministic deny; pure tests cover clean-verdict relaxation")
                if self.case.id == "analyzer_tightens":
                    self.assertEqual(read_required(action, paths, "deterministic_decision"), "allow")
                    self.assertEqual(read_required(action, paths, "analysis_verdict"), "suspicious")
                if self.case.id in ("analyzer_cannot_loosen", "analyzer_tightens"):
                    self.assertEqual(read_required(action, paths, "analysis_label"), "mock model (demo)")
                audit = step.get("audit", plan.get("audit"))
                self.assertIsNotNone(audit, "Action checks require a persisted audit lookup")
                deadline = time.monotonic() + self.config.get("audit_wait_seconds", 3)
                while True:
                    audit_response = self.client.request(audit, variables)
                    try:
                        assert_audit(audit_response, action, decision_expected, paths)
                        break
                    except AssertionError:
                        if time.monotonic() >= deadline:
                            raise
                        time.sleep(0.1)
                self.setup_requests(step.get("after", []), variables)
        finally:
            self.setup_requests(plan.get("cleanup", []), variables)


def validate_config(config, cases):
    if config.get("version") != 1:
        raise ValueError("Fixture config must declare version 1")
    unknown = set(config.get("cases", {})) - {case.id for case in cases}
    if unknown:
        raise ValueError(f"Unknown case ids: {', '.join(sorted(unknown))}")
    for name in config.get("fields", {}):
        if name not in DEFAULT_FIELDS:
            raise ValueError(f"Unknown response field mapping: {name}")
    for case in cases:
        if not re.fullmatch(r"[a-z0-9_]+", case.id):
            raise ValueError("Catalog case id must be stable and printable")
