import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAuthToken } from "@/lib/auth";

type VendorMembership = {
  vendorId: string;
};

function unauthorized() {
  return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  try {
    const store = await cookies();
    const token = store.get("manna_token")?.value;
    const decoded = token ? verifyAuthToken(token) : null;

    if (!decoded?.userId) return unauthorized();

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limitParam = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isInteger(limitParam)
      ? Math.min(Math.max(limitParam, 1), 100)
      : 50;

    const memberships = (await prisma.vendorUser.findMany({
      where: { userId: decoded.userId, isActive: true },
      select: { vendorId: true },
    })) as VendorMembership[];

    const vendorIds = memberships.map((membership) => membership.vendorId);

    if (vendorIds.length === 0) {
      return NextResponse.json({ ok: true, vendorOrders: [] });
    }

    // VendorOrderItem stores scalar product IDs. It does not expose Prisma
    // relations named `product` / `productVariant`, so resolve display data
    // separately and enrich the response without changing financial/order rows.
    const rawVendorOrders = await prisma.vendorOrder.findMany({
      where: {
        vendorId: { in: vendorIds },
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { items: true },
    });

    const productIds = [
      ...new Set(
        rawVendorOrders.flatMap((order) =>
          order.items.map((item) => item.productId)
        )
      ),
    ];

    const productVariantIds = [
      ...new Set(
        rawVendorOrders.flatMap((order) =>
          order.items.flatMap((item) =>
            item.productVariantId ? [item.productVariantId] : []
          )
        )
      ),
    ];

    const [products, productVariants] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, imageUrl: true },
      }),
      prisma.productVariant.findMany({
        where: { id: { in: productVariantIds } },
        select: { id: true, name: true, unit: true },
      }),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const productVariantById = new Map(
      productVariants.map((variant) => [variant.id, variant])
    );

    const vendorOrders = rawVendorOrders.map((order) => ({
      ...order,
      items: order.items.map((item) => ({
        ...item,
        product: productById.get(item.productId) ?? null,
        productVariant: item.productVariantId
          ? productVariantById.get(item.productVariantId) ?? null
          : null,
      })),
    }));

    return NextResponse.json({ ok: true, vendorOrders });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}