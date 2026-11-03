import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

test("admin middleware uses dedicated admin session and CSRF", () => {
  const proxy = read("src/proxy.ts");

  assert.match(proxy, /manna_admin_token/);
  assert.match(proxy, /manna_admin_csrf/);
  assert.match(proxy, /x-manna-admin-csrf/);
  assert.match(proxy, /MANNA_ADMIN_ACCESS/);
  assert.doesNotMatch(
    proxy,
    /Existing admin routes remain on the present customer-token system/
  );
});

test("requireAdmin has no legacy manna_token fallback", () => {
  const source = read("src/lib/auth/requireAdmin.ts");

  assert.match(source, /manna_admin_token/);
  assert.doesNotMatch(source, /manna_token/);
  assert.doesNotMatch(source, /verifyAuthToken/);
});

test("product detail route is real moderation, not duplicate creation", () => {
  const source = read(
    "src/app/api/admin/products/[id]/route.ts"
  );

  assert.match(source, /export async function GET/);
  assert.match(source, /export async function PATCH/);
  assert.match(source, /approvalStatus/);
  assert.match(source, /notifyVendorProductModeration/);
  assert.doesNotMatch(source, /export async function POST/);
});

test("legacy direct admin order status mutation is disabled", () => {
  const source = read(
    "src/app/api/orders/[id]/status/route.ts"
  );

  assert.match(source, /LEGACY_ADMIN_STATUS_DISABLED/);
  assert.doesNotMatch(source, /prisma\.order\.update/);
});

test("admin read contracts exist", () => {
  const files = [
    "src/app/api/admin/orders/[id]/route.ts",
    "src/app/api/admin/customers/route.ts",
    "src/app/api/admin/customers/[id]/route.ts",
    "src/app/api/admin/deliveries/route.ts",
    "src/app/api/admin/deliveries/[id]/route.ts",
    "src/app/api/admin/dashboard/route.ts",
    "src/app/api/admin/feedback/[id]/route.ts",
  ];

  for (const file of files) {
    const source = read(file);
    assert.match(source, /requireAdmin/);
  }
});

test("paid-order direct cancellation is blocked", () => {
  const source = read(
    "src/app/api/admin/orders/[id]/cancel/route.ts"
  );

  assert.match(source, /PAID_ORDER_REFUND_REQUIRED/);
  assert.match(source, /paymentStatus ===/);
});
