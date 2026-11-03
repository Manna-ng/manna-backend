import {
  cookies,
} from "next/headers";
import {
  NextResponse,
  type NextRequest,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyAuthToken,
} from "@/lib/auth";
import {
  requestVendorWithdrawal,
} from "@/lib/marketplace/vendorWithdrawal";

async function resolveVendorContext(
  requestedVendorId: string | null
) {
  const cookieStore =
    await cookies();

  const token =
    cookieStore.get(
      "manna_token"
    )?.value;

  const decoded =
    token
      ? verifyAuthToken(token)
      : null;

  if (!decoded?.userId) {
    throw new Error(
      "Unauthorized"
    );
  }

  const memberships =
    await prisma.vendorUser.findMany({
      where: {
        userId: decoded.userId,
        isActive: true,
      },
      select: {
        vendorId: true,
      },
    });

  if (
    memberships.length === 0
  ) {
    throw new Error(
      "Vendor access denied"
    );
  }

  if (requestedVendorId) {
    const allowed =
      memberships.some(
        (item) =>
          item.vendorId ===
          requestedVendorId
      );

    if (!allowed) {
      throw new Error(
        "Vendor access denied"
      );
    }

    return {
      userId: decoded.userId,
      vendorId:
        requestedVendorId,
    };
  }

  if (
    memberships.length !== 1
  ) {
    throw new Error(
      "vendorId is required when the account belongs to more than one vendor."
    );
  }

  return {
    userId: decoded.userId,
    vendorId:
      memberships[0].vendorId,
  };
}

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

export async function GET(
  req: NextRequest
) {
  try {
    const vendorId =
      req.nextUrl.searchParams.get(
        "vendorId"
      );

    const context =
      await resolveVendorContext(
        vendorId
      );

    const limit =
      readLimit(
        req.nextUrl.searchParams.get(
          "limit"
        )
      );

    const [
      vendor,
      withdrawals,
      settlements,
    ] = await Promise.all([
      prisma.vendor.findUnique({
        where: {
          id:
            context.vendorId,
        },
        select: {
          id: true,
          displayName: true,
          payableBalanceNgn: true,
          reservedWithdrawalNgn:
            true,
          pendingSettlementNgn:
            true,
          lifetimePaidOutNgn:
            true,
          minimumPayoutNgn:
            true,
          settlementMode: true,
          bankAccounts: {
            where: {
              isDefault: true,
            },
            take: 1,
            select: {
              id: true,
              bankName: true,
              accountNumber: true,
              accountName: true,
              verificationStatus:
                true,
            },
          },
        },
      }),
      prisma.vendorWithdrawal.findMany({
        where: {
          vendorId:
            context.vendorId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
      }),
      prisma.vendorSettlement.findMany({
        where: {
          vendorId:
            context.vendorId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
      }),
    ]);

    if (!vendor) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Vendor not found",
        },
        { status: 404 }
      );
    }

    const bank =
      vendor.bankAccounts[0];

    const payoutAccount =
      bank
        ? {
            id: bank.id,
            bankName:
              bank.bankName,
            accountName:
              bank.accountName,
            maskedAccountNumber:
              bank.accountNumber.length >
              4
                ? `****${bank.accountNumber.slice(
                    -4
                  )}`
                : "****",
            verificationStatus:
              bank.verificationStatus,
          }
        : null;

    return NextResponse.json({
      ok: true,
      vendor: {
        id: vendor.id,
        displayName:
          vendor.displayName,
        availableBalanceNgn:
          vendor.payableBalanceNgn,
        reservedWithdrawalNgn:
          vendor.reservedWithdrawalNgn,
        pendingSettlementNgn:
          vendor.pendingSettlementNgn,
        lifetimePaidOutNgn:
          vendor.lifetimePaidOutNgn,
        minimumPayoutNgn:
          vendor.minimumPayoutNgn,
        settlementMode:
          vendor.settlementMode,
        payoutAccount,
      },
      withdrawals,
      settlements,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load withdrawals.";

    const status =
      message.includes(
        "Unauthorized"
      )
        ? 401
        : message.includes(
              "denied"
            )
          ? 403
          : 400;

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status }
    );
  }
}

export async function POST(
  req: NextRequest
) {
  try {
    let vendorId:
      | string
      | null = null;

    try {
      const body =
        (await req.json()) as
          Record<
            string,
            unknown
          >;

      vendorId =
        typeof body.vendorId ===
          "string" &&
        body.vendorId.trim()
          ? body.vendorId.trim()
          : null;
    } catch {
      vendorId = null;
    }

    const context =
      await resolveVendorContext(
        vendorId
      );

    const withdrawal =
      await requestVendorWithdrawal({
        vendorId:
          context.vendorId,
        actorUserId:
          context.userId,
      });

    return NextResponse.json(
      {
        ok: true,
        withdrawal,
      },
      { status: 202 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to request withdrawal.";

    const status =
      message.includes(
        "Unauthorized"
      )
        ? 401
        : message.includes(
              "denied"
            )
          ? 403
          : message.includes(
                "already"
              ) ||
              message.includes(
                "changed"
              ) ||
              message.includes(
                "reconciliation"
              )
            ? 409
            : 400;

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status }
    );
  }
}
