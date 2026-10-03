import argparse
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from catalog import CASES
from harness import HttpClient, LiveCase, validate_config


def cast_state(client):
    """(quarantined agent ids, payments-descriptor-blocked) on the live stack, or (None, None)."""
    from identity import token_request

    try:
        token = client.request(token_request("betsee-demo-runner", "priya"), {}).body["access_token"]
        auth = {"Authorization": f"Bearer {token}"}
        agents = client.request({"path": "/api/v1/agents", "headers": auth}, {}).body
        items = agents.get("items", agents) if isinstance(agents, dict) else agents
        quarantined = {a.get("id") for a in items if a.get("state") != "active"}
        connectors = client.request({"path": "/api/v1/connectors", "headers": auth}, {}).body
        blocked = any(t.get("name") == "payments" and t.get("status") == "blocked" for c in connectors.get("items", []) for t in c.get("tools", []))
        return quarantined, blocked
    except (AssertionError, KeyError, TypeError, AttributeError):
        return None, None


def set_payments_descriptor(mode):
    """Drift or restore the payments MCP descriptor through the in-network demo-runner container."""
    argv = ["docker", "compose", "--project-name", "betsee", "exec", "-T", "demo-runner", "python", "-c",
            f"import sys; from runner.core import http, MCP_ADMIN_URL, env; s, _ = http('POST', MCP_ADMIN_URL + '/tools/payments/{mode}', env('MCP_ADMIN_TOKEN'), {{}}); sys.exit(0 if 200 <= s < 300 else 1)"]
    return subprocess.run(argv, cwd=str(Path(__file__).resolve().parents[2]), capture_output=True, text=True, timeout=60).returncode == 0


def pending_approval_ids(client):
    """Ids of every pending approval on the live stack, or None if they cannot be read."""
    from identity import token_request

    try:
        token = client.request(token_request("betsee-demo-runner", "priya"), {}).body["access_token"]
        response = client.request({"path": "/api/v1/approvals", "headers": {"Authorization": f"Bearer {token}"}}, {})
        items = response.body.get("items", []) if isinstance(response.body, dict) else []
        return {approval.get("id") for approval in items if approval.get("state") == "pending"}
    except (AssertionError, KeyError, TypeError, AttributeError):
        return None


def main():
    parser = argparse.ArgumentParser(description="Betsee real-stack security checks; pending checks fail the default run.")
    parser.add_argument("--fixtures", type=Path, default=Path(os.environ.get("BETSEE_SECURITY_FIXTURES", Path(__file__).with_name("fixtures.local.json"))), help="Optional request fixture overrides; defaults to the seeded Acme live plans")
    parser.add_argument("--api", default=os.environ.get("BETSEE_API_URL", "http://api.betsee.localhost"))
    parser.add_argument("--auth", default=os.environ.get("BETSEE_AUTH_URL", "http://auth.betsee.localhost"))
    parser.add_argument("--case", action="append", default=[], help="Run a named case; repeat to select several")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--allow-pending", action="store_true", help="Development only: permit pending cases; failures still fail")
    parser.add_argument("--self-test", action="store_true", help="Test harness assertions locally; does not verify Betsee")
    parser.add_argument("--identity", action="store_true", help="Verify live Keycloak grants and claims independently of Gateway readiness")
    parser.add_argument("--report", type=Path, help="Write result counts and case status as JSON without credentials")
    args = parser.parse_args()
    if args.identity:
        from identity import run_identity

        return run_identity()
    if args.self_test:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover(str(Path(__file__).parent), pattern="test_harness.py"))
        return 0 if result.wasSuccessful() else 1
    unknown = set(args.case) - {case.id for case in CASES}
    if unknown:
        parser.error(f"Unknown case ids: {', '.join(sorted(unknown))}")
    cases = [case for case in CASES if not args.case or case.id in args.case]
    if args.list:
        for case in cases:
            print(f"{case.id:28} {' '.join(case.asi):18} {case.title}")
        return 0
    try:
        if args.fixtures.exists():
            config = json.loads(args.fixtures.read_text())
        else:
            from live_fixtures import build

            config = build()
        validate_config(config, CASES)
    except (OSError, ValueError, TypeError) as error:
        print(f"Invalid fixture configuration: {error}", file=sys.stderr)
        return 2
    client = HttpClient({"api": args.api, "auth": args.auth}, timeout=config.get("http_timeout_seconds", 8))
    full_run = not args.case
    # Snapshot the cast lifecycle the suite must leave untouched: agents quarantined by the demo (not
    # by the suite) stay quarantined, and the payments descriptor keeps its drift state. Cases whose
    # principal is already quarantined report pending instead of releasing it (D23/FAIL-6).
    demo_quarantined, payments_drifted = (None, None)
    if full_run:
        demo_quarantined, payments_drifted = cast_state(client)
    config["demo_quarantined"] = sorted(demo_quarantined) if demo_quarantined else []
    checks = [LiveCase(case, config, client) for case in cases]
    suite = unittest.TestSuite(checks)
    baseline_pending = pending_approval_ids(client) if full_run else None
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    cast_stable = True
    if full_run and demo_quarantined is not None:
        if payments_drifted:
            set_payments_descriptor("drift")  # restore the act-6 drift the payment cases had to undo
        end_quarantined, end_payments = cast_state(client)
        if end_quarantined is not None:
            cast_stable = end_quarantined == demo_quarantined and end_payments == payments_drifted
            print(f"Cast state: quarantined before={sorted(demo_quarantined)} after={sorted(end_quarantined)}; payments drifted before={payments_drifted} after={end_payments}; stable={cast_stable}")
            if not cast_stable:
                print("FAIL: the suite changed cast-agent lifecycle or the payments descriptor", file=sys.stderr)
    pending_stable = True
    if full_run and baseline_pending is not None:
        after_pending = pending_approval_ids(client)
        if after_pending is not None:
            pending_stable = baseline_pending == after_pending
            print(f"Pending approvals: before={len(baseline_pending)} after={len(after_pending)} stable={pending_stable}")
            if not pending_stable:
                added = sorted(after_pending - baseline_pending)
                removed = sorted(baseline_pending - after_pending)
                print(f"FAIL: the suite changed the shared pending-approval set (added {added}, removed {removed})", file=sys.stderr)
    failed = {getattr(test, "test_case", test).id() for test, _ in result.failures + result.errors}
    pending = {test.id(): reason for test, reason in result.skipped}
    passed = result.testsRun - len(failed) - len(pending)
    print(f"Live stack: {passed} passed, {len(failed)} failed, {len(pending)} pending; {len(cases)} selected of {len(CASES)} catalog cases.")
    if pending:
        print("PENDING is incomplete coverage; no pending check counts as a live pass.")
    if args.report:
        args.report.write_text(json.dumps({
            "mode": "live", "api": args.api, "selected": len(cases), "catalog_total": len(CASES),
            "passed": passed, "failed": len(failed), "pending": len(pending), "pending_approvals_stable": pending_stable, "cast_state_stable": cast_stable,
            "cases": [{"id": check.case.id, "asi": list(check.case.asi), "status": "failed" if check.case.id in failed else "pending" if check.case.id in pending else "passed", "reason": pending.get(check.case.id), "observations": check.observations} for check in checks],
        }, indent=2) + "\n")
    if not result.wasSuccessful() or not pending_stable or not cast_stable:
        return 1
    return 3 if pending and not args.allow_pending else 0


if __name__ == "__main__":
    raise SystemExit(main())
