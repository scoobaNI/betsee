#!/usr/bin/env python3
from concurrent.futures import ThreadPoolExecutor
import hashlib
import itertools
import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid


class McpClient:
    def __init__(self):
        self.base = os.getenv("MCP_URL", "http://mcp:8081/mcp")
        self.headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        self.ids = itertools.count(1)
        info = self.rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                                      "clientInfo": {"name": "betsee-infra-check", "version": "1"}})
        assert info["capabilities"]["tools"]["listChanged"] is True
        self.headers["MCP-Protocol-Version"] = info["protocolVersion"]
        self.rpc("notifications/initialized", {}, notification=True)

    def rpc(self, method, params, notification=False):
        message = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notification:
            message["id"] = next(self.ids)
        request = Request(self.base, data=json.dumps(message).encode(), headers=self.headers)
        with urlopen(request, timeout=15) as response:
            if response.headers.get("Mcp-Session-Id"):
                self.headers["Mcp-Session-Id"] = response.headers["Mcp-Session-Id"]
            text = response.read().decode()
        if notification:
            return None
        messages = [json.loads(line[5:].strip()) for line in text.splitlines()
                    if line.startswith("data:") and line[5:].strip()]
        payload = next((item for item in messages if item.get("id") == message["id"]), None)
        payload = payload or json.loads(text)
        if "error" in payload:
            raise RuntimeError(payload["error"])
        return payload["result"]


def descriptor_hash(tool):
    encoded = json.dumps(tool, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def admin(mode, token):
    base = os.getenv("MCP_ADMIN_URL", "http://mcp:8081/admin")
    request = Request(base + "/tools/payments/" + mode, data=b"{}",
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urlopen(request, timeout=15) as response:
        return json.load(response)


def main():
    client = McpClient()
    token = os.environ["MCP_ADMIN_TOKEN"]
    admin("restore", token)
    tools = {tool["name"]: tool for tool in client.rpc("tools/list", {})["tools"]}
    assert set(tools) == {"crm", "tickets", "files", "payments", "email"}
    payment_hash = descriptor_hash(tools["payments"])
    try:
        try:
            admin("drift", "invalid-probe-token")
        except HTTPError as error:
            assert error.code == 401
        else:
            raise AssertionError("Admin accepted an invalid token")
        admin("drift", token)
        drifted = next(tool for tool in client.rpc("tools/list", {})["tools"] if tool["name"] == "payments")
        assert descriptor_hash(drifted) != payment_hash
        blocked = client.rpc("tools/call", {"name": "payments", "arguments": {
            "resource_id": "payments/nordfreight-supplier", "capability": "payments.transfer",
            "parameters": {"amount_cents": 4800000}, "trace_id": uuid.uuid4().hex,
            "expected_descriptor_hash": payment_hash,
        }})
        assert blocked["isError"] is True
        print("MCP initialize/listChanged, admin auth and descriptor drift execution block: passed")
    finally:
        admin("restore", token)
    restored = next(tool for tool in client.rpc("tools/list", {})["tools"] if tool["name"] == "payments")
    assert descriptor_hash(restored) == payment_hash
    arguments = {"resource_id": "crm/customer-1001", "capability": "crm.read", "parameters": {},
                 "trace_id": uuid.uuid4().hex, "expected_descriptor_hash": descriptor_hash(tools["crm"])}
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: client.rpc("tools/call", {"name": "crm", "arguments": arguments}), range(2)))
    assert sum(result.get("isError") is not True for result in results) == 1
    assert sum(result.get("isError") is True for result in results) == 1
    print("MCP descriptor restore and concurrent duplicate execution guard: passed")
    delete = Request(client.base, headers=client.headers, method="DELETE")
    with urlopen(delete, timeout=15):
        pass


if __name__ == "__main__":
    main()
