import re
from pathlib import Path


def negative_routes(path=None):
    path = path or Path(__file__).resolve().parents[2] / "docs/security/route-matrix.md"
    text = path.read_text()
    gateway = text.split("## Gateway routes", 1)[1].split("## Other services", 1)[0]
    checks = []
    for line in gateway.splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 4:
            continue
        endpoints = re.findall(r"`([^`]+)`", cells[0])
        method = None
        routes = []
        for endpoint in endpoints:
            match = re.fullmatch(r"(GET|POST) (/\S+)", endpoint)
            if match:
                method, route = match.groups()
            elif method and endpoint.startswith("/"):
                route = "/api/v1" + endpoint
            else:
                raise ValueError("Unrecognized route-matrix endpoint")
            routes.append((method, route))
        refusals = re.findall(r"(?:^|;\s*)([AHR](?:,\s*[AHR])*)\s*:\s*(401|403)\b", cells[3])
        for principals, status in refusals:
            for principal in re.findall(r"[AHR]", principals):
                checks.extend((method, route, principal, int(status)) for method, route in routes)
        if re.search(r"(?:^|;\s*)employee:\s*403\b", cells[3]):
            checks.extend((method, route, "employee", 403) for method, route in routes)
        if re.search(r"cookie without bearer:\s*401\b", cells[3]):
            checks.extend((method, route, "cookie", 401) for method, route in routes)
    if not checks:
        raise ValueError("Route matrix contains no recognized negative checks")
    return checks


def request_body(route):
    if route == "/api/v1/actions":
        return {"session_id": "ffffffff-ffff-4fff-8fff-ffffffffffff", "capability": "crm.read", "resource": {"type": "crm_record", "id": "crm/customer-1042", "tier": "internal"}, "parameters": {}}
    if route == "/api/v1/agent-messages":
        return {"session_id": "ffffffff-ffff-4fff-8fff-ffffffffffff", "receiver_id": "invoice-assistant", "requested_capability": "crm.read", "content": "Read one customer"}
    if route == "/api/v1/sessions":
        return {"agent_id": "invoice-assistant", "use_case_id": "invoice-processing", "delegated": ["crm.read"], "tier_ceiling": "internal", "budget_cents": 100}
    if route == "/api/v1/controls/attachments":
        return {"control_id": "CTL-CAP-001", "target_type": "organization", "target_id": "acme", "parameters": {}}
    if route.endswith(("/approve", "/reject")):
        return {"reason": "Security-suite principal boundary test"}
    return {}
