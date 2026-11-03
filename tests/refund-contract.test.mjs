import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadModule(file, env, mockFetch = async () => {
  throw new Error("Network must never be called by this test");
}) {
  const source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const commonJsFixture = { exports: {} };
  const fn = vm.runInNewContext(
    `(function (module, exports) {
${compiled}
})`,
    {
      process: { env },
      fetch: mockFetch,
      AbortController,
      setTimeout,
      clearTimeout,
    }
  );
  fn(commonJsFixture, commonJsFixture.exports);
  return commonJsFixture.exports;
}

test("refund event parser requires exact NGN amount and transaction reference", () => {
  const { parsePaystackRefundEvent } = loadModule("src/lib/paystack/refundEvents.ts", {});
  const item = parsePaystackRefundEvent({
    event: "refund.pending",
    data: { transaction_reference: "tx_1", amount: "10000", currency: "NGN" },
  });
  assert.equal(item.transactionReference, "tx_1");
  assert.equal(item.amountKobo, 10000);
  assert.equal(parsePaystackRefundEvent({event: "charge.success", data: {}}), null);
  assert.equal(parsePaystackRefundEvent({event: "refund.processed", data: {transaction_reference: "t", amount: "-1", currency: "NGN"}}), null);
  assert.equal(parsePaystackRefundEvent({event: "refund.processed", data: {transaction_reference: "t", amount: "100", currency: "USD"}}), null);
});

test("Paystack full refund request omits partial amount and verifies response", async () => {
  let captured;
  const mockFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({
      status: true, data: { id: 77, status: "pending", amount: 50000, currency: "NGN" },
    })};
  };
  const { createPaystackFullRefund } = loadModule(
    "src/lib/paystack/refunds.ts", { PAYSTACK_MODE: "test", PAYSTACK_SECRET_KEY_TEST: "sk_test_FAKE" }, mockFetch
  );
  const answer = await createPaystackFullRefund({ transactionReference: "tx_test", expectedAmountKobo: 50000 });
  assert.equal(answer.status, "pending");
  assert.equal(answer.providerRefundId, "77");
  assert.equal(captured.url, "https://api.paystack.co/refund");
  assert.equal(captured.opts.method, "POST");
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.transaction, "tx_test");
  assert.equal(Object.hasOwn(body, "amount"), false);
});

test("refund uncertain network failure cannot be blindly retried", async () => {
  const { createPaystackFullRefund } = loadModule(
    "src/lib/paystack/refunds.ts", { PAYSTACK_MODE: "test", PAYSTACK_SECRET_KEY_TEST: "sk_test_FAKE" },
    async () => { throw new Error("simulated timeout"); }
  );
  await assert.rejects(
    createPaystackFullRefund({ transactionReference: "tx_test", expectedAmountKobo: 10000 }),
    (error) => error.uncertain === true
  );
});

test("live refund cannot run without explicit operational release gate", async () => {
  const { createPaystackFullRefund } = loadModule(
    "src/lib/paystack/refunds.ts", { PAYSTACK_MODE: "live", PAYSTACK_SECRET_KEY_LIVE: "sk_live_FAKE" }
  );
  await assert.rejects(
    createPaystackFullRefund({ transactionReference: "tx_test", expectedAmountKobo: 10000 }),
    (error) => error.uncertain === false && /disabled/.test(error.message)
  );
});

test("existing paid-order cancellation and transfer safety code is retained", () => {
  assert.match(readFileSync("src/app/api/admin/orders/[id]/cancel/route.ts", "utf8"), /PAID_ORDER_REFUND_REQUIRED/);
  assert.match(readFileSync("src/lib/marketplace/vendorWithdrawal.ts", "utf8"), /reservedWithdrawalNgn/);
  assert.match(readFileSync("src/lib/marketplace/vendorSettlement.ts", "utf8"), /WITHDRAWAL_PENDING/);
});
