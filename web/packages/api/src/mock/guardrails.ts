// Mock answers for the guardrail endpoints. The configuration mirrors policies/guardrails.yaml, the
// classifier card and the signature baseline plus the demo feed; the playground and the artifact
// scanner run small stand-ins for the Gateway's detectors, signatures and classifier, so every
// response has the live shape while the verdicts are only the mock's.
import type {
  ActionCost,
  Analyzer,
  ArtifactScan,
  ArtifactScanRequest,
  Evaluation,
  EvaluateRequest,
  GuardrailAction,
  GuardrailFinding,
  GuardrailProfile,
  GuardrailsStatus,
  Hit,
  SummaryGuardrails,
  ThreatSignature,
  Trace,
} from '../types.ts';
import { COST_CENTS } from './world.ts';

export const MOCK_POLICY_VERSION = '5c1e0d9a7b42';
export const CLASSIFIER_LABEL = 'mock classifier (demo)';

type InputClass = GuardrailFinding['class'];
type OutputClass = Exclude<InputClass, 'resource_above_tier'>;
type Variant = NonNullable<Analyzer['classifier']>['detail']['variant'];

const profile = (
  description: string,
  input: Record<InputClass, GuardrailAction>,
  output: Record<OutputClass, GuardrailAction>,
  review_at: number,
  block_at: number,
): GuardrailProfile => ({ description, input, output, semantic: { review_at, block_at } });

const PROFILES: Record<string, GuardrailProfile> = {
  strict: profile(
    'Regulated work. Any personal data or secret in a message blocks it; low semantic tolerance.',
    { payment_card: 'block', iban: 'block', pesel: 'block', secret: 'block', email: 'block', phone: 'block', resource_above_tier: 'block' },
    { payment_card: 'block', iban: 'block', pesel: 'block', secret: 'block', email: 'redact', phone: 'redact' },
    0.4,
    0.6,
  ),
  balanced: profile(
    'Default. Secrets and card numbers block; other personal data is redacted before any model sees it.',
    { payment_card: 'block', iban: 'redact', pesel: 'redact', secret: 'block', email: 'redact', phone: 'redact', resource_above_tier: 'block' },
    { payment_card: 'redact', iban: 'redact', pesel: 'redact', secret: 'redact', email: 'redact', phone: 'redact' },
    0.6,
    0.85,
  ),
  permissive: profile(
    'Internal research. Only secrets block; personal data passes and is logged; high semantic tolerance.',
    { payment_card: 'redact', iban: 'allow', pesel: 'allow', secret: 'block', email: 'allow', phone: 'allow', resource_above_tier: 'block' },
    { payment_card: 'redact', iban: 'allow', pesel: 'allow', secret: 'redact', email: 'allow', phone: 'allow' },
    0.8,
    0.95,
  ),
};

const ASSIGNMENTS = {
  default: 'balanced',
  use_cases: {
    'invoice-processing': 'strict',
    'employee-assistance': 'balanced',
    'ticket-triage': 'balanced',
    'market-research': 'permissive',
    'weekly-reporting': 'balanced',
    'deployment-helper': 'balanced',
  } as Record<string, string>,
};

export const profileFor = (useCaseId: string) => ASSIGNMENTS.use_cases[useCaseId] ?? ASSIGNMENTS.default;

const sig = (
  id: string,
  name: string,
  category: string,
  severity: string,
  action: 'block' | 'review',
  references: string[],
  description: string,
  targets: string[],
  source: 'baseline' | 'feed' = 'baseline',
): ThreatSignature => ({ id, name, category, severity, action, references, description, targets, source });

const SIGNATURES: ThreatSignature[] = [
  sig('SIG-EXEC-001', 'Remote script piped into a shell', 'code_execution', 'critical', 'block', ['ShadowRay campaign payload delivery (CVE-2023-48022)'], 'A download piped straight into an interpreter, the delivery step of most agent and AI-cluster compromises.', ['prompt', 'parameters', 'command', 'output']),
  sig('SIG-EXEC-002', 'Reverse shell one-liner', 'code_execution', 'critical', 'block', ['MITRE ATT&CK T1059'], 'Interactive shell redirected to a remote host.', ['prompt', 'parameters', 'command', 'output']),
  sig('SIG-RAY-001', 'Ray Jobs API job submission', 'code_execution', 'critical', 'block', ['CVE-2023-48022 (ShadowRay)'], 'Unauthenticated job submission to a Ray dashboard runs arbitrary code on the AI cluster.', ['prompt', 'parameters', 'command']),
  sig('SIG-OLLAMA-001', 'Model registry digest path traversal', 'supply_chain', 'critical', 'block', ['CVE-2024-37032 (Probllama)'], 'A model manifest digest that walks out of the blob directory lets a malicious registry overwrite files on the inference server.', ['prompt', 'parameters', 'command']),
  sig('SIG-LANGFLOW-001', 'Langflow code validation endpoint', 'code_execution', 'critical', 'block', ['CVE-2025-3248'], 'The unauthenticated code validation endpoint of Langflow executes Python sent to it.', ['prompt', 'parameters', 'command']),
  sig('SIG-SSRF-001', 'Cloud instance metadata endpoint', 'credential_access', 'high', 'block', ['Capital One 2019 SSRF breach', 'MITRE ATT&CK T1552.005'], 'Instance metadata hands out cloud credentials to whoever can make the server call it.', ['prompt', 'parameters', 'command', 'output']),
  sig('SIG-LOG4J-001', 'JNDI lookup string', 'code_execution', 'critical', 'block', ['CVE-2021-44228 (Log4Shell)'], 'Text an agent writes to a ticket, log or email can reach a vulnerable logger.', ['prompt', 'parameters', 'output']),
  sig('SIG-PATH-001', 'Path traversal in tool arguments', 'privilege_escalation', 'high', 'block', ['CWE-22'], 'Arguments that climb out of the directory a tool is meant to work in.', ['parameters', 'command']),
  sig('SIG-CRED-001', 'Credential store path', 'credential_access', 'high', 'block', ['MITRE ATT&CK T1552.001'], 'Files that hold keys and passwords, named in a tool call or command.', ['parameters', 'command']),
  sig('SIG-MCP-001', 'Hidden instructions in a tool description or result', 'prompt_injection', 'high', 'review', ['MCP tool poisoning (Invariant Labs, 2025)'], 'An <IMPORTANT> block or an instruction to keep something from the user, aimed at the model rather than the person.', ['prompt', 'parameters', 'output']),
  sig('SIG-EXFIL-001', 'Data in an auto-loading markdown image', 'exfiltration', 'high', 'block', ['CVE-2025-32711 (EchoLeak)', 'Markdown image exfiltration in chat assistants'], 'An image link whose URL carries data leaks it the moment the reply is rendered, with no click.', ['output', 'parameters']),
  sig('SIG-JAILBREAK-001', 'Published jailbreak persona', 'prompt_injection', 'medium', 'review', ['DAN and developer-mode jailbreak families (2023)'], 'Named personas from public jailbreak collections.', ['prompt', 'parameters']),
  sig('SIG-TPL-001', 'Template injection in a model chat template', 'supply_chain', 'critical', 'block', ['CVE-2024-34359 (llama-cpp-python, Llama Drama)'], 'A Jinja chat template inside model metadata that reaches Python internals runs code when the model loads.', ['model_template', 'prompt', 'parameters']),
  sig('SIG-PICKLE-001', 'Code execution on pickle load', 'unsafe_deserialization', 'critical', 'block', ['CVE-2025-32434 (torch.load weights_only bypass)', 'Malicious pickle models on public hubs (JFrog, 2024)'], 'A pickle that imports a callable able to run commands, open sockets or load more code executes it during deserialization.', ['file', 'model_file']),
  sig('SIG-KERAS-001', 'Keras Lambda layer in a model file', 'unsafe_deserialization', 'critical', 'block', ['CVE-2024-3660'], 'A Lambda layer carries serialized Python bytecode that runs when the model is loaded.', ['model_file']),
  sig('SIG-HUB-001', 'Model repository reported as malicious', 'supply_chain', 'critical', 'block', ['JFrog security research on malicious Hugging Face models, 2024'], 'Repositories removed from public hubs after carrying code-execution payloads.', ['model_ref']),
  sig('SIG-HASH-001', 'Known-bad file', 'malware', 'high', 'block', ['EICAR test file'], "Files whose SHA-256 is on the feed's blocklist.", ['file', 'model_file']),
  sig('SIG-ACME-001', 'Finance approval-override lure', 'social_engineering', 'high', 'block', ['Acme SOC advisory 2026-09 (demo entry)'], 'Wording from a phishing wave against the finance team that tells the reader, or an assistant reading for them, to pay without the approval step.', ['prompt', 'parameters', 'output'], 'feed'),
  sig('SIG-ACME-002', 'Attacker-controlled drop domain', 'exfiltration', 'high', 'block', ['Acme SOC advisory 2026-09 (demo entry)'], 'A domain seen receiving stolen data in the same campaign.', ['prompt', 'parameters', 'command', 'output'], 'feed'),
];

export const SIGNATURE_COUNT = SIGNATURES.length;

const PATTERNS: Record<string, RegExp> = {
  'SIG-EXEC-001': /\b(curl|wget|iwr|invoke-webrequest)\b[^\n|;]{0,300}(\||-o-?\s*\|)\s*(sudo\s+)?(ba|z|da|k)?sh\b|\b(curl|wget)\b[^\n]{0,300}\|\s*(python3?|perl|ruby|node)\b/gi,
  'SIG-EXEC-002': /\/dev\/tcp\/[0-9a-z.-]+\/[0-9]+|\bnc(at)?\b[^\n]{0,80}\s-e\s|\bmkfifo\b[^\n]{0,120}\bnc\b/gi,
  'SIG-RAY-001': /\/api\/jobs\/?[^\n]{0,400}entrypoint|ray\s+job\s+submit\b/gi,
  'SIG-OLLAMA-001': /sha256[:-][^"'\s]{0,80}\.\.[/\\]|"digest"\s*:\s*"[^"]*\.\.[/\\]/gi,
  'SIG-LANGFLOW-001': /\/api\/v1\/validate\/code/gi,
  'SIG-SSRF-001': /169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200|fd00:ec2::254/gi,
  'SIG-LOG4J-001': /\$\{\s*(jndi|\$\{lower:j\}|\$\{::-j\})/gi,
  'SIG-MCP-001': /<important>[\s\S]{0,600}(do not|don't|never)\s+(tell|mention|inform|show)|(do not|don't|never)\s+(tell|mention|inform)\s+the\s+user|nie\s+(mów|mow|informuj|wspominaj)\s+(o\s+tym\s+)?użytkownik/gi,
  'SIG-EXFIL-001': /!\[[^\]]{0,200}\]\(\s*https?:\/\/[^)\s]{1,300}[?&][^)\s=]{1,60}=[^)\s]{8,}\)?/gi,
  'SIG-JAILBREAK-001': /\bDAN\b[^\n]{0,80}(do anything now|no limits|jailbr)|do anything now|developer mode (enabled|on|output)|tryb dewelopera/gi,
  'SIG-TPL-001': /(\{\{|\{%)[^}]{0,400}(__class__|__subclasses__|__globals__|__builtins__|__import__|__mro__|os\.popen|subprocess)/g,
  'SIG-KERAS-001': /"class_name"\s*:\s*"Lambda"/g,
  'SIG-ACME-001': /cfo (has )?(already )?approved[^\n]{0,80}(skip|bypass|without)[^\n]{0,40}approv|dyrektor finansowy (już )?zatwierdził[^\n]{0,80}(pomiń|pomin|bez)[^\n]{0,40}zatwierdz/gi,
  'SIG-ACME-002': /\b(evil-mail\.com|zla-poczta\.pl|exfil\.example)\b/gi,
};

const EICAR_SHA256 = '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f';
const UNSAFE_IMPORTS = [/^(os|posix|nt|subprocess|runpy|socket|shutil|pty|webbrowser|requests|urllib2?|httplib|http\.client|sys|importlib|code|commands|pickle|_pickle|marshal|ctypes)\./, /^(__)?builtins?(__)?\.(eval|exec|compile|__import__|getattr|open)$/, /^types\.(CodeType|FunctionType)$/, /^(operator\.attrgetter|torch\.load|numpy\.load|joblib\.load)$/];

type Span = { start: number; end: number; hit: Hit };

function hitFor(signature: ThreatSignature, target: string, evidence: string): Hit {
  const chars = [...evidence];
  const shortened = chars.length > 80 ? `${chars.slice(0, 80).join('')}…` : evidence;
  const { id, name, category, severity, action, references, source } = signature;
  return { id, name, category, severity, action, references, target, source, evidence: shortened };
}

function scanText(target: string, text: string): Span[] {
  const spans: Span[] = [];
  for (const signature of SIGNATURES) {
    const pattern = PATTERNS[signature.id];
    if (!pattern || !signature.targets.includes(target)) continue;
    for (const match of text.matchAll(pattern)) {
      spans.push({ start: match.index, end: match.index + match[0].length, hit: hitFor(signature, target, match[0]) });
    }
  }
  return spans;
}

function dedup(hits: Hit[]): Hit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.id}\n${h.target}\n${h.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface Found {
  class: InputClass;
  label: string;
  masked: string;
  start: number;
  end: number;
}

const digitsOf = (text: string) => text.replace(/\D/g, '');

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

function ibanValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function peselValid(digits: string): boolean {
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

const DETECTORS: { class: InputClass; label: string; pattern: RegExp; check: (match: string) => string | null }[] = [
  {
    class: 'secret',
    label: 'API key',
    pattern: /\b(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    check: (m) => `${m.slice(0, 6)}****`,
  },
  {
    class: 'payment_card',
    label: 'payment card number',
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    check: (m) => {
      const d = digitsOf(m);
      return luhn(d) ? `card ending ${d.slice(-4)}` : null;
    },
  },
  {
    class: 'iban',
    label: 'bank account number (IBAN)',
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
    check: (m) => {
      const iban = m.replace(/ /g, '');
      return ibanValid(iban) ? `${iban.slice(0, 4)} **** ${iban.slice(-4)}` : null;
    },
  },
  {
    class: 'pesel',
    label: 'PESEL number',
    pattern: /\b\d{11}\b/g,
    check: (m) => (peselValid(m) ? `PESEL ending ${m.slice(9)}` : null),
  },
  {
    class: 'email',
    label: 'email address',
    pattern: /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g,
    check: (m) => `${m[0]}***@${m.split('@')[1]}`,
  },
  {
    class: 'phone',
    label: 'phone number',
    pattern: /(?:\+\d{2}[ -]?)?\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g,
    check: (m) => `phone ending ${digitsOf(m).slice(-2)}`,
  },
];

function detect(text: string): Found[] {
  const found: Found[] = [];
  for (const detector of DETECTORS) {
    for (const match of text.matchAll(detector.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      const masked = detector.check(match[0]);
      if (masked) found.push({ class: detector.class, label: detector.label, masked, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function replaceSpans(text: string, spans: { start: number; end: number; token: string }[]): string {
  let out = '';
  let at = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start < at) continue;
    out += text.slice(at, span.start) + span.token;
    at = span.end;
  }
  return out + text.slice(at);
}

const LEXICONS: Record<string, { words: string[]; weight: number }> = {
  override: { words: ['ignor', 'disregard', 'forget', 'overrid', 'bypass', 'zapomnij', 'pomin'], weight: 1.3 },
  prior: { words: ['previous', 'prior', 'earlier', 'above', 'poprzedni', 'wczesniejsz', 'powyzsz'], weight: 0.7 },
  instructions: { words: ['instruction', 'instrukcj', 'rules', 'zasad', 'system prompt', 'prompt systemowy', 'polecen'], weight: 0.9 },
  reveal: { words: ['reveal', 'print', 'show', 'dump', 'pokaz', 'wypisz', 'ujawnij'], weight: 0.6 },
  send: { words: ['send', 'forward', 'upload', 'wyslij', 'przeslij'], weight: 0.4 },
  sensitive: { words: ['customer', 'salar', 'payroll', 'credential', 'password', 'klient', 'hasl', 'wynagrodz'], weight: 0.5 },
  external: { words: ['personal', 'private', 'external', 'gmail', 'prywatn', 'zewnetrzn'], weight: 0.5 },
  execute: { words: ['execute', 'curl', 'wget', 'bash', 'uruchom', 'wykonaj'], weight: 0.6 },
  remote: { words: ['http', 'script', 'payload', 'skrypt'], weight: 0.5 },
  role: { words: ['you are now', 'act as', 'pretend', 'from now on', 'jestes teraz', 'udawaj', 'od teraz'], weight: 0.8 },
  unrestricted: { words: ['no restrictions', 'no limits', 'jailbreak', 'developer mode', 'bez ograniczen', 'tryb dewelopera'], weight: 1.3 },
  concealment: { words: ['do not tell', "don't tell", 'quietly', 'nie mow', 'po cichu'], weight: 1.2 },
};

const COMBOS = [
  ['override', 'prior'],
  ['override', 'instructions'],
  ['reveal', 'instructions'],
  ['send', 'sensitive'],
  ['send', 'external'],
  ['execute', 'remote'],
  ['role', 'unrestricted'],
  ['override', 'prior', 'reveal'],
];

const BIAS = -3;
const COMBO_WEIGHT = 0.6;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

const fold = (text: string) =>
  text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

function readings(text: string): [Variant, string][] {
  const plain = fold(text);
  const out: [Variant, string][] = [['plain', plain]];
  const leet = plain.replace(/[013457@$]/g, (c) => LEET[c] ?? c);
  if (leet !== plain) out.push(['leetspeak', leet]);
  const spaced = plain.replace(/\b(?:\w ){2,}\w\b/g, (m) => m.replace(/ /g, ''));
  if (spaced !== plain) out.push(['spaced_letters', spaced]);
  for (const token of text.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? []) {
    try {
      const decoded = atob(token);
      if (/^[\x20-\x7e\s]+$/.test(decoded)) out.push(['decoded', fold(decoded)]);
    } catch {
      // not base64
    }
  }
  return out;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

function classify(text: string) {
  let best = { score: sigmoid(BIAS), variant: 'plain' as Variant, terms: [] as { term: string; weight: number }[], intents: [] as string[] };
  for (const [variant, reading] of readings(text)) {
    const found = new Map<string, string>();
    for (const [group, { words }] of Object.entries(LEXICONS)) {
      const word = words.find((w) => reading.includes(w));
      if (word) found.set(group, word);
    }
    const intents = COMBOS.filter((combo) => combo.every((g) => found.has(g))).map((combo) => combo.join('+'));
    const logit = BIAS + [...found.keys()].reduce((sum, g) => sum + LEXICONS[g].weight, 0) + intents.length * COMBO_WEIGHT;
    const score = sigmoid(logit);
    if (score > best.score) {
      const terms = [...found].map(([group, term]) => ({ term, weight: round(LEXICONS[group].weight, 3) })).sort((a, b) => b.weight - a.weight);
      best = { score, variant, terms: terms.slice(0, 5), intents };
    }
  }
  return best;
}

function semantic(text: string, profileName: string, thresholds: GuardrailProfile['semantic']): Analyzer {
  const started = performance.now();
  const c = classify(text);
  const verdict = c.score >= thresholds.block_at ? 'malicious' : c.score >= thresholds.review_at ? 'suspicious' : 'clean';
  const rationale =
    `Classifier score ${c.score.toFixed(2)} on the ${c.variant.replace('_', ' ')} reading (profile ${profileName}: review at ${thresholds.review_at.toFixed(2)}, block at ${thresholds.block_at.toFixed(2)})` +
    (c.terms.length ? `; strongest terms: ${c.terms.map((t) => t.term).join(', ')}` : '') +
    (c.intents.length ? `; intents: ${c.intents.join(', ')}` : '');
  return {
    verdict,
    rationale,
    model_label: CLASSIFIER_LABEL,
    score: round(c.score, 3),
    profile: profileName,
    thresholds,
    classifier: {
      id: CLASSIFIER.id,
      version: CLASSIFIER.version,
      latency_ms: round(performance.now() - started, 2),
      detail: { score: round(c.score, 3), variant: c.variant, terms: c.terms, intents: c.intents },
    },
    llm_judge: null,
  };
}

export class MockGuardrailError extends Error {}

export function evaluate(body: EvaluateRequest): Evaluation {
  const started = performance.now();
  const text = body.text ?? '';
  if (!text || [...text].length > 20_000) throw new MockGuardrailError('Text must be 1 to 20000 characters');
  const direction = body.direction ?? 'input';
  if (direction !== 'input' && direction !== 'output') throw new MockGuardrailError('direction is input or output');
  const profileName = body.profile ?? (body.use_case_id ? profileFor(body.use_case_id) : ASSIGNMENTS.default);
  const p = PROFILES[profileName];
  if (!p) throw new MockGuardrailError('Unknown guardrail profile');
  const sem = semantic(text, profileName, p.semantic);
  const all = detect(text);

  if (direction === 'output') {
    const found = all.filter((f) => f.class !== 'resource_above_tier');
    const actionOf = (c: InputClass): GuardrailAction => p.output[c] ?? 'redact';
    const withheld = [...new Set(found.filter((f) => actionOf(f.class) === 'block').map((f) => f.class))].sort();
    const redacted = found.filter((f) => actionOf(f.class) === 'redact');
    let forwarded = replaceSpans(text, redacted.map((f) => ({ start: f.start, end: f.end, token: `[REDACTED:${f.class.toUpperCase()}]` })));
    const spans = scanText('output', forwarded);
    forwarded = replaceSpans(forwarded, spans.filter((s) => s.hit.action === 'block').map((s) => ({ start: s.start, end: s.end, token: `[REMOVED:${s.hit.id}]` })));
    const hits = dedup(spans.map((s) => s.hit));
    const decision = withheld.length
      ? 'withhold'
      : hits.some((h) => h.action === 'review') || sem.verdict !== 'clean'
        ? 'flag_untrusted'
        : redacted.length || hits.some((h) => h.action === 'block')
          ? 'allow_redacted'
          : 'allow';
    return {
      decision,
      direction,
      profile: profileName,
      policy_version: MOCK_POLICY_VERSION,
      findings: found.map((f) => ({ class: f.class, label: f.label, masked: f.masked, action: actionOf(f.class) })),
      forwarded_text: forwarded,
      withheld_classes: withheld,
      signatures: hits,
      semantic: sem,
      latency_ms: round(performance.now() - started, 2),
    };
  }

  const actionOf = (c: InputClass): GuardrailAction => p.input[c] ?? 'block';
  const redacted = all.filter((f) => actionOf(f.class) === 'redact');
  const forwarded = replaceSpans(text, redacted.map((f) => ({ start: f.start, end: f.end, token: `[REDACTED:${f.class.toUpperCase()}]` })));
  const hits = dedup(scanText('prompt', text).map((s) => s.hit));
  const decision =
    all.some((f) => actionOf(f.class) === 'block') || hits.some((h) => h.action === 'block') || sem.verdict === 'malicious'
      ? 'block'
      : sem.verdict === 'suspicious' || hits.some((h) => h.action === 'review')
        ? 'flag_untrusted'
        : redacted.length
          ? 'allow_redacted'
          : 'allow';
  return {
    decision,
    direction,
    profile: profileName,
    policy_version: MOCK_POLICY_VERSION,
    findings: all.map((f) => ({ class: f.class, label: f.label, masked: f.masked, action: actionOf(f.class) })),
    forwarded_text: forwarded,
    withheld_classes: [],
    signatures: hits,
    semantic: sem,
    latency_ms: round(performance.now() - started, 2),
  };
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function pickleImports(text: string): string[] {
  const imports = new Set<string>();
  for (const m of text.matchAll(/c([A-Za-z_][\w.]*)\n([A-Za-z_][\w.]*)\n/g)) imports.add(`${m[1]}.${m[2]}`);
  for (const m of text.matchAll(/\x8c[\s\S]([A-Za-z_][\w.]*)\x94?\x8c[\s\S]([A-Za-z_][\w.]*)\x94?\x93/g)) imports.add(`${m[1]}.${m[2]}`);
  return [...imports];
}

export async function scanArtifact(body: ArtifactScanRequest): Promise<ArtifactScan> {
  const started = performance.now();
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decodeBase64(body.content_base64);
  } catch {
    throw new MockGuardrailError('content_base64 is not base64');
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  const text = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const head = text.slice(0, 4);
  const format =
    head === 'PK\x03\x04' ? 'zip' : head === 'GGUF' ? 'gguf' : head === '\x89HDF' ? 'hdf5' : bytes[0] === 0x80 && bytes[1] >= 2 && bytes[1] <= 5 ? 'pickle' : 'unknown';
  const imports = format === 'pickle' || format === 'zip' ? pickleImports(text) : [];
  const byId = new Map(SIGNATURES.map((s) => [s.id, s]));
  const hits: Hit[] = [];
  for (const name of imports) {
    if (UNSAFE_IMPORTS.some((pattern) => pattern.test(name))) hits.push(hitFor(byId.get('SIG-PICKLE-001')!, 'model_file', name));
  }
  hits.push(...scanText('model_file', text).map((s) => s.hit));
  const templates = [...text.matchAll(/"chat_template"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
  for (const template of templates) hits.push(...scanText('model_template', template).map((s) => s.hit));
  if (hex === EICAR_SHA256) hits.push(hitFor(byId.get('SIG-HASH-001')!, 'model_file', `sha256:${hex}`));
  const unique = dedup(hits);
  return {
    name: body.name,
    size: bytes.length,
    sha256: `sha256:${hex}`,
    verdict: unique.some((h) => h.action === 'block') ? 'block' : unique.length ? 'review' : 'clean',
    artifact: { format, pickle_imports: imports, chat_templates: templates.length, members_scanned: format === 'zip' ? text.split('PK\x01\x02').length - 1 : 0 },
    signatures: unique,
    latency_ms: round(performance.now() - started, 2),
  };
}

const CLASSIFIER: GuardrailsStatus['classifier'] = {
  id: 'betsee-injection-ngram',
  version: '2026.10.04',
  sha256: fakeSha('models/injection-classifier.json'),
  format: 'betsee-ngram-lr/2',
  features: 59096,
  training: {
    examples: 7375,
    handwritten: { attack: 269, benign: 244 },
    templated: { attack: 740, benign: 732 },
    public_datasets: {
      attack: 1785,
      benign: 3605,
      sources: [
        'deepset/prompt-injections (Apache-2.0)',
        'Lakera/gandalf_ignore_instructions (MIT)',
        'jackhhao/jailbreak-classification (Apache-2.0)',
        'OpenAssistant/oasst1 initial prompts, en/pl/de (Apache-2.0)',
      ],
    },
    languages: ['pl', 'en', 'de'],
    algorithm: 'logistic regression over hashed word, word-bigram and character 3-5-gram features',
  },
  evaluation: {
    cross_validated_handwritten: [
      { threshold: 0.5, precision: 0.914, recall: 0.755, false_positive_rate: 0.078, tp: 203, fp: 19, fn: 66, tn: 225 },
      { threshold: 0.6, precision: 0.93, recall: 0.691, false_positive_rate: 0.057, tp: 186, fp: 14, fn: 83, tn: 230 },
      { threshold: 0.7, precision: 0.974, recall: 0.55, false_positive_rate: 0.016, tp: 148, fp: 4, fn: 121, tn: 240 },
      { threshold: 0.8, precision: 0.984, recall: 0.461, false_positive_rate: 0.008, tp: 124, fp: 2, fn: 145, tn: 242 },
      { threshold: 0.9, precision: 0.989, recall: 0.323, false_positive_rate: 0.004, tp: 87, fp: 1, fn: 182, tn: 243 },
    ],
    holdout: [
      { threshold: 0.5, precision: 0.933, recall: 0.824, false_positive_rate: 0.062, tp: 28, fp: 2, fn: 6, tn: 30 },
      { threshold: 0.6, precision: 0.929, recall: 0.765, false_positive_rate: 0.062, tp: 26, fp: 2, fn: 8, tn: 30 },
      { threshold: 0.7, precision: 0.962, recall: 0.735, false_positive_rate: 0.031, tp: 25, fp: 1, fn: 9, tn: 31 },
      { threshold: 0.8, precision: 1, recall: 0.676, false_positive_rate: 0, tp: 23, fp: 0, fn: 11, tn: 32 },
      { threshold: 0.9, precision: 1, recall: 0.559, false_positive_rate: 0, tp: 19, fp: 0, fn: 15, tn: 32 },
    ],
  },
};

const POLICY_FILES = [
  '00-capability.cedar',
  '10-identity.cedar',
  '20-tier.cedar',
  '25-runtime.cedar',
  '30-tools.cedar',
  '40-a2a.cedar',
  '45-input.cedar',
  '46-files.cedar',
  '47-threats.cedar',
  '48-models.cedar',
  '50-runtime.cedar',
  '60-approval.cedar',
  '70-analyzer.cedar',
  '80-delegation.cedar',
  '90-templates.cedar',
  'controls.yaml',
  'guardrails.yaml',
  'schema.cedarschema',
  'models/injection-classifier.json',
  'threat-feed/baseline.json',
];

/** A stable fake digest per path, so the mock's file list looks like the live one without claiming real hashes. */
function fakeSha(path: string): string {
  let h = 0x811c9dc5;
  let out = '';
  for (let pass = 0; out.length < 64; pass++) {
    for (const ch of `${path}#${pass}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
}

export function guardrailsStatus(startedAt: string): GuardrailsStatus {
  const now = new Date().toISOString();
  return {
    policy: { version: MOCK_POLICY_VERSION, loaded_at: startedAt, files: POLICY_FILES.map((path) => ({ path, sha256: fakeSha(path) })) },
    reload: { active_version: MOCK_POLICY_VERSION, loaded_at: startedAt, reloads: 0, last_checked_at: now, last_rejected_at: null, last_error: null },
    guardrails: {
      version: 1,
      profiles: PROFILES,
      assignments: ASSIGNMENTS,
      semantic: { model: 'models/injection-classifier.json', llm_judge: false, scan_tool_output: true },
      signatures: { baseline: 'threat-feed/baseline.json', feed_url: 'http://caddy:8090/feed.json', poll_seconds: 10 },
      models: [
        { id: 'mock-llm', label: 'Acme local model (demo mock)', provider: 'local', enabled: true, input_cents_per_1k: 0, output_cents_per_1k: 0, compute_cents_per_second: 2, max_output_tokens: 256 },
        { id: 'gpt-4o-mini', label: 'OpenAI gpt-4o-mini (served by the demo mock)', provider: 'external', enabled: true, input_cents_per_1k: 0.015, output_cents_per_1k: 0.06, compute_cents_per_second: 0, max_output_tokens: 512 },
        { id: 'claude-sonnet', label: 'Anthropic Claude Sonnet (served by the demo mock)', provider: 'external', enabled: true, input_cents_per_1k: 0.3, output_cents_per_1k: 1.5, compute_cents_per_second: 0, max_output_tokens: 512 },
        { id: 'unvetted-model', label: 'Community model awaiting review', provider: 'external', enabled: false, input_cents_per_1k: 0, output_cents_per_1k: 0, compute_cents_per_second: 0, max_output_tokens: 256 },
      ],
      budgets: {
        max_session_cents: 5000,
        sessions: { default: { cents: 5000, tokens: 50000 }, use_cases: { 'weekly-reporting': { cents: 2000, tokens: 20000 } } },
        action_cost_cents: { default: 10, 'agent.message': 2, 'files.read': 5 },
      },
      supply_chain: {
        allowed_orgs: ['meta-llama', 'mistralai', 'Qwen', 'google', 'microsoft', 'ibm-granite', 'BAAI', 'sentence-transformers'],
        safe_formats: ['safetensors', 'gguf', 'onnx', 'json', 'txt', 'model', 'tiktoken'],
        unsafe_formats: ['bin', 'pt', 'pth', 'pkl', 'pickle', 'ckpt', 'joblib', 'h5', 'keras', 'npy', 'npz'],
        require_pinned_revision: true,
        forbid_trust_remote_code: true,
        typosquat_distance: 2,
      },
    },
    classifier: CLASSIFIER,
    signatures: {
      count: SIGNATURE_COUNT,
      baseline: { feed: 'betsee-baseline', version: '2026.10.04.1', signatures: SIGNATURES.filter((s) => s.source === 'baseline').length },
      external: { feed: 'acme-soc-threat-intel', version: '2026.10.04.2', published_at: '2026-10-04T06:00:00Z', signatures: SIGNATURES.filter((s) => s.source === 'feed').length },
      signatures: SIGNATURES,
    },
    feed: {
      url: 'http://caddy:8090/feed.json',
      last_fetch_at: now,
      last_success_at: now,
      last_error: null,
      version: '2026.10.04.2',
      sha256: fakeSha('feed.json'),
      updates: 1,
    },
  };
}

const MODEL_TOKENS = 640;

/** What an executed mock action cost; model calls also spend tokens. */
export function actionCost(capability: string, sessionUsedCents: number): ActionCost {
  const tokens = capability === 'llm.complete' ? MODEL_TOKENS : 0;
  return { cents: COST_CENTS[capability] ?? 10, tokens, seconds: tokens ? 0.42 : 0.02, session_used_cents: sessionUsedCents, session_tokens_used: tokens };
}

export function summaryGuardrails(recent: readonly Trace[]): SummaryGuardrails {
  const latencies = recent.map((t) => t.latency_ms).filter((l) => l > 0).sort((a, b) => a - b);
  const pick = (p: number) => (latencies.length ? round(latencies[Math.round((latencies.length - 1) * p)]!, 1) : null);
  return {
    redactions_last_15m: recent.reduce((sum, t) => sum + (t.guardrails?.redactions?.length ?? 0) + (t.output_filter?.redactions.length ?? 0), 0),
    signature_hits_last_15m: recent.filter((t) => (t.guardrails?.signatures?.length ?? 0) + (t.output_filter?.signatures.length ?? 0) > 0).length,
    semantic_flags_last_15m: recent.filter((t) => t.analyzer.verdict === 'suspicious' || t.analyzer.verdict === 'malicious').length,
    spent_cents_last_15m: round(recent.reduce((sum, t) => sum + (t.cost?.cents ?? 0), 0), 2),
    tokens_last_15m: recent.reduce((sum, t) => sum + (t.cost?.tokens ?? 0), 0),
    latency_ms: { p50: pick(0.5), p95: pick(0.95), samples: latencies.length },
    policy_version: MOCK_POLICY_VERSION,
  };
}
