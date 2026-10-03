import base64
import json
import os
import re
import subprocess
import sys
import time
import unittest
from pathlib import Path

from harness import HttpClient


TOKEN_PATH = "/realms/betsee/protocol/openid-connect/token"
CAST = ("invoice-assistant", "support-triage", "research-agent", "ops-runner", "report-bot")


def realm_seed():
    return json.loads((Path(__file__).resolve().parents[2] / "infra/keycloak/betsee-realm.json").read_text())


def environment_value(name):
    if name in os.environ:
        return os.environ[name]
    root = Path(__file__).resolve().parents[2]
    values = {}
    for path in (root / ".env.example", root / ".env"):
        if path.exists():
            for line in path.read_text().splitlines():
                if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                values[key.strip().removeprefix("export ")] = value.strip().strip("\"'")
    if name not in values:
        raise ValueError(f"Missing configured identity environment variable {name}")
    return values[name]


def seed_value(value):
    match = re.fullmatch(r"\$\{([A-Z0-9_]+)\}", value)
    return environment_value(match[1]) if match else value


def client_secret(client_id):
    seed = realm_seed()
    return seed_value(next(client["secret"] for client in seed["clients"] if client["clientId"] == client_id))


def token_request(client_id, username=None):
    form = {"client_id": client_id, "client_secret": client_secret(client_id)}
    if username:
        user = next(user for user in realm_seed()["users"] if user["username"] == username)
        password = seed_value(next(credential["value"] for credential in user["credentials"] if credential["type"] == "password"))
        form |= {"grant_type": "password", "username": username, "password": password, "scope": "openid"}
    else:
        form["grant_type"] = "client_credentials"
    return {"base": "auth", "path": TOKEN_PATH, "method": "POST", "form": form}


def claims(token):
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def browser_token(username, acr="1"):
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run([sys.executable, str(root / "scripts/oidc-login.py"), "--username", username, "--acr", acr, "--token"], capture_output=True, text=True, timeout=50)
    if result.returncode:
        raise AssertionError(f"Real PKCE login helper failed for {username} at acr {acr}, exit {result.returncode}")
    token = result.stdout.strip()
    if len(token.split(".")) != 3:
        raise AssertionError("PKCE helper did not return an access token")
    body = claims(token)
    if body.get("acr") != acr or body.get("preferred_username") != username:
        raise AssertionError("PKCE helper returned the wrong human or authentication level")
    return token


class IdentityChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = HttpClient({"auth": os.environ.get("BETSEE_AUTH_URL", "http://auth.betsee.localhost")})

    def assert_issued(self, client_id, username=None):
        response = self.client.request(token_request(client_id, username), {})
        self.assertEqual(response.status, 200, f"Keycloak rejected expected {client_id} grant with HTTP {response.status}")
        body = claims(response.body["access_token"])
        self.assertEqual(body["iss"], self.client.bases["auth"].rstrip("/") + "/realms/betsee")
        aud = body.get("aud", [])
        self.assertIn("betsee-gateway", [aud] if isinstance(aud, str) else aud)
        self.assertEqual(body["azp"], client_id)
        self.assertTrue(body.get("sub"))
        self.assertGreater(body["exp"], time.time())
        if username:
            self.assertEqual(body["preferred_username"], username)
            self.assertIn("demo-initiator", body["realm_access"]["roles"])
            self.assertNotIn("agent_id", body)
        else:
            self.assertEqual(body["agent_id"], client_id)
            self.assertEqual(body["exp"] - body["iat"], 300)
        return body

    def test_discovery_and_signing_keys(self):
        response = self.client.request({"base": "auth", "path": "/realms/betsee/.well-known/openid-configuration"}, {})
        self.assertEqual(response.status, 200)
        expected = self.client.bases["auth"].rstrip("/") + "/realms/betsee"
        self.assertEqual(response.body["issuer"], expected)
        self.assertEqual(response.body["jwks_uri"], expected + "/protocol/openid-connect/certs")
        keys = self.client.request({"base": "auth", "path": "/realms/betsee/protocol/openid-connect/certs"}, {})
        self.assertEqual(keys.status, 200)
        self.assertTrue(any(key.get("use") == "sig" and key.get("kid") for key in keys.body["keys"]))

    def test_agent_clients_have_distinct_subjects(self):
        subjects = [self.assert_issued(agent)["sub"] for agent in CAST]
        self.assertEqual(len(set(subjects)), len(CAST))

    def test_maya_demo_runner(self):
        self.assert_issued("betsee-demo-runner", "maya")

    def test_priya_demo_runner(self):
        self.assert_issued("betsee-demo-runner", "priya")

    def test_daniel_cannot_use_demo_runner(self):
        response = self.client.request(token_request("betsee-demo-runner", "daniel"), {})
        self.assertEqual(response.status, 401)
        if response.body is not None:
            self.assertNotIn("access_token", response.body)

    def test_browser_clients_cannot_use_password_grant(self):
        for client_id in ("betsee-director", "betsee-ecosystem"):
            with self.subTest(client=client_id):
                response = self.client.request({"base": "auth", "path": TOKEN_PATH, "method": "POST", "form": {"grant_type": "password", "client_id": client_id, "username": "maya", "password": "maya-demo"}}, {})
                self.assertEqual(response.status, 400)
                self.assertEqual(response.body.get("error"), "unauthorized_client")
                self.assertNotIn("access_token", response.body)


def run_identity():
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(IdentityChecks))
    print("Identity checks inspect claims issued by the live Keycloak; Gateway signature validation is checked by the action suite.")
    return 0 if result.wasSuccessful() else 1
