import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  guardV14OrderMutationIfReleased,
  isV14OrderLockReleased,
} from "@/lib/marketplace/orderV14ReleaseGuard";

type VendorOrderForSettlement = {
  id: string;
  orderId: string;
  vendorId: string;
  marketClusterId: string;
  grossAmountNgn: number;
  commissionRateBps: number;
};

type VendorOrderItemForSettlement = {
  subtotalNgn: number;
};

type OrderForSettlement = {
  id: string;
  status: string;
  paymentStatus: string;
};

export type VendorSettlementGenerationResult = {
  orderId: string;
  createdCount: number;
  skippedCount: number;
  vendorGrossAmountNgn: number;
  mannaCommissionAmountNgn: number;
  vendorPayableAmountNgn: number;
};

const AVAILABLE_SETTLEMENT_STATUSES = ["AVAILABLE", "PENDING_PAYOUT"];

function calculateCommission(
  grossAmountNgn: number,
  commissionRateBps: number
): number {
  return Math.max(
    0,
    Math.round(
      (grossAmountNgn * commissionRateBps) /
        10_000
    )
  );
}

async function calculateVendorOrderGrossAmount(
  db: Prisma.TransactionClient,
  vendorOrderId: string
): Promise<number> {
  const items =
    (await db.vendorOrderItem.findMany({
      where: { vendorOrderId },
      select: { subtotalNgn: true },
    })) as VendorOrderItemForSettlement[];

  return items.reduce(
    (sum, item) =>
      sum + item.subtotalNgn,
    0
  );
}

function deriveOrderSettlementStatus(
  statuses: string[]
): string {
  if (statuses.length === 0) {
    return "NOT_SETTLED";
  }

  if (
    statuses.every(
      (status) => status === "PAID"
    )
  ) {
    return "PAID";
  }

  if (
    statuses.some(
      (status) =>
        status ===
        "WITHDRAWAL_PENDING"
    )
  ) {
    return "WITHDRAWAL_PENDING";
  }

  if (
    statuses.some((status) =>
      AVAILABLE_SETTLEMENT_STATUSES.includes(
        status
      )
    )
  ) {
    return "AVAILABLE";
  }

  return statuses[0];
}

async function recomputeVendorFinance(
  db: Prisma.TransactionClient,
  vendorId: string
) {
  const [
    allSettlements,
    availableSettlements,
    reservedSettlements,
  ] = await Promise.all([
    db.vendorSettlement.aggregate({
      where: { vendorId },
      _sum: {
        grossAmountNgn: true,
        commissionAmountNgn: true,
      },
    }),
    db.vendorSettlement.aggregate({
      where: {
        vendorId,
        status: {
          in: AVAILABLE_SETTLEMENT_STATUSES,
        },
      },
      _sum: {
        payableAmountNgn: true,
      },
    }),
    db.vendorSettlement.aggregate({
      where: {
        vendorId,
        status: "WITHDRAWAL_PENDING",
      },
      _sum: {
        payableAmountNgn: true,
      },
    }),
  ]);

  await db.vendor.update({
    where: { id: vendorId },
    data: {
      payableBalanceNgn:
        availableSettlements._sum
          .payableAmountNgn ?? 0,
      pendingSettlementNgn: 0,
      reservedWithdrawalNgn:
        reservedSettlements._sum
          .payableAmountNgn ?? 0,
      lifetimeGrossSalesNgn:
        allSettlements._sum
          .grossAmountNgn ?? 0,
      lifetimeCommissionNgn:
        allSettlements._sum
          .commissionAmountNgn ?? 0,
    },
  });
}

async function generateVendorSettlementsUsingClient(
  db: Prisma.TransactionClient,
  orderId: string
): Promise<VendorSettlementGenerationResult> {
  const order =
    (await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
      },
    })) as OrderForSettlement | null;

  if (!order) {
    throw new Error("Order not found.");
  }

  if (order.paymentStatus !== "PAID") {
    throw new Error(
      "Order cannot be settled because payment is not paid."
    );
  }

  if (order.status !== "DELIVERED") {
    throw new Error(
      "Order cannot be settled until delivery is completed."
    );
  }

  const vendorOrders =
    (await db.vendorOrder.findMany({
      where: { orderId },
      select: {
        id: true,
        orderId: true,
        vendorId: true,
        marketClusterId: true,
        grossAmountNgn: true,
        commissionRateBps: true,
      },
    })) as VendorOrderForSettlement[];

  let createdCount = 0;
  let skippedCount = 0;
  const affectedVendorIds =
    new Set<string>();

  for (
    const vendorOrder of vendorOrders
  ) {
    const existingSettlement =
      await db.vendorSettlement.findUnique({
        where: {
          vendorOrderId:
            vendorOrder.id,
        },
        select: {
          id: true,
        },
      });

    const grossAmountNgn =
      vendorOrder.grossAmountNgn > 0
        ? vendorOrder.grossAmountNgn
        : await calculateVendorOrderGrossAmount(
            db,
            vendorOrder.id
          );

    const commissionAmountNgn =
      calculateCommission(
        grossAmountNgn,
        vendorOrder.commissionRateBps
      );

    const payableAmountNgn =
      Math.max(
        0,
        grossAmountNgn -
          commissionAmountNgn
      );

    const settlementIdempotencyKey =
      `vendor-settlement:${vendorOrder.id}`;

    const ledgerIdempotencyKey =
      `vendor-ledger:settlement-credit:${vendorOrder.id}`;

    const settlement =
      await db.vendorSettlement.upsert({
        where: {
          vendorOrderId:
            vendorOrder.id,
        },
        update: {},
        create: {
          vendorId:
            vendorOrder.vendorId,
          orderId,
          vendorOrderId:
            vendorOrder.id,
          marketClusterId:
            vendorOrder.marketClusterId,
          status: "AVAILABLE",
          grossAmountNgn,
          commissionRateBps:
            vendorOrder.commissionRateBps,
          commissionAmountNgn,
          payableAmountNgn,
          metadata: {
            idempotencyKey:
              settlementIdempotencyKey,
            source:
              "DELIVERED_ORDER",
          },
        },
      });

    await db.vendorLedgerEntry.upsert({
      where: {
        idempotencyKey:
          ledgerIdempotencyKey,
      },
      update: {},
      create: {
        vendorId:
          vendorOrder.vendorId,
        orderId,
        vendorOrderId:
          vendorOrder.id,
        settlementId:
          settlement.id,
        entryType:
          "SALE_RELEASED",
        direction: "CREDIT",
        amountNgn:
          settlement.payableAmountNgn,
        idempotencyKey:
          ledgerIdempotencyKey,
        description:
          "Vendor payable became available after successful delivery.",
        metadata: {
          grossAmountNgn:
            settlement.grossAmountNgn,
          commissionRateBps:
            settlement.commissionRateBps,
          commissionAmountNgn:
            settlement.commissionAmountNgn,
        },
      },
    });

    await db.vendorOrder.update({
      where: {
        id: vendorOrder.id,
      },
      data: {
        grossAmountNgn:
          settlement.grossAmountNgn,
        commissionAmountNgn:
          settlement.commissionAmountNgn,
        payableAmountNgn:
          settlement.payableAmountNgn,
        settlementStatus:
          settlement.status,
        settlementCalculatedAt:
          new Date(),
        settlementEligibleAt:
          settlement.eligibleAt,
        settlementPaidAt:
          settlement.paidAt,
      },
    });

    affectedVendorIds.add(
      vendorOrder.vendorId
    );

    if (existingSettlement) {
      skippedCount += 1;
    } else {
      createdCount += 1;
    }
  }

  for (
    const vendorId
    of affectedVendorIds
  ) {
    await recomputeVendorFinance(
      db,
      vendorId
    );
  }

  const orderSettlements =
    await db.vendorSettlement.findMany({
      where: { orderId },
      select: {
        status: true,
        grossAmountNgn: true,
        commissionAmountNgn: true,
        payableAmountNgn: true,
      },
    });

  const vendorGrossAmountNgn =
    orderSettlements.reduce(
      (sum, settlement) =>
        sum +
        settlement.grossAmountNgn,
      0
    );

  const mannaCommissionAmountNgn =
    orderSettlements.reduce(
      (sum, settlement) =>
        sum +
        settlement.commissionAmountNgn,
      0
    );

  const vendorPayableAmountNgn =
    orderSettlements.reduce(
      (sum, settlement) =>
        sum +
        settlement.payableAmountNgn,
      0
    );

  await db.order.update({
    where: { id: orderId },
    data: {
      settlementStatus:
        deriveOrderSettlementStatus(
          orderSettlements.map(
            (settlement) =>
              settlement.status
          )
        ),
      settlementCalculatedAt:
        new Date(),
      vendorGrossAmountNgn,
      mannaCommissionAmountNgn,
      vendorPayableAmountNgn,
    },
  });

  return {
    orderId,
    createdCount,
    skippedCount,
    vendorGrossAmountNgn,
    mannaCommissionAmountNgn,
    vendorPayableAmountNgn,
  };
}


/**
 * V14 staged integration: the legacy path continues to use the same client
 * and operation order while the global release gate remains hard-disabled.
 * Once explicitly released after ALL writers are protected, settlement writes,
 * finance aggregates, and order status share ONE locked transaction.
 * No provider network call is made from inside this transaction.
 */
export async function generateVendorSettlementsForOrder(
  orderId: string
): Promise<VendorSettlementGenerationResult> {
  if (!isV14OrderLockReleased()) {
    return generateVendorSettlementsUsingClient(prisma, orderId);
  }

  return prisma.$transaction(
    async (tx) => {
      await guardV14OrderMutationIfReleased(tx, orderId);
      return generateVendorSettlementsUsingClient(tx, orderId);
    },
    { maxWait: 5_000, timeout: 20_000 }
  );
}
