import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldChat, type ChatEvent } from './chat.ts';

const at = '2026-10-03T20:00:00Z';
const e = (id: number, type: string, fields: Record<string, unknown> = {}): ChatEvent => ({ id, type, at, ...fields });

test('a tool decision that arrives before the tool_use line lands on the same card', () => {
  const thread = foldChat([
    e(1, 'user_message', { message_id: 'm1', text: 'read it', trace_id: 't0' }),
    e(2, 'run_started', { model: 'claude' }),
    e(3, 'decision', { tool_use_id: 'u1', tool: 'Read', capability: 'files.read', decision: 'allow', reasons: ['ok'], control_ids: ['CTL-CAP-001'], trace_id: 't1', resource: { id: 'workspace/a.md' } }),
    e(4, 'tool_call', { tool_use_id: 'u1', tool: 'Read', input: { file_path: 'a.md' } }),
    e(5, 'tool_result', { tool_use_id: 'u1', is_error: false, content: 'hello' }),
    e(6, 'assistant_text', { text: 'It says hello.' }),
    e(7, 'idle'),
  ]);
  assert.equal(thread.items.length, 3);
  const tool = thread.items[1];
  assert.equal(tool.kind, 'tool');
  if (tool.kind !== 'tool') return;
  assert.equal(tool.decision?.decision, 'allow');
  assert.equal(tool.decision?.traceId, 't1');
  assert.deepEqual(tool.input, { file_path: 'a.md' });
  assert.equal(tool.result?.content, 'hello');
  assert.equal(thread.busy, false);
});

test('an approval wait is kept apart from the final decision', () => {
  const thread = foldChat([
    e(1, 'tool_call', { tool_use_id: 'w', tool: 'Write', input: {} }),
    e(2, 'decision', { tool_use_id: 'w', decision: 'require_approval', approval_state: 'pending', trace_id: 't', waiting_seconds: 150 }),
  ]);
  const tool = thread.items[0];
  assert.ok(tool.kind === 'tool' && tool.waiting?.waitingSeconds === 150 && tool.decision === null);
  const done = foldChat([
    e(1, 'tool_call', { tool_use_id: 'w', tool: 'Write', input: {} }),
    e(2, 'decision', { tool_use_id: 'w', decision: 'require_approval', approval_state: 'pending', trace_id: 't' }),
    e(3, 'decision', { tool_use_id: 'w', decision: 'allow', approval_state: 'approved', trace_id: 't' }),
  ]).items[0];
  assert.ok(done.kind === 'tool' && done.decision?.decision === 'allow' && done.waiting !== null);
});

test('a blocked message shows the text only this browser typed', () => {
  const event = e(1, 'input_blocked', { message_id: 'm', reasons: ['the message contains a payment card number'], control_ids: ['CTL-IN-001'], trace_id: 't', findings: [{ class: 'payment_card', label: 'payment card number', masked: 'card ending 1111' }] });
  const local = foldChat([event], new Map([['m', 'my card 4111 1111 1111 1111']])).items[0];
  assert.ok(local.kind === 'blocked' && local.text === 'my card 4111 1111 1111 1111' && local.controlIds[0] === 'CTL-IN-001');
  const elsewhere = foldChat([event]).items[0];
  assert.ok(elsewhere.kind === 'blocked' && elsewhere.text === null);
});
