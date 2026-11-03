import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const cron = readFileSync("src/app/api/cron/kwik-sync/route.ts", "utf8");
const legacyPayment = readFileSync("src/app/api/webhooks/payment/route.ts", "utf8");
const guard = readFileSync("src/lib/marketplace/orderV14ReleaseGuard.ts", "utf8");
const mainPaystack = readFileSync("src/app/api/webhooks/paystack/route.ts", "utf8");

test("V14R4B2A gate remains hard-disabled and refund execution unwired", () => {
  assert.match(guard, /const V14_GLOBAL_CROSS_PATH_RELEASED = false/);
  assert.doesNotMatch(guard, /process\.env/);
  assert.match(mainPaystack, /guardV14OrderMutationIfReleased/);
  assert.doesNotMatch(mainPaystack, /createPaystackRefund|requestPaystackRefund/);
});

test("Kwik cron locks each order in same transaction before delivery and order updates", () => {
  assert.match(cron, /await prisma\.\$transaction\(async \(tx\) => \{\s*await guardV14OrderMutationIfReleased\(tx, d\.orderId\);\s*await tx\.delivery\.update/);
  const txn = cron.slice(cron.indexOf('await prisma.$transaction(async (tx) => {'), cron.indexOf('if (\n          shouldUpdateStatus'));
  assert.match(txn, /await tx\.order\.update/);
  assert.doesNotMatch(txn, /getKwikJobStatus\(/);
});

test("Legacy signed payment callback locks before inventory changes and rechecks reference", () => {
  assert.match(legacyPayment, /await prisma\.\$transaction\(async \(tx\) => \{\s*await guardV14OrderMutationIfReleased\(tx, order\.id\);/);
  const txBody = legacyPayment.slice(legacyPayment.indexOf('await prisma.$transaction(async (tx) => {'), legacyPayment.indexOf('const changedVariantIds'));
  assert.match(txBody, /if \(isV14OrderLockReleased\(\)\)/);
  assert.match(txBody, /lockedOrder\.paymentReference !== reference/);
  assert.match(txBody, /lockedOrder\.paymentStatus !== "PENDING"/);
  assert.ok(txBody.indexOf('tx.order.findUnique') < txBody.indexOf('tx.productVariant.updateMany'));
});

test("Provider calls and settlement generation remain outside the new short transactions", () => {
  const cronTx = cron.slice(cron.indexOf('await prisma.$transaction(async (tx) => {'), cron.indexOf('if (\n          shouldUpdateStatus'));
  assert.doesNotMatch(cronTx, /generateVendorSettlementsForOrder\(|getKwikJobStatus\(/);
  const paymentTx = legacyPayment.slice(legacyPayment.indexOf('await prisma.$transaction(async (tx) => {'), legacyPayment.indexOf('const changedVariantIds'));
  assert.doesNotMatch(paymentTx, /fetch\(|createDeliveryFromOrder\(|createVendorOrdersForPaidMarketplaceOrder\(/);
});
