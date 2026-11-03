import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadLockModule() {
  const original = readFileSync("src/lib/marketplace/orderMutationLock.ts", "utf8");
  const compiled = ts.transpileModule(original, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const commonJsFixture = { exports: {} };
  const run = vm.runInNewContext(`(function (module, exports) {\n${compiled}\n})`);
  run(commonJsFixture, commonJsFixture.exports);
  return commonJsFixture.exports;
}

const { lockMannaOrderRow, lockMannaOrderAndDenyRefundIntent } = loadLockModule();

function fixture(options = {}) {
  const calls = [];
  const tx = {
    $queryRaw: async (parts, ...values) => {
      calls.push({ kind: "lock", sql: parts.join("?"), values });
      return options.rows ?? [{ id: values[0] }];
    },
    orderRefund: {
      findUnique: async (request) => {
        calls.push({ kind: "refund", request });
        return options.refund ?? null;
      },
    },
  };
  return { calls, tx };
}

test("order lock uses transaction-scoped parameterized SELECT FOR UPDATE", async () => {
  const { calls, tx } = fixture();
  const orderId = "order_'__test_?";
  await lockMannaOrderRow(tx, orderId);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SELECT\s+"id"\s+FROM\s+"Order"\s+WHERE\s+"id"\s*=\s*\?\s+FOR\s+UPDATE/);
  assert.deepEqual(Array.from(calls[0].values), [orderId]);
  assert.equal(calls[0].sql.includes(orderId), false);
});

test("missing or unexpected row fails closed", async () => {
  const { tx } = fixture({ rows: [] });
  await assert.rejects(lockMannaOrderRow(tx, "missing"), /missing or ambiguous/);
  const wrong = fixture({ rows: [{ id: "other" }] });
  await assert.rejects(lockMannaOrderRow(wrong.tx, "wanted"), /missing or ambiguous/);
});

test("vendor dispatch and finance guard checks refund within same tx AFTER locking", async () => {
  const { calls, tx } = fixture();
  await lockMannaOrderAndDenyRefundIntent(tx, "order-1");
  assert.deepEqual(calls.map((c) => c.kind), ["lock", "refund"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].request)), {
    where: { orderId: "order-1" }, select: { id: true, status: true },
  });
});

test("any refund intent blocks later automatic operations (including failed)", async () => {
  for (const status of ["REQUESTED", "PROCESSING", "PROCESSED", "FAILED", "UNKNOWN"]) {
    const { tx } = fixture({ refund: { id: "r-1", status } });
    await assert.rejects(lockMannaOrderAndDenyRefundIntent(tx, "order-1"), /refund intent/);
  }
});

test("blank order identifiers cannot acquire a lock", async () => {
  const { calls, tx } = fixture();
  await assert.rejects(lockMannaOrderRow(tx, "  "), /Order ID required/);
  assert.equal(calls.length, 0);
});

test("V14R4B2B1 keeps refund and legacy dispatch unwired while staging primary charge locks", () => {
  for (const file of [
    "src/app/api/admin/orders/[id]/cancel/route.ts",
    "src/lib/delivery/createDeliveryFromOrder.ts",
  ]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /lockMannaOrderAndDenyRefundIntent|lockMannaOrderRow|guardV14OrderMutationIfReleased/);
  }
  const primaryPaystack = readFileSync("src/app/api/webhooks/paystack/route.ts", "utf8");
  assert.match(primaryPaystack, /guardV14OrderMutationIfReleased/);
  assert.doesNotMatch(primaryPaystack, /createPaystackRefund|requestPaystackRefund/);
  const releaseGuard = readFileSync("src/lib/marketplace/orderV14ReleaseGuard.ts", "utf8");
  assert.match(releaseGuard, /const V14_GLOBAL_CROSS_PATH_RELEASED = false/);
  assert.match(readFileSync("src/lib/marketplace/vendorSettlement.ts", "utf8"), /guardV14OrderMutationIfReleased/);
  assert.match(readFileSync("src/lib/marketplace/vendorWithdrawal.ts", "utf8"), /guardWithdrawalOrderSetIfReleased/);
});
