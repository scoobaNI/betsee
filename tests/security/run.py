import argparse
import json
import os
import sys
import unittest
from pathlib import Path

from catalog import CASES
from harness import HttpClient, LiveCase, validate_config


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
    checks = [LiveCase(case, config, client) for case in cases]
    suite = unittest.TestSuite(checks)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    failed = {getattr(test, "test_case", test).id() for test, _ in result.failures + result.errors}
    pending = {test.id(): reason for test, reason in result.skipped}
    passed = result.testsRun - len(failed) - len(pending)
    print(f"Live stack: {passed} passed, {len(failed)} failed, {len(pending)} pending; {len(cases)} selected of {len(CASES)} catalog cases.")
    if pending:
        print("PENDING is incomplete coverage; no pending check counts as a live pass.")
    if args.report:
        args.report.write_text(json.dumps({
            "mode": "live", "api": args.api, "selected": len(cases), "catalog_total": len(CASES),
            "passed": passed, "failed": len(failed), "pending": len(pending),
            "cases": [{"id": check.case.id, "asi": list(check.case.asi), "status": "failed" if check.case.id in failed else "pending" if check.case.id in pending else "passed", "reason": pending.get(check.case.id), "observations": check.observations} for check in checks],
        }, indent=2) + "\n")
    if not result.wasSuccessful():
        return 1
    return 3 if pending and not args.allow_pending else 0


if __name__ == "__main__":
    raise SystemExit(main())
