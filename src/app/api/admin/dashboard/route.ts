import {
  NextResponse,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";

export async function GET() {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const [
    customers,
    vendors,
    approvedVendors,
    pendingVendors,
    orders,
    paidOrders,
    deliveredOrders,
    cancelledOrders,
    deliveries,
    pendingProductReviews,
    unresolvedFeedback,
    settlementTotals,
    vendorBalances,
    processingWithdrawals,
  ] = await Promise.all([
    prisma.user.count({
      where: {
        role: "CUSTOMER",
      },
    }),
    prisma.vendor.count(),
    prisma.vendor.count({
      where: {
        status: "APPROVED",
      },
    }),
    prisma.vendor.count({
      where: {
        status: {
          in: [
            "PENDING_VERIFICATION",
            "UNDER_REVIEW",
          ],
        },
      },
    }),
    prisma.order.count(),
    prisma.order.aggregate({
      where: {
        paymentStatus:
          "PAID",
      },
      _count: {
        _all: true,
      },
      _sum: {
        totalAmountNgn:
          true,
      },
    }),
    prisma.order.count({
      where: {
        status:
          "DELIVERED",
      },
    }),
    prisma.order.count({
      where: {
        status:
          "CANCELLED",
      },
    }),
    prisma.delivery.count(),
    prisma.product.count({
      where: {
        approvalStatus:
          "PENDING_REVIEW",
      },
    }),
    prisma.customerFeedback.count({
      where: {
        status: {
          not: "RESOLVED",
        },
      },
    }),
    prisma.vendorSettlement.aggregate({
      _sum: {
        grossAmountNgn:
          true,
        commissionAmountNgn:
          true,
        payableAmountNgn:
          true,
      },
    }),
    prisma.vendor.aggregate({
      _sum: {
        payableBalanceNgn:
          true,
        reservedWithdrawalNgn:
          true,
        lifetimePaidOutNgn:
          true,
      },
    }),
    prisma.vendorWithdrawal.count({
      where: {
        status: {
          in: [
            "INITIATING",
            "PROCESSING",
            "PROCESSING_UNKNOWN",
            "OTP_REQUIRED",
          ],
        },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    customers,
    vendors: {
      total: vendors,
      approved:
        approvedVendors,
      pendingReview:
        pendingVendors,
    },
    orders: {
      total: orders,
      paidCount:
        paidOrders._count
          ._all,
      capturedGmvNgn:
        paidOrders._sum
          .totalAmountNgn ??
        0,
      delivered:
        deliveredOrders,
      cancelled:
        cancelledOrders,
    },
    deliveries: {
      total: deliveries,
    },
    moderation: {
      pendingProductReviews,
      unresolvedFeedback,
    },
    finance: {
      settlementGrossNgn:
        settlementTotals._sum
          .grossAmountNgn ??
        0,
      commissionNgn:
        settlementTotals._sum
          .commissionAmountNgn ??
        0,
      vendorPayableNgn:
        settlementTotals._sum
          .payableAmountNgn ??
        0,
      availableVendorLiabilityNgn:
        vendorBalances._sum
          .payableBalanceNgn ??
        0,
      reservedWithdrawalNgn:
        vendorBalances._sum
          .reservedWithdrawalNgn ??
        0,
      lifetimePaidOutNgn:
        vendorBalances._sum
          .lifetimePaidOutNgn ??
        0,
      processingWithdrawals,
    },
    refundCapability:
      "NOT_YET_ENABLED",
  });
}
