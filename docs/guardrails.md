# Guardrails: the runtime configuration of the control layer

Betsee decides every request against one policy directory, `policies/`. Cedar policies say what a
decision means; [`policies/guardrails.yaml`](../policies/guardrails.yaml) says how sensitive the
Gateway is: which detections block and which are redacted, how much semantic risk each use case
tolerates, which models agents may call and what they cost, how large session budgets are, and what
a model must look like to be admitted. [`policies/controls.yaml`](../policies/controls.yaml) names
every control and maps it to the OWASP risks it mitigates.

## Change it while it runs

The Gateway watches `policies/` (mounted into the container, not baked in). A saved change to any
Cedar file, the schema, `controls.yaml`, `guardrails.yaml`, the classifier model or the signature
baseline is validated off the request path and swapped in atomically, usually within a second:

- **Accepted**: the next request uses it. Director > Guardrails shows the new policy version, and a
  `policy_reloaded` security event records which files changed.
- **Rejected** (a YAML typo, an unknown profile, a Cedar policy that fails strict validation, an
  invalid regex): the previous configuration keeps running. Director > Guardrails shows the error
  with its line, and a `policy_reload_rejected` security event is raised.

Try it: in `guardrails.yaml` change `employee-assistance: balanced` to `employee-assistance: strict`
and send a PESEL from the Desk or the Director playground. Then write `pesel: redakt` and watch the
rejection. `tests/security/guardrails_live.py` does both against the live stack and restores the
file.

## Strictness profiles

Each use case runs under one profile (`assignments`); anything unassigned uses `default`.

| Detector (input)    | strict | balanced | permissive |
| ------------------- | ------ | -------- | ---------- |
| payment_card        | block  | block    | redact     |
| iban                | block  | redact   | allow      |
| pesel               | block  | redact   | allow      |
| secret              | block  | block    | block      |
| email               | block  | redact   | allow      |
| phone               | block  | redact   | allow      |
| resource_above_tier | block  | block    | block      |
| semantic review_at  | 0.40   | 0.60     | 0.80       |
| semantic block_at   | 0.60   | 0.85     | 0.95       |

- **block** refuses the request; Cedar names the deciding policy (`forbid-input-pesel`).
- **redact** replaces the value with `[REDACTED:PESEL]`; only the redacted text reaches the agent
  or the model (CTL-IN-002). The trace keeps a masked finding (`PESEL ending 59`), never the value.
- **allow** records the finding and changes nothing.

Detectors validate, not just match: card numbers by network prefix and Luhn, IBANs by country length
and mod-97, PESEL by checksum and birth date, keys by known format plus an entropy floor.

Output profiles (`output:`) apply the same classes to what models and tools return (CTL-OUT-002):
redact in place, or withhold the whole result when a class blocks.

### Semantic adherence thresholds

The injection classifier (CTL-AI-002) gives each text a score between 0 and 1. The profile's
thresholds turn it into a verdict that Cedar reads as `context.analysis.verdict`:

| Where                        | score >= review_at                                       | score >= block_at |
| ---------------------------- | -------------------------------------------------------- | ----------------- |
| What a person types          | passes, the session is marked as holding untrusted input | refused           |
| An agent's action data       | needs a human approval                                   | needs approval    |
| What a model or tool returns | the session is marked as holding untrusted input         | same              |

A session holding untrusted input needs a person for every high-impact action (CTL-PROV-001). The
classifier never denies an agent's action on its own: a statistical verdict sends the action to a
human, and only deterministic controls, signatures or the optional LLM judge deny.

## The semantic classifier

`policies/models/injection-classifier.json` is a logistic regression over hashed word, word-pair and
character 3-5-gram features plus intent features (override + prior instructions, send + sensitive
data + external destination, execute + remote script, and others) from Polish and English lexicons.
It runs inside the Gateway: no model server, no network call, 1-5 ms per check.

Before scoring it reads the text the way an attacker hides it: leetspeak mapped back
(`1gn0ruj` -> `ignoruj`), spaced letters rejoined, Cyrillic and Greek homoglyphs and full-width
forms folded, invisible characters dropped, base64, hex and percent-encoded segments decoded. The
verdict uses the highest-scoring reading, and long texts are scored in overlapping windows so an
instruction buried in a ticket is not diluted. The trace shows the score, the reading that scored,
the words that pushed it up and the intents found.

Training data, licences and the evaluation by threshold are in
[`tools/semantic-classifier/README.md`](../tools/semantic-classifier/README.md); the numbers are
also in Director > Guardrails. `semantic.llm_judge: true` adds the OpenAI-compatible analyzer as a
second opinion (the stricter verdict wins); in the demo stack that endpoint is the mock model, so it
is off by default.

## Threat signatures and the external feed

Known exploits against AI systems are matched deterministically (CTL-SIG-001) against chat input,
action parameters, shell commands, model and tool output, files and model artifacts:

| Signature         | What it catches                                      | Reference                      |
| ----------------- | ---------------------------------------------------- | ------------------------------ |
| SIG-EXEC-001      | download piped into a shell                          | ShadowRay payload delivery     |
| SIG-EXEC-002      | reverse-shell one-liners                             | MITRE T1059                    |
| SIG-RAY-001       | Ray Jobs API submission                              | CVE-2023-48022 (ShadowRay)     |
| SIG-OLLAMA-001    | model digest path traversal                          | CVE-2024-37032 (Probllama)     |
| SIG-LANGFLOW-001  | Langflow code validation endpoint                    | CVE-2025-3248                  |
| SIG-SSRF-001      | cloud instance metadata endpoints                    | Capital One 2019, T1552.005    |
| SIG-LOG4J-001     | JNDI lookup strings                                  | CVE-2021-44228                 |
| SIG-PATH-001      | path traversal in tool arguments                     | CWE-22                         |
| SIG-CRED-001      | credential store paths in commands                   | T1552.001                      |
| SIG-MCP-001       | hidden instructions in tool descriptions and results | MCP tool poisoning, 2025       |
| SIG-EXFIL-001     | data-carrying markdown images in output (removed)    | CVE-2025-32711 (EchoLeak)      |
| SIG-JAILBREAK-001 | published jailbreak personas (review)                | DAN family                     |
| SIG-TPL-001       | Jinja chat templates reaching Python internals       | CVE-2024-34359 (Llama Drama)   |
| SIG-PICKLE-001    | pickle imports that run code on load                 | CVE-2025-32434, malicious hubs |
| SIG-KERAS-001     | Keras Lambda layers                                  | CVE-2024-3660                  |
| SIG-HUB-001       | repositories reported as malicious                   | JFrog research, 2024           |
| SIG-HASH-001      | file hashes on the blocklist                         | EICAR                          |

The baseline ships in `policies/threat-feed/baseline.json`. The external feed is an HTTP source
(`signatures.feed_url`, polled every `poll_seconds`); in the demo stack Caddy serves
`infra/threat-feed/feed.json` at `http://caddy:8090/feed.json` (and at `http://feed.betsee.localhost`
for a browser) as a stand-in for a SOC or vendor service. Feed entries are merged with the baseline
by id, so the feed can add, override or disable (`"enabled": false`) a signature. A feed that cannot
be fetched or does not compile leaves the last good set active and raises `threat_feed_rejected`.

A signature is `block` (deny; output matches are cut out of the text) or `review` (a person
approves, or the session is marked untrusted). Matchers: `regex` (linear-time Rust regex),
`exact`, `sha256`, `pickle_imports` (module.name with `module.*` wildcards).

## Models: allowlist, prices and budgets

`models` is the allowlist for `llm.complete` (CTL-MODEL-001). A model not listed or with
`enabled: false` is refused before a token is spent. Which data tier a model may receive stays the
Cedar `Model.maxTier` attribute (CTL-TIER-003): the external models in the demo are cleared for
public data only.

Prices are in euro cents. External models are priced per 1,000 input and output tokens; local
models per second of inference, so on-premise GPU time is governed like API spend. Before a call the
Gateway reserves the worst case (prompt estimate plus `max_output_tokens`) against the session's
cents and tokens (CTL-RUN-001, CTL-RUN-005); after the call it charges what was actually used, from
the provider's `usage` or the measured time. The session shows limit, used, tokens and spend per
model; Director > Overview shows spend and tokens over the last 15 minutes.

`budgets.sessions` sets each use case's default session budget, `max_session_cents` caps what a
human may grant, and `action_cost_cents` prices non-model actions (a CRM read, a message).

## Model supply chain

`model.load` admits a model from a public hub only when (CTL-SUP-001, `supply_chain`):

- the revision is a full 40-character commit hash, not a branch or tag;
- `trust_remote_code` is not requested;
- no file is in a format that can run code on load (`.bin`, `.pt`, `.pkl`, `.ckpt`, `.h5`, ...);
- the publisher is on `allowed_orgs`, and is not one or two edits away from one (`meta-llamma`);
- the repository is not on the threat feed (`SIG-HUB-001`).

Model files themselves are inspected without being loaded (CTL-FILE-002): pickle opcodes are walked
(protocols 0-5, inside PyTorch zip checkpoints and NumPy object arrays) and every import is matched
against `SIG-PICKLE-001`; GGUF metadata is parsed for chat templates; Keras and HDF5 configurations
are checked for Lambda layers. Files uploaded to an agent workspace go through the same inspection,
and security officers can scan any artifact in Director > Guardrails.

## Where to look

- Director > Guardrails: playground (type anything, see the decision, redactions, signatures and
  classifier explanation), artifact scanner, live configuration and last rejection, profile matrix,
  models and budgets, active signatures and feed status, classifier evaluation.
- Every trace: the `threat_signatures` and `budget` stages, the analyzer's score and terms, the
  output filter's redactions, and the cost of the call.
- API: `GET /api/v1/guardrails`, `POST /api/v1/guardrails/evaluate`, `POST /api/v1/artifacts/scan`
  (security officer or org admin).
