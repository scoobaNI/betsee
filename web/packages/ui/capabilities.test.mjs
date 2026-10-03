import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityIntersection } from './src/capabilities.ts';

test('a human privilege never substitutes for an agent delegation', () => {
  assert.deepEqual(capabilityIntersection(['crm.read'], ['crm.read', 'files.read', 'payments.transfer']), ['crm.read']);
});
test('policy removes delegated capabilities and duplicates add no authority', () => {
  assert.deepEqual(capabilityIntersection(['crm.read', 'crm.read', 'payments.transfer'], ['crm.read']), ['crm.read']);
});
test('an empty policy or delegation fails closed', () => {
  assert.deepEqual(capabilityIntersection(['payments.transfer'], []), []);
  assert.deepEqual(capabilityIntersection([], ['payments.transfer']), []);
});
