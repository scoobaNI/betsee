import copy
import unittest
from unittest.mock import patch

import harness
from catalog import CASES
from harness import DEFAULT_FIELDS, HttpClient, Response, assert_action, assert_audit, field, prerequisites, resolve, validate_config
from identity import seed_value
from route_matrix import negative_routes


def action(decision="allow", executed=True, output=None):
    return {
        "decision": decision,
        "deterministic_decision": decision,
        "executed": executed,
        "output": {"connector": "mcp", "result": "customer-1042"} if output is None else output,
        "trace_id": "test-trace-1",
        "control_ids": ["CTL-CAP-001"],
    }


class AssertionsTest(unittest.TestCase):
    def test_allowed_connector_with_audited_trace_passes(self):
        body = action()
        assert_action(Response(200, body), "allow", DEFAULT_FIELDS)
        assert_audit(Response(200, {"items": [body]}), body, "allow", DEFAULT_FIELDS)

    def test_allow_without_execution_fails(self):
        with self.assertRaisesRegex(AssertionError, "executed=True"):
            assert_action(Response(200, action(executed=False)), "allow", DEFAULT_FIELDS)

    def test_allow_without_output_fails(self):
        body = action()
        body["output"] = None
        with self.assertRaisesRegex(AssertionError, "connector output"):
            assert_action(Response(200, body), "allow", DEFAULT_FIELDS)

    def test_blocked_decisions_must_never_execute(self):
        for decision in ("deny", "require_approval", "require_step_up"):
            with self.subTest(decision=decision):
                with self.assertRaisesRegex(AssertionError, "executed=False"):
                    assert_action(Response(200, action(decision)), decision, DEFAULT_FIELDS)

    def test_integer_execution_flag_is_not_boolean_proof(self):
        with self.assertRaises(AssertionError):
            assert_action(Response(200, action(executed=1)), "allow", DEFAULT_FIELDS)

    def test_false_allow_on_negative_case_fails(self):
        with self.assertRaisesRegex(AssertionError, "Expected deny"):
            assert_action(Response(200, action()), "deny", DEFAULT_FIELDS)

    def test_server_error_is_never_a_security_deny(self):
        with self.assertRaisesRegex(AssertionError, "HTTP 500"):
            assert_action(Response(500, action("deny", False)), "deny", DEFAULT_FIELDS)

    def test_missing_or_empty_correlation_id_fails(self):
        for value in (None, "", "  ", 42):
            with self.subTest(value=value):
                body = action()
                body["trace_id"] = value
                with self.assertRaises(AssertionError):
                    assert_action(Response(200, body), "allow", DEFAULT_FIELDS)

    def test_foreign_audit_event_is_not_evidence(self):
        event = action()
        event["trace_id"] = "other-trace"
        with self.assertRaisesRegex(AssertionError, "No persisted audit event"):
            assert_audit(Response(200, {"items": [event]}), action(), "allow", DEFAULT_FIELDS)

    def test_audit_decision_must_match(self):
        with self.assertRaisesRegex(AssertionError, "does not match"):
            assert_audit(Response(200, {"items": [action("deny", False)]}), action(), "allow", DEFAULT_FIELDS)

    def test_all_returned_audit_events_require_correlation(self):
        event = action()
        event.pop("trace_id")
        with self.assertRaises(AssertionError):
            assert_audit(Response(200, {"items": [action(), event]}), action(), "allow", DEFAULT_FIELDS)

    def test_nested_approval_action_can_be_inspected(self):
        self.assertEqual(field({"action": action()}, "action.trace_id"), "test-trace-1")


class ConfigurationTest(unittest.TestCase):
    def test_catalog_covers_all_asi_categories(self):
        self.assertEqual({asi for case in CASES if case.id != "audit_correlation" for asi in case.asi}, {f"ASI{i:02}" for i in range(1, 11)})
        self.assertEqual(len(CASES), len({case.id for case in CASES}))

    def test_reference_retains_json_types(self):
        self.assertEqual(resolve({"budget": {"$ref": "budget"}}, {"budget": 50}), {"budget": 50})
        self.assertEqual(resolve({"$format": "Bearer {token}"}, {"token": "test-token"}), "Bearer test-token")

    def test_missing_secret_is_pending_and_never_printed(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(prerequisites({"secret": {"$env": "TEST_ONLY_SECRET"}}), ["TEST_ONLY_SECRET"])

    def test_keycloak_import_template_uses_configured_environment(self):
        with patch.dict("os.environ", {"TEST_ONLY_SECRET": "test-only-value"}):
            self.assertEqual(seed_value("${TEST_ONLY_SECRET}"), "test-only-value")

    def test_keycloak_import_literal_remains_literal(self):
        self.assertEqual(seed_value("test-only-literal"), "test-only-literal")

    def test_route_matrix_expands_combined_routes_and_role_refusals(self):
        checks = negative_routes()
        self.assertIn(("GET", "/api/v1/controls", "A", 403), checks)
        self.assertIn(("GET", "/api/v1/security-events", "employee", 403), checks)
        self.assertIn(("GET", "/api/v1/events/stream", "cookie", 401), checks)
        self.assertIn(("POST", "/api/v1/actions", "H", 403), checks)
        self.assertIn(("POST", "/api/v1/approvals/{id}/approve", "R", 403), checks)

    def test_unknown_case_cannot_silently_drop_coverage(self):
        with self.assertRaisesRegex(ValueError, "Unknown case"):
            validate_config({"version": 1, "cases": {"typo": {}}}, CASES)

    def test_http_requests_cannot_escape_service_origin(self):
        client = HttpClient({"api": "http://api.betsee.localhost"})
        for path in ("http://example.invalid/steal", "//example.invalid/steal", "relative"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                client.request({"path": path}, {})

    def test_missing_fixture_is_pending_without_http(self):
        result = unittest.TestResult()
        harness.LiveCase(CASES[0], {"version": 1, "cases": {}}, None).run(result)
        self.assertEqual(len(result.skipped), 1)
        self.assertEqual(result.testsRun, 1)

    def test_fixture_cannot_remove_required_steps(self):
        result = unittest.TestResult()
        harness.LiveCase(CASES[0], {"version": 1, "cases": {CASES[0].id: {"steps": []}}}, None).run(result)
        self.assertEqual(len(result.failures), 1)
        self.assertEqual(result.skipped, [])

    def test_fixture_outcomes_do_not_replace_independent_catalog(self):
        config = {"version": 1, "cases": {CASES[0].id: {"steps": [{"request": {"path": "/api/v1/actions"}, "expected": "deny"}], "audit": {"path": "/api/v1/traces"}}}, "audit_wait_seconds": 0}

        class Client:
            def request(self, spec, variables):
                return Response(200, action("deny", False))

        result = unittest.TestResult()
        harness.LiveCase(CASES[0], copy.deepcopy(config), Client()).run(result)
        self.assertEqual(len(result.failures), 1)
        self.assertIn("Expected allow", result.failures[0][1])
