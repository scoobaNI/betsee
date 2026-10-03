// Copy of docs/security/owasp-mapping.md, "What Betsee deliberately does not claim" (security-architect).
// The coverage view shows it so a row never overstates a mitigation. Keep in step with that table.
export interface NotClaimed {
  mitigation: string;
  betsee: string;
}

const ROWS: { asi: string[]; mitigation: string; betsee: string }[] = [
  {
    asi: ['ASI01'],
    mitigation: 'intent capsules, goal-drift monitoring',
    betsee: 'Not built. Betsee contains the effects of a hijack (tiers, capabilities, approval) instead of detecting the hijack.',
  },
  {
    asi: ['ASI02', 'ASI05'],
    mitigation: 'sandboxed execution, dry runs, egress allowlists',
    betsee: 'Command templates only. The demo host does not execute arbitrary shell. Egress allowlisting is v1.',
  },
  {
    asi: ['ASI03'],
    mitigation: 'just-in-time downstream credentials; token exchange',
    betsee: 'Agents never hold connector credentials (the Gateway does). RFC 8693 token exchange is the documented scale path.',
  },
  { asi: ['ASI04'], mitigation: 'signed manifests, AIBOM', betsee: 'Hash pinning, with re-pinning by an admin. Signatures and AIBOM are v1.' },
  { asi: ['ASI06'], mitigation: 'memory expiry and rollback, trust scores', betsee: 'Labelled memory only.' },
  {
    asi: ['ASI07'],
    mitigation: 'mTLS, signed messages, anti-replay between agents',
    betsee: 'Agents never talk directly. The Gateway authenticates the sender by token. In-cluster mTLS is v1.',
  },
  {
    asi: ['ASI08', 'ASI10'],
    mitigation: 'tamper-evident lineage logs, signed audit logs',
    betsee:
      'Append-only triggers on the audit tables stop bugs, not a compromised Gateway: its database role owns those tables. An insert-only role, hash-chained or signed rows and an external log sink are v1.',
  },
  { asi: ['ASI10'], mitigation: 'watchdog agents, behavioural manifests, attestation', betsee: 'Quarantine, kill switch and human release only.' },
];

export function notClaimed(asiId: string): NotClaimed[] {
  return ROWS.filter((r) => r.asi.includes(asiId)).map(({ mitigation, betsee }) => ({ mitigation, betsee }));
}
