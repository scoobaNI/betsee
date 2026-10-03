"""HTTP surface for the Director's scenario dock, routed by Caddy at /api/v1/demo/* (p-47)."""

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import core

RUNS_PATH = re.compile(r"^/api/v1/demo/scenarios/([a-z0-9-]+)/runs$")
RUN_PATH = re.compile(r"^/api/v1/demo/runs/(run-[0-9a-f]+)$")


class Handler(BaseHTTPRequestHandler):
    server_version = "betsee-demo-runner"

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        """Every demo endpoint needs a presenter token: security-officer or org-admin (D8)."""
        header = self.headers.get("authorization", "")
        token = header[7:] if header.lower().startswith("bearer ") else None
        try:
            roles = core.caller_roles(token)
        except core.RunnerError as e:
            self._send(503, {"error": "gateway_unreachable", "message": str(e)})
            return None
        if roles is None:
            self._send(401, {"error": "unauthenticated", "message": "a valid Betsee bearer token is required"})
            return None
        if core.token_azp(token) not in core.PRESENTER_CLIENTS:
            self._send(403, {"error": "forbidden", "message": "requires the presenter's browser token (D8)"})
            return None
        if not roles & core.PRESENTER_ROLES:
            self._send(403, {"error": "forbidden", "message": "requires security-officer or org-admin"})
            return None
        return token

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            return self._send(200, {"status": "ok"})
        if path == "/api/v1/demo/scenarios":
            if self._authorized() is None:
                return None
            scenarios = core.load_scenarios()
            return self._send(200, [core.scenario_summary(s) for s in scenarios.values()])
        m = RUN_PATH.match(path)
        if m:
            if self._authorized() is None:
                return None
            run = core.RUNS.get(m.group(1))
            if run is None:
                return self._send(404, {"error": "not_found", "message": "unknown run"})
            return self._send(200, run.view())
        return self._send(404, {"error": "not_found", "message": path})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        m = RUNS_PATH.match(path)
        if m:
            if self._authorized() is None:
                return None
            scenario = core.load_scenarios().get(m.group(1))
            if scenario is None:
                return self._send(404, {"error": "not_found", "message": "unknown scenario"})
            run = core.start_run(scenario)
            return self._send(202, {"run_id": run.id})
        if path == "/api/v1/demo/reset":
            token = self._authorized()
            if token is None:
                return None
            try:
                result = core.reset(token)
                return self._send(200 if result["ok"] else 502, result)
            except core.RunnerError as e:
                return self._send(502, {"error": "reset_failed", "message": str(e)})
        return self._send(404, {"error": "not_found", "message": path})

    def log_message(self, fmt, *args):
        # Request lines only; headers (bearer tokens) are never logged.
        print(f"{self.address_string()} {fmt % args}", flush=True)


def serve(port):
    print(f"demo-runner listening on :{port}, gateway {core.GATEWAY_URL}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
