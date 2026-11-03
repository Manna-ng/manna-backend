-- Manna V11 finance integrity + vendor withdrawal foundation.
-- Source migration only. Do not apply automatically from the patch runner.

ALTER TABLE "Vendor"
ADD COLUMN "reservedWithdrawalNgn" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "VendorWithdrawal" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "amountNgn" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'INITIATING',
    "reference" TEXT NOT NULL,
    "recipientCode" TEXT,
    "transferCode" TEXT,
    "failureReason" TEXT,
    "requestedByUserId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorWithdrawal_reference_key"
ON "VendorWithdrawal"("reference");

CREATE INDEX "VendorWithdrawal_vendorId_idx"
ON "VendorWithdrawal"("vendorId");

CREATE INDEX "VendorWithdrawal_bankAccountId_idx"
ON "VendorWithdrawal"("bankAccountId");

CREATE INDEX "VendorWithdrawal_status_idx"
ON "VendorWithdrawal"("status");

CREATE INDEX "VendorWithdrawal_createdAt_idx"
ON "VendorWithdrawal"("createdAt");

ALTER TABLE "VendorWithdrawal"
ADD CONSTRAINT "VendorWithdrawal_vendorId_fkey"
FOREIGN KEY ("vendorId")
REFERENCES "Vendor"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "VendorWithdrawal"
ADD CONSTRAINT "VendorWithdrawal_bankAccountId_fkey"
FOREIGN KEY ("bankAccountId")
REFERENCES "VendorBankAccount"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- Snapshot the configured vendor commission for vendor orders that have
-- not yet generated a settlement. Already-settled historical records are
-- intentionally not rewritten.
UPDATE "VendorOrder" AS vo
SET "commissionRateBps" = v."commissionRateBps"
FROM "Vendor" AS v
WHERE
  vo."vendorId" = v."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "VendorSettlement" AS vs
    WHERE vs."vendorOrderId" = vo."id"
  );

-- Fill missing merchandise gross snapshots from immutable vendor-order items.
UPDATE "VendorOrder" AS vo
SET "grossAmountNgn" = totals."grossAmountNgn"
FROM (
  SELECT
    "vendorOrderId",
    SUM("subtotalNgn")::INTEGER AS "grossAmountNgn"
  FROM "VendorOrderItem"
  GROUP BY "vendorOrderId"
) AS totals
WHERE
  vo."id" = totals."vendorOrderId"
  AND vo."grossAmountNgn" = 0;

-- Pre-V11 has no transfer engine, so delivered pending settlements are
-- immediately available for vendor withdrawal.
UPDATE "VendorSettlement"
SET "status" = 'AVAILABLE'
WHERE "status" = 'PENDING_PAYOUT';

UPDATE "VendorOrder"
SET "settlementStatus" = 'AVAILABLE'
WHERE "settlementStatus" = 'PENDING_PAYOUT';

UPDATE "Order"
SET "settlementStatus" = 'AVAILABLE'
WHERE "settlementStatus" = 'PENDING_PAYOUT';

-- Reconcile vendor finance aggregates from settlement truth. This avoids
-- carrying forward any stale values from the older increment-only logic.
UPDATE "Vendor" AS v
SET
  "payableBalanceNgn" = COALESCE(s."availablePayableNgn", 0),
  "pendingSettlementNgn" = 0,
  "reservedWithdrawalNgn" = 0,
  "lifetimeGrossSalesNgn" = COALESCE(s."grossNgn", 0),
  "lifetimeCommissionNgn" = COALESCE(s."commissionNgn", 0)
FROM (
  SELECT
    v2."id" AS "vendorId",
    COALESCE(SUM(
      CASE
        WHEN vs."status" = 'AVAILABLE'
        THEN vs."payableAmountNgn"
        ELSE 0
      END
    ), 0)::INTEGER AS "availablePayableNgn",
    COALESCE(SUM(vs."grossAmountNgn"), 0)::INTEGER AS "grossNgn",
    COALESCE(SUM(vs."commissionAmountNgn"), 0)::INTEGER AS "commissionNgn"
  FROM "Vendor" AS v2
  LEFT JOIN "VendorSettlement" AS vs
    ON vs."vendorId" = v2."id"
  GROUP BY v2."id"
) AS s
WHERE v."id" = s."vendorId";

ALTER TABLE "VendorSettlement"
ALTER COLUMN "status"
SET DEFAULT 'AVAILABLE';
