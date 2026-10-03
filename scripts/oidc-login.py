#!/usr/bin/env python3
import argparse
import base64
import hashlib
from html.parser import HTMLParser
from http.cookiejar import CookieJar, DefaultCookiePolicy
import json
import os
import secrets
import time
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener

from otp import totp
from demo_env import load_demo_env


class Callback(Exception):
    def __init__(self, url):
        self.url = url


class LocalhostCookiePolicy(DefaultCookiePolicy):
    def return_ok_secure(self, cookie, request):
        # Browsers treat *.localhost as a secure context; urllib does not.
        if urlparse(request.full_url).hostname == "auth.betsee.localhost":
            return True
        return super().return_ok_secure(cookie, request)


class Redirects(HTTPRedirectHandler):
    def __init__(self, callback):
        self.callback = callback

    def redirect_request(self, request, response, code, message, headers, new_url):
        if new_url.startswith(self.callback):
            raise Callback(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


class LoginForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.action = None
        self.fields = {}
        self.names = set()
        self.in_form = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form" and attrs.get("method", "").lower() == "post":
            self.action = attrs.get("action")
            self.in_form = True
        if self.in_form and tag == "input" and attrs.get("name"):
            self.names.add(attrs["name"])
            if attrs.get("type") == "hidden":
                self.fields[attrs["name"]] = attrs.get("value", "")

    def handle_endtag(self, tag):
        if tag == "form":
            self.in_form = False


def decode_claims(token):
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def login(username, password, acr="1", otp_secret=None, client="betsee-ecosystem", opener=None):
    issuer = os.getenv("OIDC_ISSUER", "http://auth.betsee.localhost/realms/betsee")
    host = "director.betsee.localhost" if client == "betsee-director" else "betsee.localhost"
    callback = "http://" + host + "/oidc-callback"
    opener = opener or build_opener(HTTPCookieProcessor(CookieJar(policy=LocalhostCookiePolicy())), Redirects(callback))
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    params = {"client_id": client, "redirect_uri": callback, "response_type": "code",
              "scope": "openid profile email", "code_challenge": challenge,
              "code_challenge_method": "S256", "state": state, "nonce": nonce,
              "acr_values": acr, "prompt": "login", "max_age": "0"}
    url = issuer + "/protocol/openid-connect/auth?" + urlencode(params)
    request = Request(url)
    otp_prompted = False
    for _ in range(6):
        try:
            with opener.open(request, timeout=15) as response:
                html = response.read().decode()
        except Callback as result:
            query = parse_qs(urlparse(result.url).query)
            if query.get("state") != [state] or "code" not in query:
                raise RuntimeError("OIDC callback state mismatch or authorization error")
            code = query["code"][0]
            break
        form = LoginForm()
        form.feed(html)
        if not form.action:
            raise RuntimeError("Expected Keycloak login form; received an error page")
        fields = form.fields
        if "username" in form.names:
            fields.update(username=username, password=password)
        elif "password" in form.names:
            fields["password"] = password
        elif "otp" in form.names:
            if not otp_secret:
                raise RuntimeError("OTP required; supply --otp-secret or BETSEE_TOTP_SECRET")
            otp_prompted = True
            fields["otp"] = totp(otp_secret, int(time.time()))
        else:
            raise RuntimeError("Unexpected authentication form")
        request = Request(form.action, data=urlencode(fields).encode())
    else:
        raise RuntimeError("Authentication did not complete within six form submissions")
    form = {"grant_type": "authorization_code", "client_id": client, "code": code,
            "redirect_uri": callback, "code_verifier": verifier}
    with opener.open(Request(issuer + "/protocol/openid-connect/token",
                             data=urlencode(form).encode()), timeout=15) as response:
        tokens = json.load(response)
    claims = decode_claims(tokens["access_token"])
    identity = decode_claims(tokens["id_token"])
    if identity.get("nonce") != nonce:
        raise RuntimeError("ID token nonce mismatch")
    if claims.get("acr") != acr or claims.get("iss") != issuer:
        raise RuntimeError("Unexpected issuer or authentication level")
    if acr == "2" and not otp_prompted:
        raise RuntimeError("Step-up did not require a fresh OTP")
    return tokens, claims, opener


if __name__ == "__main__":
    load_demo_env()
    parser = argparse.ArgumentParser(description="Demo/test helper using real browser authorization-code PKCE and OTP forms")
    parser.add_argument("--username", choices=["maya", "daniel", "priya"], default="daniel")
    parser.add_argument("--password-env", default="BETSEE_USER_PASSWORD")
    parser.add_argument("--acr", choices=["1", "2"], default="1")
    parser.add_argument("--client", choices=["betsee-ecosystem", "betsee-director"], default="betsee-ecosystem")
    parser.add_argument("--otp-secret", default=os.environ["BETSEE_TOTP_SECRET"])
    parser.add_argument("--token", action="store_true", help="Print the access token for a test caller")
    args = parser.parse_args()
    tokens, claims, _ = login(args.username, os.getenv(args.password_env, os.environ["DEMO_PASSWORD_" + args.username.upper()]),
                             args.acr, args.otp_secret, args.client)
    print(tokens["access_token"] if args.token else json.dumps(claims, indent=2))
