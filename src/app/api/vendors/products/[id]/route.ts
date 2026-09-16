import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isJsonObject, optionalString } from "@/lib/marketplace/json";
import {
  loadVendorProductWithMedia,
  requireOwnedVendorProduct,
} from "@/lib/vendors/vendorProductManagement";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const access = await requireOwnedVendorProduct(id);
  if (access.ok === false) {
    return NextResponse.json({ message: access.message }, { status: access.status });
  }

  const product = await loadVendorProductWithMedia(id);
  return NextResponse.json({ product });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const access = await requireOwnedVendorProduct(id);
    if (access.ok === false) {
      return NextResponse.json({ message: access.message }, { status: access.status });
    }

    const body: unknown = await req.json();
    if (!isJsonObject(body)) {
      return NextResponse.json({ message: "Request body must be a JSON object" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    let requiresReview = false;

    const current = access.product;
    const textFields = ["name", "description", "category", "subCategory"] as const;
    for (const key of textFields) {
      if (body[key] === undefined) continue;

      const next = optionalString(body[key]) ?? (key === "description" || key === "subCategory" ? null : undefined);
      if ((key === "name" || key === "category") && !next) {
        return NextResponse.json({ message: `${key} cannot be empty` }, { status: 400 });
      }

      updates[key] = next;
      if (current[key] !== next) requiresReview = true;
    }

    if (body.isActive !== undefined) {
      updates.isActive = Boolean(body.isActive);
    }

    if (requiresReview) {
      updates.approvalStatus = "PENDING_REVIEW";
    }

    if (Object.keys(updates).length > 0) {
      await prisma.product.update({ where: { id }, data: updates as never });
    }

    const product = await loadVendorProductWithMedia(id);
    return NextResponse.json({ product });
  } catch (error) {
    console.error("VENDOR_PRODUCT_UPDATE_ERROR", error);
    return NextResponse.json({ message: "Unable to update product" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const access = await requireOwnedVendorProduct(id);
    if (access.ok === false) {
      return NextResponse.json({ message: access.message }, { status: access.status });
    }

    await prisma.product.update({ where: { id }, data: { isActive: false } as never });
    const product = await loadVendorProductWithMedia(id);
    return NextResponse.json({ product, archived: true });
  } catch (error) {
    console.error("VENDOR_PRODUCT_ARCHIVE_ERROR", error);
    return NextResponse.json({ message: "Unable to archive product" }, { status: 500 });
  }
}
