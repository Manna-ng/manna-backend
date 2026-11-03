import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("src/lib/marketplace/orderRefundPolicy.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(`(function(module,exports){${compiled}\n})`)(mod, mod.exports);
const { assessRefundPreview, refundWebhookRequiresProviderReconciliation } = mod.exports;

function ready() {
  return {
    order: { id: "ord_1", status: "PROCESSING", paymentStatus: "PAID",
      paymentProvider: "PAYSTACK", paymentReference: "pay_1", totalAmountNgn: 5000 },
    attempts: [{ provider: "PAYSTACK", reference: "pay_1", amountNgn: 5000,
      currency: "NGN", status: "PENDING" }],
    vendorOrders: [{ status: "AWAITING_VENDOR", confirmedAt: null,
      packingStartedAt: null, readyForPickupAt: null, pickedUpAt: null }],
    delivery: { status: "CREATED", processingStatus: "QUEUED", kwikTaskId: null,
      kwikUniqueOrderId: null, lastWebhookAt: null },
    vendorSettlementCount: 0, kwikTaskCount: 0, existingRefund: null,
  };
}
function blockers(change) {
  return assessRefundPreview(Object.assign(ready(), change)).blockers;
}

test("pristine paid Paystack order is preview-eligible but never provider-authorized", () => {
  const p = assessRefundPreview(ready());
  assert.equal(p.eligibleForManualReview, true);
  assert.equal(p.expectedAmountKobo, 500000);
  assert.equal(p.canCallProvider, false);
  assert.equal(p.requiresFreshPaystackChargeVerification, true);
  assert.equal(p.requiresTransactionalOrderAndDispatchLock, true);
});
test("unpaid and delivered orders cannot be previewed for automatic refund", () => {
  assert.ok(blockers({order: {...ready().order, paymentStatus: "PENDING"}}).includes("ORDER_NOT_PAID"));
  assert.ok(blockers({order: {...ready().order, status: "DELIVERED"}}).includes("ORDER_NOT_PROCESSING"));
});
test("another payment provider is blocked", () => {
  assert.ok(blockers({order: {...ready().order, paymentProvider: "FLUTTERWAVE"}}).includes("NOT_PAYSTACK"));
});
test("payment attempt must match exact full order reference, currency and amount", () => {
  assert.ok(blockers({attempts:[{...ready().attempts[0],amountNgn:4999}]}).includes("PAYMENT_ATTEMPT_MISMATCH"));
  assert.ok(blockers({attempts:[{...ready().attempts[0],currency:"USD"}]}).includes("PAYMENT_ATTEMPT_MISMATCH"));
  assert.ok(blockers({attempts:[]}).includes("PAYMENT_ATTEMPT_MISMATCH"));
});
test("duplicate payment attempt identity is not silently accepted", () => {
  assert.ok(blockers({attempts:[...ready().attempts,...ready().attempts]}).includes("PAYMENT_ATTEMPT_AMBIGUOUS"));
});
test("existing refund intent prevents a second refund", () => {
  assert.ok(blockers({existingRefund:{status:"REQUESTED"}}).includes("REFUND_ALREADY_EXISTS"));
});
test("vendor settlements of ANY status block the no-liability refund path", () => {
  assert.ok(blockers({vendorSettlementCount:1}).includes("VENDOR_SETTLEMENT_EXISTS"));
});
test("vendor preparation and pickup block the no-dispatch refund path", () => {
  assert.ok(blockers({vendorOrders:[{...ready().vendorOrders[0],confirmedAt:new Date()}]}).includes("VENDOR_ORDER_IN_PROGRESS"));
  assert.ok(blockers({vendorOrders:[{...ready().vendorOrders[0],status:"READY_FOR_PICKUP"}]}).includes("VENDOR_ORDER_IN_PROGRESS"));
});
test("Kwik dispatched, unknown state, or any task blocks auto flow", () => {
  assert.ok(blockers({kwikTaskCount:1}).includes("KWIK_TASK_EXISTS"));
  assert.ok(blockers({delivery:{...ready().delivery,processingStatus:"DISPATCHED"}}).includes("DELIVERY_IN_PROGRESS"));
  assert.ok(blockers({delivery:{...ready().delivery,kwikUniqueOrderId:"123"}}).includes("DELIVERY_IN_PROGRESS"));
});
test("amount must be NGN whole integer and safe in kobo", () => {
  assert.ok(blockers({order:{...ready().order,totalAmountNgn:0}}).includes("INVALID_NGN_AMOUNT"));
  assert.ok(blockers({order:{...ready().order,totalAmountNgn:Number.MAX_SAFE_INTEGER}}).includes("INVALID_NGN_AMOUNT"));
});
test("signed refund webhook never proves processed payment by itself", () => {
  for (const event of ["refund.pending","refund.processing","refund.needs-attention","refund.failed","refund.processed"]) {
    assert.equal(refundWebhookRequiresProviderReconciliation(event),true);
  }
  assert.equal(refundWebhookRequiresProviderReconciliation("charge.success"),false);
});
test("readiness is unexposed and read-only; old Paystack webhook is untouched", () => {
  const s=readFileSync("src/lib/marketplace/orderRefundReadiness.ts","utf8");
  assert.match(s,/readOrderRefundPreview/);
  assert.doesNotMatch(s,/\.(create|update|upsert|delete|executeRaw)\(/);
  assert.doesNotMatch(s,/createPaystackFullRefund/);
  const webhook=readFileSync("src/app/api/webhooks/paystack/route.ts","utf8");
  assert.doesNotMatch(webhook,/refund\.processed/);
});
