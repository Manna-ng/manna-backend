import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/kwik/statusSync.ts", "utf8");
const gate = readFileSync("src/lib/marketplace/orderV14ReleaseGuard.ts", "utf8");

test("V14R4B2B2A keeps the cross-path refund release hard-disabled", () => {
  assert.match(gate, /const V14_GLOBAL_CROSS_PATH_RELEASED = false/);
  assert.doesNotMatch(gate, /process\.env/);
  assert.match(source, /if \(isV14OrderLockReleased\(\)\)/);
  assert.match(source, /else \{\s+updatedDelivery = await prisma\.delivery\.update/);
});

test("Kwik statusSync locks the order before updating delivery and order state", () => {
  const section = source.slice(source.indexOf('const persisted = await prisma.$transaction('), source.indexOf('return { updatedDelivery, changed:'));
  assert.match(section, /await guardV14OrderMutationIfReleased\(tx, delivery\.orderId\)/);
  assert.match(section, /await tx\.delivery\.findUnique/);
  assert.ok(section.indexOf('guardV14OrderMutationIfReleased') < section.indexOf('tx.delivery.update'));
  assert.match(section, /await tx\.delivery\.update/);
  assert.match(section, /await tx\.order\.update/);
  assert.match(section, /await tx\.kwikDeliveryTask\.updateMany/);
});

test("Kwik delivery identity and terminal state are rechecked inside the lock", () => {
  const section = source.slice(source.indexOf('const persisted = await prisma.$transaction('), source.indexOf('return { updatedDelivery, changed:'));
  assert.match(section, /fresh\.kwikUniqueOrderId !== delivery\.kwikUniqueOrderId/);
  assert.match(section, /fresh\.orderId !== delivery\.orderId/);
  assert.match(section, /\["DELIVERED", "FAILED", "CANCELLED"\]/);
  assert.match(source, /return \{ updatedDelivery, changed: fresh\.kwikJobStatus !== currentKwikJobStatus \}/);
});

test("Kwik network request and settlement generation remain outside status update transaction", () => {
  const section = source.slice(source.indexOf('const persisted = await prisma.$transaction('), source.indexOf('return { updatedDelivery, changed:'));
  assert.doesNotMatch(section, /fetch\(|fetchKwikTaskDetails\(|generateVendorSettlementsForOrder\(/);
  const end = source.indexOf('let settlementCreatedCount = 0;');
  assert.ok(source.indexOf('fetchKwikTaskDetails(') < source.indexOf('const persisted = await prisma.$transaction('));
  assert.ok(end > source.indexOf('return { updatedDelivery, changed:'));
  assert.ok(source.indexOf('await generateVendorSettlementsForOrder(', end) > end);
});
