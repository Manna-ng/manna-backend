import {
  NextResponse,
  type NextRequest,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";

function readLimit(
  value: string | null
) {
  const parsed =
    Number(value ?? "50");

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    return 50;
  }

  return Math.min(
    parsed,
    100
  );
}

function maskAccountNumber(
  value: string
) {
  return value.length > 4
    ? `****${value.slice(-4)}`
    : "****";
}

export async function GET(
  req: NextRequest
) {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const status =
    req.nextUrl.searchParams.get(
      "status"
    )?.trim() || null;

  const vendorId =
    req.nextUrl.searchParams.get(
      "vendorId"
    )?.trim() || null;

  const limit =
    readLimit(
      req.nextUrl.searchParams.get(
        "limit"
      )
    );

  const [
    withdrawals,
    availableSettlements,
    vendorBalances,
  ] = await Promise.all([
    prisma.vendorWithdrawal.findMany({
      where: {
        ...(status
          ? { status }
          : {}),
        ...(vendorId
          ? { vendorId }
          : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      include: {
        vendor: {
          select: {
            id: true,
            displayName: true,
          },
        },
        bankAccount: {
          select: {
            id: true,
            bankName: true,
            accountNumber: true,
            accountName: true,
            verificationStatus: true,
          },
        },
      },
    }),
    prisma.vendorSettlement.aggregate({
      where: {
        status: {
          in: [
            "AVAILABLE",
            "PENDING_PAYOUT",
          ],
        },
        ...(vendorId
          ? { vendorId }
          : {}),
      },
      _sum: {
        payableAmountNgn: true,
        commissionAmountNgn:
          true,
        grossAmountNgn: true,
      },
      _count: {
        _all: true,
      },
    }),
    prisma.vendor.aggregate({
      where: {
        ...(vendorId
          ? { id: vendorId }
          : {}),
      },
      _sum: {
        payableBalanceNgn: true,
        reservedWithdrawalNgn:
          true,
        lifetimePaidOutNgn: true,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    summary: {
      availableLiabilityNgn:
        vendorBalances._sum
          .payableBalanceNgn ?? 0,
      reservedWithdrawalNgn:
        vendorBalances._sum
          .reservedWithdrawalNgn ??
        0,
      lifetimePaidOutNgn:
        vendorBalances._sum
          .lifetimePaidOutNgn ?? 0,
      availableSettlementCount:
        availableSettlements._count
          ._all,
      availableSettlementGrossNgn:
        availableSettlements._sum
          .grossAmountNgn ?? 0,
      availableSettlementCommissionNgn:
        availableSettlements._sum
          .commissionAmountNgn ??
        0,
      availableSettlementPayableNgn:
        availableSettlements._sum
          .payableAmountNgn ?? 0,
    },
    withdrawals:
      withdrawals.map(
        (withdrawal) => ({
          ...withdrawal,
          bankAccount: {
            id:
              withdrawal
                .bankAccount.id,
            bankName:
              withdrawal
                .bankAccount
                .bankName,
            accountName:
              withdrawal
                .bankAccount
                .accountName,
            maskedAccountNumber:
              maskAccountNumber(
                withdrawal
                  .bankAccount
                  .accountNumber
              ),
            verificationStatus:
              withdrawal
                .bankAccount
                .verificationStatus,
          },
        })
      ),
  });
}
