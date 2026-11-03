import {
  NextResponse,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";
import {
  verifyPaystackTransfer,
} from "@/lib/paystack/transfers";
import {
  applyVendorWithdrawalTransferEvent,
} from "@/lib/marketplace/vendorWithdrawal";

export async function POST(
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
      select: {
        id: true,
        reference: true,
        status: true,
      },
    });

  if (!withdrawal) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Payout not found.",
      },
      { status: 404 }
    );
  }

  if (
    withdrawal.status ===
      "SUCCESS" ||
    withdrawal.status ===
      "FAILED" ||
    withdrawal.status ===
      "REVERSED"
  ) {
    return NextResponse.json({
      ok: true,
      payout: withdrawal,
      message:
        "Payout is already in a terminal local state.",
    });
  }

  const provider =
    await verifyPaystackTransfer(
      withdrawal.reference
    );

  const providerStatus =
    typeof provider.status ===
      "string"
      ? provider.status.toLowerCase()
      : "";

  if (
    providerStatus ===
      "success" ||
    providerStatus ===
      "failed" ||
    providerStatus ===
      "reversed"
  ) {
    const event =
      providerStatus ===
        "success"
        ? "transfer.success"
        : providerStatus ===
            "failed"
          ? "transfer.failed"
          : "transfer.reversed";

    const result =
      await applyVendorWithdrawalTransferEvent({
        event,
        reference:
          withdrawal.reference,
        transferCode:
          typeof provider.transfer_code ===
            "string"
            ? provider.transfer_code
            : null,
        amountKobo:
          typeof provider.amount ===
            "number" &&
          Number.isInteger(
            provider.amount
          )
            ? provider.amount
            : null,
      });

    const refreshed =
      await prisma.vendorWithdrawal.findUnique({
        where: { id },
      });

    return NextResponse.json({
      ok: true,
      providerStatus,
      result,
      payout: refreshed,
      message:
        "Payout reconciliation applied a conclusive Paystack status.",
    });
  }

  const nextLocalStatus =
    providerStatus === "otp"
      ? "OTP_REQUIRED"
      : providerStatus
        ? "PROCESSING"
        : "PROCESSING_UNKNOWN";

  const updated =
    await prisma.vendorWithdrawal.update({
      where: { id },
      data: {
        status:
          nextLocalStatus,
        processingAt:
          new Date(),
        failureReason:
          providerStatus
            ? null
            : "Paystack verification returned no conclusive transfer status.",
        metadata: {
          providerStatus:
            providerStatus ||
            "unknown",
          reconciledAt:
            new Date().toISOString(),
        },
      },
    });

  return NextResponse.json({
    ok: true,
    providerStatus:
      providerStatus || null,
    payout: updated,
    message:
      "Paystack transfer is not yet in a conclusive final state.",
  });
}
