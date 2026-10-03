"""Scenario execution against the real Gateway. Every step is a real HTTP call with real tokens."""

import base64
import datetime
import itertools
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

SCENARIO_DIR = os.environ.get(
    "SCENARIO_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scenarios")
)
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://gateway:8080").rstrip("/")
TOKEN_URL = os.environ.get(
    "KEYCLOAK_TOKEN_URL", "http://keycloak:8080/realms/betsee/protocol/openid-connect/token"
)
MCP_ADMIN_URL = os.environ.get("MCP_ADMIN_URL", "http://betsee-mcp:8081/admin").rstrip("/")
DEMO_RUNNER_CLIENT = "betsee-demo-runner"
# Decision D8: the presenter is Daniel (security-officer); Priya is org-admin.
PRESENTER_ROLES = {"security-officer", "org-admin"}
# Presenter tokens come from the browser apps. A betsee-demo-runner token (D7a) passes /api/v1/me
# but the Gateway refuses it on the admin writes reset needs, so the runner refuses it up front.
PRESENTER_CLIENTS = {"betsee-director", "betsee-ecosystem"}
# Read-only lookups (traces, agent state) use an org-admin demo token (decision D7a).
READER = "priya"
DEMO_AGENTS = ["invoice-assistant", "support-triage", "research-agent", "ops-runner", "report-bot"]
AWAIT_POLL_S = 2


class RunnerError(Exception):
    pass


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def env(name):
    value = os.environ.get(name)
    if not value:
        raise RunnerError(f"missing environment variable {name}")
    return value


def http(method, url, token=None, body=None, form=None, headers=None, timeout=15):
    """Returns (status, payload). HTTP error statuses are returned, not raised."""
    data = None
    h = {"accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        h["content-type"] = "application/json"
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        h["content-type"] = "application/x-www-form-urlencoded"
    if token:
        h["authorization"] = f"Bearer {token}"
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw) if raw else {}
        except ValueError:
            payload = {"error": raw.decode(errors="replace")[:300]}
        return e.code, payload
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        raise RunnerError(f"{method} {url}: {e}") from e


def new_trace_id():
    return secrets.token_hex(16)


def trace_headers(trace_id):
    # The Gateway adopts the trace-id of an incoming W3C traceparent as the ActionRequest's trace_id,
    # so the runner knows every step's trace_id before the response arrives.
    return {"traceparent": f"00-{trace_id}-{secrets.token_hex(8)}-01", "x-request-id": trace_id}


class Tokens:
    """Agent tokens via client credentials (decision D1); human tokens via betsee-demo-runner (D7)."""

    def __init__(self):
        self._cache = {}
        self._lock = threading.Lock()

    def _fetch(self, key, form):
        with self._lock:
            token, expires = self._cache.get(key, (None, 0.0))
            if token and time.time() < expires - 30:
                return token
        status, payload = http("POST", TOKEN_URL, form=form)
        if status != 200:
            raise RunnerError(f"token for {key}: HTTP {status} {payload.get('error', '')}")
        with self._lock:
            self._cache[key] = (payload["access_token"], time.time() + payload.get("expires_in", 60))
        return payload["access_token"]

    def agent(self, agent_id):
        secret = env("AGENT_CLIENT_SECRET_" + agent_id.upper().replace("-", "_"))
        form = {"grant_type": "client_credentials", "client_id": agent_id, "client_secret": secret}
        return self._fetch("agent:" + agent_id, form)

    def human(self, username):
        form = {
            "grant_type": "password",
            "client_id": DEMO_RUNNER_CLIENT,
            "client_secret": env("DEMO_RUNNER_CLIENT_SECRET"),
            "username": username,
            "password": env("DEMO_PASSWORD_" + username.upper()),
        }
        return self._fetch("human:" + username, form)


TOKENS = Tokens()


def load_scenarios():
    scenarios = {}
    for name in sorted(os.listdir(SCENARIO_DIR)):
        if name.endswith(".json"):
            with open(os.path.join(SCENARIO_DIR, name), encoding="utf-8") as f:
                s = json.load(f)
            scenarios[s["id"]] = s
    return scenarios


def expectation(step, n):
    """Expected {decision, controls, ...} for repetition n (1-based) of a step."""
    for seq in step.get("expect_sequence", []):
        if seq["from"] <= n <= seq["to"]:
            return seq
    return step.get("expect", {})


def scenario_summary(s):
    steps = []
    for step in s["steps"]:
        session = s["sessions"].get(step.get("session", ""), {})
        exp = expectation(step, 1)
        steps.append(
            {
                "step_id": step["step_id"],
                "kind": step["kind"],
                "agent": session.get("agent"),
                "human": session.get("human"),
                "capability": step.get("capability")
                or ("agent.message" if step["kind"] == "agent_message" else None),
                "resource": step.get("resource") or step.get("resource_pattern"),
                "repeat": step.get("repeat", 1),
                "expected_decision": exp.get("decision"),
                "narration": step.get("narration", ""),
            }
        )
    return {
        "id": s["id"],
        "act": s["act"],
        "title": s["title"],
        "asi": s["asi"],
        "summary": s.get("summary", ""),
        "steps": steps,
    }


class Run:
    def __init__(self, scenario):
        self.id = "run-" + secrets.token_hex(6)
        self.scenario_id = scenario["id"]
        self.status = "running"
        self.error = None
        self.started_at = now_iso()
        self.finished_at = None
        self.steps = []
        self.sessions = {}

    def view(self):
        return {
            "run_id": self.id,
            "scenario_id": self.scenario_id,
            "status": self.status,
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "steps": list(self.steps),
        }


RUNS = {}
CREATED_SESSIONS = set()
_STATE_LOCK = threading.Lock()


def check(expect, payload):
    """Compares a Gateway ActionSummary with the step's expectation. Returns a list of mismatches."""
    problems = []
    if expect.get("decision") and payload.get("decision") != expect["decision"]:
        problems.append(f"decision {payload.get('decision')} != {expect['decision']}")
    for key, field in (("controls", "control_ids"), ("policies", "policy_ids")):
        missing = set(expect.get(key, [])) - set(payload.get(field) or [])
        if missing:
            problems.append(f"{field} missing {sorted(missing)}")
    for key in ("deterministic_decision", "ai_tightened", "executed"):
        if key in expect and key in payload and payload[key] != expect[key]:
            problems.append(f"{key} {payload[key]} != {expect[key]}")
    return problems


def create_sessions(run, scenario):
    for alias, spec in scenario["sessions"].items():
        trace_id = new_trace_id()
        body = {
            "agent_id": spec["agent"],
            "use_case_id": spec["use_case"],
            "delegated": spec["delegated"],
            "tier_ceiling": spec["tier_ceiling"],
            "budget_cents": spec["budget_cents"],
        }
        status, payload = http(
            "POST", f"{GATEWAY_URL}/api/v1/sessions", TOKENS.human(spec["human"]), body,
            headers=trace_headers(trace_id),
        )
        if status != 201:
            raise RunnerError(f"session {alias} for {spec['agent']}: HTTP {status} {payload}")
        run.sessions[alias] = {"id": payload["id"], "agent": spec["agent"], "human": spec["human"]}
        with _STATE_LOCK:
            CREATED_SESSIONS.add(payload["id"])


def send(step, session, n):
    trace_id = new_trace_id()
    token = TOKENS.agent(session["agent"])
    if step["kind"] == "agent_message":
        url = f"{GATEWAY_URL}/api/v1/agent-messages"
        body = {
            "session_id": session["id"],
            "receiver_id": step["receiver"],
            "requested_capability": step["requested_capability"],
            "content": step["content"],
        }
        capability = "agent.message"
    else:
        url = f"{GATEWAY_URL}/api/v1/actions"
        resource = step.get("resource")
        if resource is None:
            pattern = step["resource_pattern"]
            resource = {
                "type": pattern["type"],
                "id": pattern["id"].format(n=pattern["n_from"] + n - 1),
                "tier": pattern["tier"],
            }
        body = {
            "session_id": session["id"],
            "capability": step["capability"],
            "resource": resource,
            "parameters": step.get("parameters", {}),
        }
        capability = step["capability"]
    status, payload = http("POST", url, token, body, headers=trace_headers(trace_id))
    payload = payload or {}
    record = {
        "step_id": step["step_id"],
        "n": n,
        "agent": session["agent"],
        "capability": capability,
        "trace_id": payload.get("trace_id", trace_id),
        "http_status": status,
        "actual_decision": payload.get("decision"),
        "control_ids": payload.get("control_ids", []),
        "policy_ids": payload.get("policy_ids", []),
        "executed": payload.get("executed"),
        "ai_tightened": payload.get("ai_tightened"),
    }
    if status != 200:
        record["error"] = payload.get("error") or payload.get("message") or f"HTTP {status}"
    return record, payload


def agent_state(agent_id):
    status, payload = http("GET", f"{GATEWAY_URL}/api/v1/agents", TOKENS.human(READER))
    if status != 200:
        return None
    items = payload.get("items", payload) if isinstance(payload, dict) else payload
    for agent in items or []:
        if agent.get("id") == agent_id:
            return agent.get("state")
    return None


def find_step(run, step_id):
    """The latest record of step_id: this run first, then earlier runs (act 5 waits on act 3)."""
    for record in reversed(run.steps):
        if record["step_id"] == step_id and record.get("trace_id"):
            return record
    with _STATE_LOCK:
        runs = sorted(RUNS.values(), key=lambda r: r.started_at, reverse=True)
    for other in runs:
        for record in reversed(other.steps):
            if record["step_id"] == step_id and record.get("trace_id"):
                return record
    return None


def latest_approval_trace(match):
    """Trace id of the newest approval, in any state, for an agent and capability, asked of the Gateway.

    Any state, because the presenter may already have decided it (act 5 rejects act 3's memory write
    as soon as the payment is approved). Lets a step wait on an act played by another runner process.
    """
    status, payload = http("GET", f"{GATEWAY_URL}/api/v1/approvals", TOKENS.human(READER))
    if status != 200 or not isinstance(payload, dict):
        return None
    matching = [
        a for a in payload.get("items", [])
        if (a.get("action") or {}).get("agent", {}).get("id") == match["agent"]
        and (a.get("action") or {}).get("capability") == match["capability"]
    ]
    matching.sort(key=lambda a: a.get("created_at", ""), reverse=True)
    return matching[0]["trace_id"] if matching else None


def approval_for(trace_id):
    status, payload = http("GET", f"{GATEWAY_URL}/api/v1/approvals", TOKENS.human(READER))
    if status != 200 or not isinstance(payload, dict):
        return {}
    return next((a for a in payload.get("items", []) if a.get("trace_id") == trace_id), {})


def parse_ts(value):
    """RFC 3339 timestamp to aware datetime; the Gateway emits nanoseconds, Python parses microseconds."""
    if not value:
        return None
    head, _, tail = value.partition(".")
    if tail:
        digits = "".join(itertools.takewhile(str.isdigit, tail))
        zone = tail[len(digits):]
        value = f"{head}.{digits[:6]}{zone}"
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def await_human(step, run):
    record = {"step_id": step["step_id"], "n": 1, "kind": "await_human"}
    target = find_step(run, step["waits_for"])
    trace_id = target["trace_id"] if target else None
    if trace_id is None and "waits_for_match" in step:
        trace_id = latest_approval_trace(step["waits_for_match"])
    if trace_id is None:
        record.update(ok=False, trace_id=None, error=f"no approval found for {step['waits_for']}")
        return record
    expect = step.get("expect", {})
    want = expect.get("approval_state", "approved")
    record.update(trace_id=trace_id, expected_decision=f"human: {want}")
    deadline = time.time() + step.get("timeout_s", 300)
    trace = {}
    while time.time() < deadline:
        status, trace = http("GET", f"{GATEWAY_URL}/api/v1/traces/{trace_id}", TOKENS.human(READER))
        trace = trace or {}
        state = trace.get("approval_state")
        if status == 200 and (state == "rejected" or (state == "approved" and trace.get("executed"))):
            break
        time.sleep(AWAIT_POLL_S)
    approval = approval_for(trace_id)
    approver = approval.get("approver") or {}
    decided_at = parse_ts(approval.get("decided_at"))
    acr = next(
        (str(s.get("attributes", {}).get("acr")) for s in trace.get("spans", []) if s.get("stage") == "step_up"),
        None,
    )
    record.update(
        approval_state=trace.get("approval_state"),
        executed=trace.get("executed"),
        approver_sub=approver.get("sub"),
        acr=acr,
        actual_decision=f"human: {trace.get('approval_state')}",
    )
    problems = []
    if trace.get("approval_state") != want:
        problems.append(f"approval_state {trace.get('approval_state')} != {want}")
    if "executed" in expect and bool(trace.get("executed")) != expect["executed"]:
        problems.append(f"executed {trace.get('executed')} != {expect['executed']}")
    # A voided approval (session ended by reset) also reads 'rejected'; only a named approver proves
    # that the human decided.
    if "approver_sub" in expect and approver.get("sub") != expect["approver_sub"]:
        problems.append(f"approver {approver.get('sub')} != {expect['approver_sub']}")
    # An approval decided before this run began belongs to an earlier rehearsal.
    started = parse_ts(run.started_at)
    if want in ("approved", "rejected") and decided_at and started and decided_at < started:
        problems.append(f"decided at {approval.get('decided_at')}, before this run started")
    if "acr" in expect and acr != expect["acr"]:
        problems.append(f"acr {acr} != {expect['acr']}")
    record["ok"] = not problems
    if problems:
        record["error"] = "; ".join(problems) + (" (timed out)" if time.time() >= deadline else "")
    return record


def tool_drift(step):
    status, payload = http(
        "POST", f"{MCP_ADMIN_URL}/tools/{step['tool']}/drift", env("MCP_ADMIN_TOKEN"), {}
    )
    ok = 200 <= status < 300
    return {
        "step_id": step["step_id"],
        "n": 1,
        "kind": "tool_drift",
        "trace_id": None,
        "expected_decision": None,
        "actual_decision": None,
        "ok": ok,
        **({} if ok else {"error": f"MCP admin drift: HTTP {status} {payload}"}),
    }


def execute(run, scenario, log=print):
    try:
        create_sessions(run, scenario)
        for step in scenario["steps"]:
            kind = step["kind"]
            if kind in ("action", "agent_message"):
                session = run.sessions[step["session"]]
                for n in range(1, step.get("repeat", 1) + 1):
                    record, payload = send(step, session, n)
                    expect = expectation(step, n)
                    problems = check(expect, payload) if record["http_status"] == 200 else [record["error"]]
                    record.update(
                        expected_decision=expect.get("decision"), ok=not problems,
                        **({"error": "; ".join(problems)} if problems else {}),
                    )
                    run.steps.append(record)
                    log_step(log, record)
                    time.sleep(step.get("pace_ms", 1000) / 1000)
                if "expect_after" in step:
                    want = step["expect_after"]
                    state = agent_state(want["agent"])
                    record = {
                        "step_id": step["step_id"] + ".after", "n": 1, "kind": "agent_state",
                        "agent": want["agent"], "state": state, "ok": state == want["state"],
                        "trace_id": None, "expected_decision": None, "actual_decision": None,
                    }
                    run.steps.append(record)
                    log_step(log, record)
            elif kind == "await_human":
                log(f"{step['step_id']}: waiting up to {step.get('timeout_s', 300)} s for the approver")
                record = await_human(step, run)
                run.steps.append(record)
                log_step(log, record)
            elif kind == "tool_drift":
                record = tool_drift(step)
                run.steps.append(record)
                log_step(log, record)
                time.sleep(step.get("pace_ms", 1000) / 1000)
        run.status = "passed" if all(s.get("ok") for s in run.steps) else "failed"
    except RunnerError as e:
        run.status, run.error = "error", str(e)
        log(f"ERROR {e}")
    finally:
        run.finished_at = now_iso()


def log_step(log, r):
    verdict = "PASS" if r.get("ok") else "FAIL"
    extra = r.get("error") or ""
    log(
        f"{verdict} {r['step_id']}#{r.get('n', 1)} trace={r.get('trace_id')} "
        f"expected={r.get('expected_decision')} actual={r.get('actual_decision')} "
        f"controls={r.get('control_ids', [])} {extra}".rstrip()
    )


def start_run(scenario):
    run = Run(scenario)
    with _STATE_LOCK:
        RUNS[run.id] = run
    threading.Thread(target=execute, args=(run, scenario), daemon=True).start()
    return run


def reset(caller_token):
    """Restores the demo without deleting evidence: audit rows, traces and events stay.

    Every demo agent is released, active or not: a release also starts a new breaker window, so
    denials from a previous rehearsal or test case cannot quarantine an agent in the next one.
    """
    results = []

    def step(action, target, status):
        results.append({"action": action, "id": target, "http_status": status, "ok": 200 <= status < 300})

    status, payload = http("GET", f"{GATEWAY_URL}/api/v1/sessions", caller_token)
    items = payload.get("items", []) if status == 200 and isinstance(payload, dict) else []
    with _STATE_LOCK:
        to_end = set(CREATED_SESSIONS)
    to_end |= {
        s["id"] for s in items if s.get("status") == "active" and s.get("agent_id") in DEMO_AGENTS
    }
    for sid in sorted(to_end):
        st, _ = http("POST", f"{GATEWAY_URL}/api/v1/sessions/{sid}/end", caller_token, {})
        step("end_session", sid, st)
    with _STATE_LOCK:
        CREATED_SESSIONS.difference_update(r["id"] for r in results if r["ok"])
    for agent_id in DEMO_AGENTS:
        st, _ = http("POST", f"{GATEWAY_URL}/api/v1/agents/{agent_id}/release", caller_token, {})
        step("release_agent", agent_id, st)
    st, _ = http("POST", f"{MCP_ADMIN_URL}/tools/payments/restore", env("MCP_ADMIN_TOKEN"), {})
    step("restore_descriptor", "payments", st)
    return {"reset_at": now_iso(), "ok": all(r["ok"] for r in results), "results": results}


def token_azp(token):
    """The azp claim of a token the Gateway has already validated through /api/v1/me."""
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("azp")
    except (IndexError, ValueError, AttributeError):
        return None


def caller_roles(token):
    """Validates the caller's token by asking the Gateway (one validator for the whole system)."""
    if not token:
        return None
    status, payload = http("GET", f"{GATEWAY_URL}/api/v1/me", token)
    if status != 200:
        return None
    return set(payload.get("roles", []))
