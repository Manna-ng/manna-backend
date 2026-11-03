import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const guardPath = "src/lib/marketplace/orderV14ReleaseGuard.ts";
const servicePath = "src/lib/marketplace/vendorOrders.ts";
const guardText = readFileSync(guardPath, "utf8");
const serviceText = readFileSync(servicePath, "utf8");

function loadGuard({ simulateFutureRelease = false } = {}) {
  const fixtureText = simulateFutureRelease
    ? guardText.replace("V14_GLOBAL_CROSS_PATH_RELEASED = false", "V14_GLOBAL_CROSS_PATH_RELEASED = true")
    : guardText;
  const compiled = ts.transpileModule(fixtureText, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let lockCalls = 0;
  const cjsFixture = { exports: {} };
  const fakeRequire = () => ({
    lockMannaOrderAndDenyRefundIntent: async () => { lockCalls += 1; },
  });
  vm.runInNewContext(`(function (module, exports, require, process) { ${compiled} })`, {})
    (cjsFixture, cjsFixture.exports, fakeRequire, { env: {} });
  return { api: cjsFixture.exports, calls: () => lockCalls };
}

test("V14 lock gate is disabled by default, before migration and global writer release", async () => {
  const fixture = loadGuard({});
  assert.equal(fixture.api.isV14OrderLockReleased(), false);
  await fixture.api.guardV14OrderMutationIfReleased({}, "order-1");
  assert.equal(fixture.calls(), 0);
});

test("Future release simulation calls the existing transactional order lock", async () => {
  assert.match(guardText, /V14_GLOBAL_CROSS_PATH_RELEASED = false/);
  assert.doesNotMatch(guardText, /process\.env/);
  const fixture = loadGuard({ simulateFutureRelease: true });
  assert.equal(fixture.api.isV14OrderLockReleased(), true);
  await fixture.api.guardV14OrderMutationIfReleased({}, "order-1");
  assert.equal(fixture.calls(), 1);
});

test("vendor order creation and readiness acquire coordination within transactions", () => {
  assert.match(serviceText, /const result = await prisma\.\$transaction\(async \(tx\) => \{\s+await guardV14OrderMutationIfReleased\(tx, order\.id\)/);
  assert.match(serviceText, /if \(!isReadyStatus\(vendorOrder\.status\)\) \{\s+await prisma\.\$transaction\(async \(tx\) => \{\s+await guardV14OrderMutationIfReleased\(tx, vendorOrder\.orderId\)/);
  assert.match(serviceText, /async function updateOrderReadinessCounters[\s\S]*?return prisma\.\$transaction\(async \(tx\) => \{\s+await guardV14OrderMutationIfReleased/);
});

test("Kwik pending task claimed in locked transaction before provider network request", () => {
  const claimIndex = serviceText.indexOf("const pendingTask = await prisma.$transaction(async (tx) => {");
  const providerIndex = serviceText.indexOf("const result = await createKwikMarketplaceTaskFromStoredQuote(");
  assert.ok(claimIndex > 0 && providerIndex > claimIndex);
  const claim = serviceText.slice(claimIndex, providerIndex);
  assert.match(claim, /guardV14OrderMutationIfReleased\(tx, order\.id\)/);
  assert.match(claim, /status: "PENDING"/);
  assert.match(claim, /currentTask\.status === "PENDING"/);
  assert.doesNotMatch(claim, /createKwikMarketplaceTaskFromStoredQuote\(/);
});

test("V14 remains unreleased and real refund execution is not wired", () => {
  assert.match(guardText, /Hard-disabled by source code/);
  assert.match(readFileSync("src/app/api/webhooks/paystack/route.ts", "utf8"), /guardV14OrderMutationIfReleased/);
  assert.doesNotMatch(readFileSync("src/app/api/webhooks/paystack/route.ts", "utf8"), /createPaystackRefund|requestPaystackRefund/);
  assert.match(readFileSync("src/lib/marketplace/vendorWithdrawal.ts", "utf8"), /guardWithdrawalOrderSetIfReleased/);
  assert.match(readFileSync("src/lib/marketplace/vendorSettlement.ts", "utf8"), /guardV14OrderMutationIfReleased/);
});
