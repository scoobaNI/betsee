# OWASP mapping: ASI01-ASI10 onto Betsee primitives (F02)

Status: v0, 2026-10-03. Owner: security-architect. Source of truth for the rows: `policies/controls.yaml`.
Every control lists `asi` and `primitive` there, and the tables below are derived from it.
Decision evidence: `policies/tests/acme-cases.json` (step ids such as `act3.s2`).

## Sources (official OWASP, checked 2026-10-03)

| Document                                                          | Version / date                                                | Used for                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [OWASP Top 10 for Agentic Applications for 2026][asi]             | Version 2026, published 2025-12-09; no later revision         | the ASI01-ASI10 ids and titles, and their mitigation lists                        |
| [Agent Control Standard (ACS)][acs], OWASP GenAI Security Project | spec v0.1.0 draft (release tags v0.1.1, v0.1.2 of 2026-09-09) | the decision vocabulary and the trace/audit expectations                          |
| [OWASP Top 10 for LLM Applications 2026][llm]                     | 2026-08-03; renumbered against 2025                           | cross-reference; the ASI document itself cites the 2025 ids                       |
| [OWASP MCP Top 10][mcp]                                           | MCP01-MCP10:2025, phase 3 beta                                | tool poisoning, rug pull, shadow servers                                          |
| [MCP Security Cheat Sheet][mcpcs]                                 | updated 2026-10-01                                            | "pin tool definitions with cryptographic hashes and verify before each execution" |
| [AI Agent Security Cheat Sheet][agcs]                             | living document, changed 2026-10-02                           | control areas check                                                               |
| [AISVS 1.0][aisvs], chapters C9 (agentic) and C10 (MCP)           | June 2026                                                     | verification-level cross-reference                                                |
| [Agentic AI - Threats and Mitigations][tm]                        | v1.1, December 2025, T1-T17                                   | threat taxonomy background                                                        |

[asi]: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
[acs]: https://genai.owasp.org/resource/agent-control-standard-acs/
[llm]: https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/
[mcp]: https://owasp.org/www-project-mcp-top-10/
[mcpcs]: https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html
[agcs]: https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
[aisvs]: https://github.com/OWASP/AISVS
[tm]: https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/

## The idea: few primitives, one pipeline

Betsee does not build ten defences for ten risks. Every agent action passes through one Gateway
pipeline:

```text
authenticate -> resolve execution context -> deterministic Cedar decision
  -> AI analysis (tighten only) -> approval / step-up -> execute -> output controls
  -> audit + trace
```

The OWASP risks are mitigated by nine small primitives inside that pipeline. Each primitive is a
handful of Cedar policies or one named Gateway mechanism, attached through the controls catalog.
The catalog is the delivery mechanism: a control is a named, explainable guarantee with attachment
points (organization, team, user, agent, use case, tool, provider/model, tier), and it names the
primitive it belongs to.

## Primitive -> ASI -> controls -> demo

| Primitive                                             | Mitigates                                | Controls                                                                                                               | Demo (act, case step)                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRM-ID Agent identity + delegation (AgentSession)     | ASI03, ASI10                             | CTL-ID-001, CTL-ID-003, CTL-ID-004, CTL-DEL-001, CTL-DEL-003                                                           | Act 1, the trace names Maya, the agent and the use case (`act1.s1`). The negative cases cover a foreign session id (`neg.1`), a deprovisioned human (`neg.4`) and delegation beyond the human's entitlements (`del.2`).                                                                                                                                  |
| PRM-CAP Capability intersection + Cedar authorization | ASI02, ASI03, ASI05                      | CTL-CAP-001, CTL-POL-001, CTL-POL-002                                                                                  | Act 1 allow by `permit-effective-capability`; Policy Studio shows delegated ∩ permitted; `neg.2`                                                                                                                                                                                                                                                         |
| PRM-TIER Information tiers + taint                    | ASI01, ASI02, ASI03, ASI04, ASI06, ASI07 | CTL-DEL-002, CTL-TIER-001, CTL-TIER-002, CTL-TIER-003, CTL-MEM-001, CTL-OUT-001, CTL-PROV-001, CTL-A2A-002, CTL-IN-001 | Act 2: the HR folder is above the session ceiling (`act2.s1`). Employee chat: a card number, IBAN, PESEL or key typed to the assistant never reaches the model (`in.2` to `in.6`), and its restricted file stays closed (`rt.read.2`, `rt.shell.3`). Act 3: the external email is blocked by no write-down (`act3.s2`). `neg.10` covers model clearance. |
| PRM-TOOL Tool integrity + command validation          | ASI02, ASI04, ASI05                      | CTL-TOOL-001, CTL-EXEC-001, CTL-RT-001                                                                                 | Act 2: `curl ... \| sh` matches no template (`act2.s2`). Employee chat: Claude Code asks the Gateway before every tool call; `rm -rf` matches no read-only template (`rt.shell.2`) and network egress is denied (`rt.egress.1`). Act 6: the payments descriptor drifted (`act6.s1`).                                                                     |
| PRM-A2A Mediated agent-to-agent channel               | ASI03, ASI07, ASI08                      | CTL-A2A-001, CTL-A2A-003                                                                                               | Act 4: research-agent asks invoice-assistant to pay. The peer is not allowed, and a message is not a delegation (`act4.s1`).                                                                                                                                                                                                                             |
| PRM-HITL Human approval + step-up                     | ASI02, ASI03, ASI09                      | CTL-APR-001, CTL-APR-002, CTL-APR-003, CTL-APR-004                                                                     | Act 5: the 48,000 EUR transfer goes to require_approval with step-up. Daniel approving without OTP leaves require_step_up; with OTP (acr 2) it executes (`act5.s1`-`s3`).                                                                                                                                                                                |
| PRM-RUN Budget, circuit breaker + quarantine          | ASI08, ASI10                             | CTL-ID-002, CTL-RUN-001, CTL-RUN-002, CTL-RUN-003, CTL-RUN-004                                                         | Act 4: the retry storm hits the rate limit and the breaker (`act4.s2`). Act 6: report-bot exceeds its budget, is quarantined, and every later action denies (`act6.s2`, `act6.s3`).                                                                                                                                                                      |
| PRM-AI AI analysis that only tightens                 | ASI01, ASI06                             | CTL-AI-001                                                                                                             | Act 3: memory.write of the planted text is allowed deterministically, and the analyzer (mock model, demo) raises it to require_approval (`act3.s3`). It cannot loosen the email deny (`act3.s2b`).                                                                                                                                                       |
| PRM-TRACE Trace + audit                               | ASI08, ASI09, ASI10                      | CTL-AUD-001                                                                                                            | Every act. Act 1's trace explorer shows the seven answers, and Act 7's coverage view shows live evidence per ASI.                                                                                                                                                                                                                                        |

## ASI -> how Betsee mitigates it

| ASI (official title)                       | Primitives                                   | Controls                                                                                                                           | Act  | What the audience sees                                                                                                                      |
| ------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ASI01 Agent Goal Hijack                    | PRM-TIER, PRM-AI                             | CTL-TIER-002, CTL-OUT-001, CTL-PROV-001, CTL-AI-001                                                                                | 3    | The planted instruction does not have to be detected for the exfiltration to fail: no write-down denies it deterministically.               |
| ASI02 Tool Misuse and Exploitation         | PRM-CAP, PRM-TIER, PRM-TOOL, PRM-HITL        | CTL-CAP-001, CTL-POL-001, CTL-POL-002, CTL-TIER-001-003, CTL-TOOL-001, CTL-EXEC-001, CTL-APR-001, CTL-APR-003                      | 2    | Each tool call is a separately authorized action with capability, resource and tier.                                                        |
| ASI03 Identity and Privilege Abuse         | PRM-ID, PRM-CAP, PRM-TIER, PRM-A2A, PRM-HITL | CTL-ID-001, CTL-ID-003, CTL-ID-004, CTL-DEL-001-003, CTL-CAP-001, CTL-POL-001, CTL-TIER-001, CTL-A2A-003, CTL-APR-002, CTL-APR-003 | 2, 5 | Maya can read HR files, her agent cannot. Delegation is checked when the session is created, and the approver is a different person.        |
| ASI04 Agentic Supply Chain Vulnerabilities | PRM-TOOL, PRM-TIER                           | CTL-TOOL-001, CTL-TIER-003                                                                                                         | 6    | A changed tool descriptor is blocked before any agent sees it. Models receive only data cleared for them.                                   |
| ASI05 Unexpected Code Execution (RCE)      | PRM-TOOL, PRM-CAP                            | CTL-EXEC-001, CTL-CAP-001, CTL-RT-001                                                                                              | 2    | `curl ... \| sh` matches no validated template, so it is denied.                                                                            |
| ASI06 Memory & Context Poisoning           | PRM-TIER, PRM-AI                             | CTL-TIER-002, CTL-MEM-001, CTL-OUT-001, CTL-PROV-001, CTL-AI-001                                                                   | 3    | Memory entries carry tier and provenance; the planted memory write is AI-tightened to approval.                                             |
| ASI07 Insecure Inter-Agent Communication   | PRM-A2A, PRM-TIER                            | CTL-A2A-001, CTL-A2A-002, CTL-A2A-003, CTL-PROV-001                                                                                | 4    | No direct agent-to-agent path exists. The Gateway records sender (from the token), receiver, use case, capability, provenance and trace id. |
| ASI08 Cascading Failures                   | PRM-RUN, PRM-A2A, PRM-TRACE                  | CTL-ID-002, CTL-A2A-001, CTL-RUN-001-004, CTL-AUD-001                                                                              | 4    | The breaker trips, and the blocked edge is visible in the agent graph.                                                                      |
| ASI09 Human-Agent Trust Exploitation       | PRM-HITL, PRM-TRACE                          | CTL-APR-001-004, CTL-AUD-001                                                                                                       | 5    | The approval card shows Gateway-derived parameters and provenance, not the agent's summary; four-eyes plus OTP.                             |
| ASI10 Rogue Agents                         | PRM-RUN, PRM-ID, PRM-TRACE                   | CTL-ID-001, CTL-ID-002, CTL-DEL-003, CTL-RUN-001-004, CTL-AUD-001                                                                  | 6    | report-bot is quarantined, and every later action denies; a human must release it.                                                          |

All ten acts' expectations hold against the real policies:

```sh
cargo run --release --manifest-path policies/tests/cedar-check/Cargo.toml -- policies/schema.cedarschema policies policies/tests/acme-cases.json
```

## What Betsee deliberately does not claim

These OWASP mitigations are outside v0. They are named here so the coverage view never overstates.

| ASI          | OWASP mitigation                                    | Betsee v0                                                                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ASI01        | intent capsules, goal-drift monitoring              | not built. Betsee contains the effects of a hijack (tiers, capabilities, approval) instead of detecting the hijack. It is never presented as an "AI firewall" or a "prompt injection filter".                                                                |
| ASI02, ASI05 | sandboxed execution, dry runs, egress allowlists    | command templates only. The demo host does not execute arbitrary shell. Egress allowlisting is v1.                                                                                                                                                           |
| ASI03        | just-in-time downstream credentials; token exchange | agents never hold connector credentials (the Gateway does). RFC 8693 token exchange is the documented scale path (ADR-0001).                                                                                                                                 |
| ASI04        | signed manifests, AIBOM                             | hash pinning, with re-pinning by an admin. Signatures and AIBOM are v1.                                                                                                                                                                                      |
| ASI06        | memory expiry and rollback, trust scores            | labelled memory only.                                                                                                                                                                                                                                        |
| ASI07        | mTLS, signed messages, anti-replay between agents   | agents never talk directly. The Gateway authenticates the sender by token. In-cluster mTLS is v1.                                                                                                                                                            |
| ASI08, ASI10 | tamper-evident lineage logs, signed audit logs      | append-only triggers on the audit tables stop bugs, not a compromised Gateway: the Gateway's database role owns those tables and could rewrite them. A least-privilege insert-only role, hash-chained or signed audit rows, and an external log sink are v1. |
| ASI10        | watchdog agents, behavioural manifests, attestation | quarantine, kill switch and human release only.                                                                                                                                                                                                              |

## Cross-references

**Agent Control Standard.** ACS places hooks in the agent, which call a Guardian Agent; Betsee is a
gateway policy enforcement point and decision point that the agent cannot bypass. Betsee does not
claim ACS conformance. Decision vocabulary:

| ACS disposition | Betsee                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| `allow`         | `allow`                                                                             |
| `deny`          | `deny`                                                                              |
| `ask`           | `require_approval` / `require_step_up`                                              |
| `modify`        | not supported by design: Betsee never rewrites an agent's request; it decides on it |
| `defer`         | not built                                                                           |

The trace (spans per stage, `trace_id` correlation) covers the intent of ACS's trace pillar.

**LLM Top 10 2026.**

| LLM risk                                    | Betsee                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| LLM01:2026 Prompt Injection                 | contained through PRM-TIER, PRM-CAP, PRM-HITL and PRM-AI; not filtered |
| LLM02:2026 Sensitive Information Disclosure | PRM-TIER (no write-down, model clearance)                              |
| LLM03:2026 Excessive Agency                 | PRM-CAP, PRM-HITL                                                      |
| LLM04:2026 Supply Chain                     | PRM-TOOL, CTL-TIER-003                                                 |
| LLM06:2026 Unbounded Consumption            | PRM-RUN                                                                |
| LLM08:2026 Hidden Context Exposure          | PRM-TIER, partially                                                    |
| LLM10:2026 Improper Output Handling         | CTL-OUT-001 (output controls stage)                                    |
| LLM05, LLM07, LLM09 (2026)                  | out of scope for a control plane                                       |

**MCP Top 10 (2025).**

| MCP risk                                                   | Betsee                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| MCP01 Token Mismanagement & Secret Exposure                | agents never hold tool credentials                                                 |
| MCP02 Privilege Escalation via Scope Creep                 | PRM-CAP                                                                            |
| MCP03 Tool Poisoning                                       | CTL-TOOL-001                                                                       |
| MCP04 Software Supply Chain Attacks & Dependency Tampering | CTL-TOOL-001, partially                                                            |
| MCP05 Command Injection & Execution                        | CTL-EXEC-001                                                                       |
| MCP06 Intent Flow Subversion                               | PRM-TIER, PRM-AI                                                                   |
| MCP07 Insufficient Authentication & Authorization          | PRM-ID, PRM-CAP                                                                    |
| MCP08 Lack of Audit and Telemetry                          | PRM-TRACE                                                                          |
| MCP09 Shadow MCP Servers                                   | `forbid-mcp-call-without-tool`: only Gateway-registered, pinned tools are callable |
| MCP10 Context Injection & Over-Sharing                     | PRM-TIER                                                                           |

**AISVS 1.0, chapter C9.**

| AISVS section                                | Betsee                                        |
| -------------------------------------------- | --------------------------------------------- |
| C9.1 budgets, loop control, circuit breakers | PRM-RUN                                       |
| C9.2 high-impact approval                    | PRM-HITL                                      |
| C9.3 isolation and tool authorization        | PRM-CAP, PRM-TOOL                             |
| C9.4 identity                                | PRM-ID                                        |
| C9.5 delegation and continuous enforcement   | PRM-ID, plus per-action evaluation in PRM-CAP |
| C9.6 shutdown                                | CTL-ID-002, CTL-RUN-004                       |

C10.4.8 (re-approve a changed tool definition before use) is CTL-TOOL-001.
