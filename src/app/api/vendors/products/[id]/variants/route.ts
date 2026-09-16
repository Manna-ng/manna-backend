import { NextResponse, type NextRequest } from "next/server";
import { VariantUnit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwnedVendorProduct } from "@/lib/vendors/vendorProductManagement";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const access = await requireOwnedVendorProduct(id);
    if (access.ok === false) {
      return NextResponse.json({ message: access.message }, { status: access.status });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const price = Number(body.priceNgn);

    if (!name || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ message: "name and a positive priceNgn are required" }, { status: 400 });
    }

    const unit =
      body.unit && Object.values(VariantUnit).includes(String(body.unit) as VariantUnit)
        ? (String(body.unit) as VariantUnit)
        : VariantUnit.PIECE;

    let unitWeightKg: number | null = null;
    if (unit === VariantUnit.KG && body.unitWeightKg !== null && body.unitWeightKg !== undefined && body.unitWeightKg !== "") {
      const parsed = Number(body.unitWeightKg);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ message: "unitWeightKg must be a positive number or null" }, { status: 400 });
      }
      unitWeightKg = parsed;
    }

    let stockQty: number | null = null;
    if (body.stockQty !== null && body.stockQty !== undefined && body.stockQty !== "") {
      const parsed = Number(body.stockQty);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json({ message: "stockQty must be zero, a positive number, or null" }, { status: 400 });
      }
      stockQty = Math.floor(parsed);
    }

    const variant = await prisma.productVariant.create({
      data: {
        productId: id,
        name,
        priceNgn: Math.round(price),
        unit,
        unitWeightKg,
        stockQty,
      },
    });

    await prisma.product.update({ where: { id }, data: { approvalStatus: "PENDING_REVIEW" } as never });
    return NextResponse.json({ variant }, { status: 201 });
  } catch (error) {
    console.error("VENDOR_VARIANT_CREATE_ERROR", error);
    return NextResponse.json({ message: "Unable to create variant" }, { status: 500 });
  }
}
