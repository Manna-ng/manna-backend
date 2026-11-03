import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const main = readFileSync("src/app/api/webhooks/paystack/route.ts", "utf8");
const gate = readFileSync("src/lib/marketplace/orderV14ReleaseGuard.ts", "utf8");
const legacy = readFileSync("src/lib/delivery/createDeliveryFromOrder.ts", "utf8");

test("V14 primary Paystack charge path is locked before stock and order mutation", () => {
  const segment = main.slice(main.indexOf('await prisma.$transaction(async (tx) => {', main.indexOf('export async function POST')),
    main.indexOf('const changedVariantIds'));
  assert.match(segment, /await guardV14OrderMutationIfReleased\(tx, order\.id\);/);
  assert.match(segment, /current\.paymentReference !== reference/);
  assert.match(segment, /current\.paymentStatus !== "PENDING"/);
  assert.ok(segment.indexOf('guardV14OrderMutationIfReleased') < segment.indexOf('tx.productVariant.updateMany'));
  assert.ok(segment.indexOf('tx.order.findUnique') < segment.indexOf('tx.productVariant.updateMany'));
});

test("marketplace delivery preparation validates PAID in the same order lock transaction", () => {
  const segment = main.slice(main.indexOf('async function markMarketplaceOrderReadyForVendorPreparation'),
    main.indexOf('async function prepareMarketplaceOrderForVendors'));
  assert.match(segment, /if \(!isV14OrderLockReleased\(\)\)/);
  assert.match(segment, /await prisma\.delivery\.upsert\(payload\)/);
  assert.match(segment, /await prisma\.\$transaction\(async \(tx\) =>/);
  assert.match(segment, /await guardV14OrderMutationIfReleased\(tx, orderId\);/);
  assert.match(segment, /current\.paymentStatus !== "PAID"/);
  assert.match(segment, /await tx\.delivery\.upsert\(payload\)/);
});

test("Paystack transfer webhooks and legacy dispatch remain unchanged and non-refund", () => {
  assert.match(main, /applyVendorWithdrawalTransferEvent/);
  assert.match(main, /eventName === "transfer\.success"/);
  assert.match(main, /await createDeliveryFromOrder\(order\.id\)/);
  assert.match(legacy, /createKwikDelivery/);
  assert.doesNotMatch(main, /createPaystackRefund|requestPaystackRefund/);
  assert.match(gate, /const V14_GLOBAL_CROSS_PATH_RELEASED = false/);
});

test("provider calls stay outside primary Paystack charge transaction", () => {
  const segment = main.slice(main.indexOf('await prisma.$transaction(async (tx) => {', main.indexOf('export async function POST')),
    main.indexOf('const changedVariantIds'));
  assert.doesNotMatch(segment, /fetch\(|createDeliveryFromOrder\(|createVendorOrdersForPaidMarketplaceOrder\(|initiatePaystackTransfer\(/);
});
