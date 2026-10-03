import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionBuckets } from './src/decision-buckets.ts';

const now = Date.parse('2026-10-03T20:30:30Z');
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

test('decisions fall into one-minute buckets of the last 15 minutes, oldest first', () => {
  const buckets = decisionBuckets(
    [
      { occurred_at: at(0), decision: 'allow' },
      { occurred_at: at(0), decision: 'deny' },
      { occurred_at: at(1), decision: 'require_approval', approval_state: 'pending' },
      { occurred_at: at(2), decision: 'require_approval', approval_state: 'approved' },
      { occurred_at: at(3), decision: 'require_step_up', approval_state: 'rejected' },
      { occurred_at: at(4), decision: 'require_approval', approval_state: 'voided' },
      { occurred_at: at(0), decision: 'allow', record_type: 'tool_observation' },
      { occurred_at: at(20), decision: 'allow' },
    ],
    now,
  );
  assert.equal(buckets.length, 15);
  const last = buckets[14];
  assert.deepEqual([last.allow, last.deny, last.approval], [1, 1, 0]);
  assert.equal(buckets[13].approval, 1);
  assert.equal(buckets[12].allow, 1);
  assert.equal(buckets[11].deny, 1);
  assert.equal(buckets[10].deny, 1);
  const total = buckets.reduce((sum, b) => sum + b.allow + b.deny + b.approval, 0);
  assert.equal(total, 6, 'observations and older actions are left out');
});
