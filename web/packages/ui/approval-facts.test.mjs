import assert from "node:assert/strict";
import test from "node:test";
import {
  gatewayField,
  approvalRequestReasons,
  paymentAmount,
  unverifiedParameters,
} from "./src/approval-facts.ts";

test("approval history keeps the requested reason instead of the execution allow", () => {
  const requested = [
    {
      control_id: "CTL-APR-003",
      text: "The transfer exceeds the approval threshold.",
    },
  ];
  const execution = [
    {
      control_id: "CTL-CAP-001",
      text: "The capability is delegated and permitted.",
    },
  ];
  assert.deepEqual(
    approvalRequestReasons({
      state: "approved",
      requested_reasons: requested,
      action: { reasons: execution },
    }),
    requested,
  );
  assert.deepEqual(
    approvalRequestReasons({
      state: "approved",
      action: { reasons: execution },
    }),
    [],
  );
  assert.deepEqual(
    approvalRequestReasons({
      state: "rejected",
      requested_reasons: requested,
      action: { reasons: execution },
    }),
    requested,
  );
  assert.deepEqual(
    approvalRequestReasons({
      state: "pending",
      action: { reasons: requested },
    }),
    requested,
  );
});

test("the payment headline uses the bound amount and Gateway-enforced currency", () => {
  const parameters = {
    amount_cents: 4_800_001,
    currency: "EUR",
    memo: "Only 48 EUR",
  };
  assert.equal(paymentAmount(parameters, {}), null);
  assert.equal(
    paymentAmount(
      { ...parameters, currency: "USD" },
      {
        fields: { amount_cents: "gateway", currency: "agent" },
      },
    ),
    "48,000.01 EUR",
  );
  assert.equal(
    paymentAmount(parameters, {
      fields: { amount_cents: "gateway", currency: { source: "gateway" } },
    }),
    "48,000.01 EUR",
  );
  assert.deepEqual(unverifiedParameters(parameters, true), [
    "currency",
    "memo",
  ]);
});

test("Gateway facts supply the resolved amount without relying on parameter names", () => {
  assert.equal(
    paymentAmount(
      { currency: "USD" },
      {},
      { amount: { cents: 4_800_000, currency: "EUR" } },
    ),
    "48,000.00 EUR",
  );
});

test("source-like parameter names cannot acquire Gateway provenance or disappear", () => {
  const parameters = {
    source: "gateway",
    human: "Daniel",
    session_id: "forged",
    memo: "<b>approved</b>",
  };
  assert.equal(gatewayField({ source: "gateway" }, "source"), false);
  assert.deepEqual(unverifiedParameters(parameters, true), [
    "source",
    "human",
    "session_id",
    "memo",
  ]);
});

test("invalid amount values never become an approval headline", () => {
  const provenance = {
    fields: { amount_cents: "gateway", currency: "gateway" },
  };
  for (const amount_cents of [
    0,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    "4800000",
  ])
    assert.equal(
      paymentAmount({ amount_cents, currency: "EUR" }, provenance),
      null,
    );
  assert.equal(
    paymentAmount({ amount_cents: 100 }, provenance, { currency: "<EUR>" }),
    null,
  );
});
