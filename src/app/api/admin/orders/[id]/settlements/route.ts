import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();

    if (!admin.ok) {
      return admin.response;
    }

    const { id: orderId } = await ctx.params;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        totalAmountNgn: true,
        deliveryFeeNgn: true,
        settlementStatus: true,
        settlementCalculatedAt: true,
        vendorGrossAmountNgn: true,
        mannaCommissionAmountNgn: true,
        vendorPayableAmountNgn: true,
      },
    });

    if (!order) {
      return NextResponse.json(
        { ok: false, message: "Order not found" },
        { status: 404 }
      );
    }

    const vendorOrders = await prisma.vendorOrder.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });

    const settlements = await prisma.vendorSettlement.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(
      {
        ok: true,
        order,
        vendorOrders,
        settlements,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Something went wrong";

    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}