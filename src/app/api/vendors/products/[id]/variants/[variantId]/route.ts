import { NextResponse, type NextRequest } from "next/server";
import { VariantUnit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwnedVendorProduct } from "@/lib/vendors/vendorProductManagement";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; variantId: string }> }
) {
  try {
    const { id, variantId } = await ctx.params;
    const access = await requireOwnedVendorProduct(id);
    if (access.ok === false) {
      return NextResponse.json({ message: access.message }, { status: access.status });
    }

    const current = access.product.variants.find((variant) => variant.id === variantId);
    if (!current) {
      return NextResponse.json({ message: "Variant not found" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    let requiresReview = false;

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ message: "name cannot be empty" }, { status: 400 });
      updates.name = name;
      if (name !== current.name) requiresReview = true;
    }

    if (body.priceNgn !== undefined) {
      const priceNgn = Number(body.priceNgn);
      if (!Number.isFinite(priceNgn) || priceNgn <= 0) {
        return NextResponse.json({ message: "priceNgn must be a positive number" }, { status: 400 });
      }
      const rounded = Math.round(priceNgn);
      updates.priceNgn = rounded;
      if (rounded !== current.priceNgn) requiresReview = true;
    }

    let nextUnit = current.unit;
    if (body.unit !== undefined) {
      const candidate = String(body.unit) as VariantUnit;
      if (!Object.values(VariantUnit).includes(candidate)) {
        return NextResponse.json(
          { message: `unit must be one of: ${Object.values(VariantUnit).join(", ")}` },
          { status: 400 }
        );
      }
      nextUnit = candidate;
      updates.unit = candidate;
      if (candidate !== current.unit) requiresReview = true;
    }

    if (nextUnit !== VariantUnit.KG) {
      updates.unitWeightKg = null;
      if (current.unitWeightKg !== null) requiresReview = true;
    } else if (body.unitWeightKg !== undefined) {
      const unitWeightKg = body.unitWeightKg === null || body.unitWeightKg === "" ? null : Number(body.unitWeightKg);
      if (unitWeightKg !== null && (!Number.isFinite(unitWeightKg) || unitWeightKg <= 0)) {
        return NextResponse.json({ message: "unitWeightKg must be a positive number or null" }, { status: 400 });
      }
      updates.unitWeightKg = unitWeightKg;
      if (unitWeightKg !== current.unitWeightKg) requiresReview = true;
    }

    if (body.stockQty !== undefined) {
      const stockQty = body.stockQty === null || body.stockQty === "" ? null : Number(body.stockQty);
      if (stockQty !== null && (!Number.isFinite(stockQty) || stockQty < 0)) {
        return NextResponse.json({ message: "stockQty must be zero, a positive number, or null" }, { status: 400 });
      }
      updates.stockQty = stockQty === null ? null : Math.floor(stockQty);
    }

    const variant = await prisma.productVariant.update({ where: { id: variantId }, data: updates as never });

    if (requiresReview) {
      await prisma.product.update({ where: { id }, data: { approvalStatus: "PENDING_REVIEW" } as never });
    }

    return NextResponse.json({ variant });
  } catch (error) {
    console.error("VENDOR_VARIANT_UPDATE_ERROR", error);
    return NextResponse.json({ message: "Unable to update variant" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; variantId: string }> }
) {
  try {
    const { id, variantId } = await ctx.params;
    const access = await requireOwnedVendorProduct(id);
    if (access.ok === false) {
      return NextResponse.json({ message: access.message }, { status: access.status });
    }

    if (!access.product.variants.some((variant) => variant.id === variantId)) {
      return NextResponse.json({ message: "Variant not found" }, { status: 404 });
    }

    await prisma.productVariant.delete({ where: { id: variantId } });
    await prisma.product.update({ where: { id }, data: { approvalStatus: "PENDING_REVIEW" } as never });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("VENDOR_VARIANT_DELETE_ERROR", error);
    return NextResponse.json({ message: "Unable to delete variant" }, { status: 500 });
  }
}
