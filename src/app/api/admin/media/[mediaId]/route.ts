import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/requireAdmin";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ mediaId: string }> }
) {
  const admin = await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const { mediaId } = await ctx.params;
  const body: unknown = await req.json().catch(() => null);

  if (!isJsonObject(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const approvalStatus = body.approvalStatus;
  const rejectionReason = body.rejectionReason;

  if (approvalStatus !== "APPROVED" && approvalStatus !== "REJECTED") {
    return NextResponse.json(
      { error: "approvalStatus must be APPROVED or REJECTED" },
      { status: 400 }
    );
  }

  const media = (await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      approvalStatus,
      approvedAt: approvalStatus === "APPROVED" ? new Date() : null,
      approvedByAdminId: approvalStatus === "APPROVED" ? admin.adminId : null,
      rejectedAt: approvalStatus === "REJECTED" ? new Date() : null,
      rejectionReason:
        approvalStatus === "REJECTED" && typeof rejectionReason === "string"
          ? rejectionReason
          : null,
    } as never,
  })) as {
    productId?: string | null;
    mediaType?: string;
    publicUrl?: string | null;
  };

  if (
    approvalStatus === "APPROVED" &&
    media.productId &&
    media.mediaType === "IMAGE" &&
    media.publicUrl
  ) {
    await prisma.product.update({
      where: { id: media.productId },
      data: { imageUrl: media.publicUrl },
    });
  }

  return NextResponse.json({ media });
}