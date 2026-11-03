import {
  NextResponse,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";

function maskAccountNumber(
  value: string
) {
  return value.length > 4
    ? `****${value.slice(-4)}`
    : "****";
}

export async function GET(
  _req: Request,
  ctx: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const { id } =
    await ctx.params;

  const withdrawal =
    await prisma.vendorWithdrawal.findUnique({
      where: { id },
      include: {
        vendor: {
          select: {
            id: true,
            displayName: true,
            payableBalanceNgn: true,
            reservedWithdrawalNgn:
              true,
            lifetimePaidOutNgn:
              true,
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
    });

  if (!withdrawal) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Payout not found",
      },
      { status: 404 }
    );
  }

  const [
    settlements,
    ledgerEntries,
  ] = await Promise.all([
    prisma.vendorSettlement.findMany({
      where: {
        vendorId:
          withdrawal.vendorId,
        OR: [
          {
            payoutReference:
              withdrawal.reference,
          },
          {
            metadata: {
              path: [
                "withdrawalReference",
              ],
              equals:
                withdrawal.reference,
            },
          },
        ],
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
    prisma.vendorLedgerEntry.findMany({
      where: {
        vendorId:
          withdrawal.vendorId,
        idempotencyKey: {
          contains:
            withdrawal.reference,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    payout: {
      ...withdrawal,
      bankAccount: {
        id:
          withdrawal.bankAccount.id,
        bankName:
          withdrawal.bankAccount
            .bankName,
        accountName:
          withdrawal.bankAccount
            .accountName,
        maskedAccountNumber:
          maskAccountNumber(
            withdrawal.bankAccount
              .accountNumber
          ),
        verificationStatus:
          withdrawal.bankAccount
            .verificationStatus,
      },
    },
    settlements,
    ledgerEntries,
  });
}
