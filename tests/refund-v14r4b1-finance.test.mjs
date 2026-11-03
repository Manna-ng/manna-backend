import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const settlement = readFileSync("src/lib/marketplace/vendorSettlement.ts", "utf8");
const withdrawal = readFileSync("src/lib/marketplace/vendorWithdrawal.ts", "utf8");
const guard = readFileSync("src/lib/marketplace/orderV14ReleaseGuard.ts", "utf8");

test("V14R4B1 global release remains hard-disabled", () => {
  assert.match(guard, /const V14_GLOBAL_CROSS_PATH_RELEASED = false/);
  assert.doesNotMatch(guard, /process\.env/);
});

test("settlement retains legacy behavior until all writers released", () => {
  assert.match(settlement, /if \(!isV14OrderLockReleased\(\)\) \{\s*return generateVendorSettlementsUsingClient\(prisma, orderId\)/);
});

test("future settlement release locks order then operates in same transaction", () => {
  assert.match(settlement, /return prisma\.\$transaction\(\s*async \(tx\) => \{\s*await guardV14OrderMutationIfReleased\(tx, orderId\);\s*return generateVendorSettlementsUsingClient\(tx, orderId\)/);
  assert.match(settlement, /await db\.vendorSettlement\.upsert\(/);
  assert.match(settlement, /await db\.vendorLedgerEntry\.upsert\(/);
  assert.match(settlement, /await db\.vendor\.update\(/);
  assert.match(settlement, /await db\.order\.update\(/);
});

test("withdrawal reservation locks sorted order IDs and revalidates settlements under lock", () => {
  assert.match(withdrawal, /Array\.from\(new Set\(orderIds\)\)\.sort\(\)/);
  assert.match(withdrawal, /mode === "reserve"[\s\S]*?await guardV14OrderMutationIfReleased\(tx, orderId\)/);
  assert.match(withdrawal, /const withdrawal =[\s\S]*?guardWithdrawalOrderSetIfReleased\(tx, orderIds, "reserve"\);[\s\S]*?const current = await tx\.vendorSettlement\.findMany\(/);
  assert.match(withdrawal, /Eligible settlements changed before withdrawal reservation/);
});

test("withdrawal provider outcomes lock order rows but allow financial reconciliation", () => {
  assert.match(withdrawal, /mode === "reserve"[\s\S]*?await lockMannaOrderRow\(tx, orderId\)/);
  assert.equal((withdrawal.match(/guardWithdrawalOrderSetIfReleased\(tx, orderIds, "reconcile"\)/g)||[]).length, 3);
});

test("source stage invokes no network inside newly protected transaction sections", () => {
  const reserve = withdrawal.slice(withdrawal.indexOf('const withdrawal =\n    await prisma.$transaction'), withdrawal.indexOf('await notifyVendorWithdrawalRequested'));
  assert.doesNotMatch(reserve, /await initiatePaystackTransfer\(/);
  assert.doesNotMatch(reserve, /await createPaystackTransferRecipient\(/);
  assert.doesNotMatch(settlement, /fetch\(|createKwikDelivery\(|initiatePaystackTransfer\(/);
  assert.match(guard, /V14_GLOBAL_CROSS_PATH_RELEASED = false/);
});
