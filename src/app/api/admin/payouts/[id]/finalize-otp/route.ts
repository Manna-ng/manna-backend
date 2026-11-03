import {
  NextResponse,
  type NextRequest,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";
import {
  finalizePaystackTransferOtp,
} from "@/lib/paystack/transfers";
import {
  isJsonObject,
} from "@/lib/marketplace/json";

export async function POST(
  req: NextRequest,
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

  const body: unknown =
    await req.json().catch(
      () => null
    );

  if (!isJsonObject(body)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Request body must be a JSON object.",
      },
      { status: 400 }
    );
  }

  const otp =
    typeof body.otp === "string"
      ? body.otp.trim()
      : "";

  if (
    !otp ||
    otp.length > 20
  ) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "A valid Paystack transfer OTP is required.",
      },
      { status: 400 }
    );
  }

  const withdrawal =
    await prisma.vendorWithdrawal.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        transferCode: true,
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
    withdrawal.status !==
    "OTP_REQUIRED"
  ) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "This payout is not waiting for OTP confirmation.",
      },
      { status: 409 }
    );
  }

  if (
    !withdrawal.transferCode
  ) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Paystack transfer code is missing.",
      },
      { status: 409 }
    );
  }

  const result =
    await finalizePaystackTransferOtp({
      transferCode:
        withdrawal.transferCode,
      otp,
    });

  const updated =
    await prisma.vendorWithdrawal.update({
      where: {
        id: withdrawal.id,
      },
      data: {
        status:
          "PROCESSING",
        processingAt:
          new Date(),
        failureReason: null,
        metadata: {
          providerStatus:
            result.status,
          otpFinalized: true,
        },
      },
    });

  return NextResponse.json(
    {
      ok: true,
      payout: updated,
      message:
        "OTP accepted. Final payout state remains webhook-authoritative.",
    },
    { status: 202 }
  );
}
