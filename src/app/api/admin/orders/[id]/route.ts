import {
  NextResponse,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";

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

  const [
    order,
    vendorOrders,
    settlements,
    kwikTasks,
    feedback,
  ] = await Promise.all([
    prisma.order.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        delivery: true,
        payments: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                imageUrl: true,
                vendorId: true,
              },
            },
            productVariant:
              true,
          },
        },
      },
    }),
    prisma.vendorOrder.findMany({
      where: {
        orderId: id,
      },
      include: {
        items: true,
        readinessEvents:
          true,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
    prisma.vendorSettlement.findMany({
      where: {
        orderId: id,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
    prisma.kwikDeliveryTask.findMany({
      where: {
        orderId: id,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.customerFeedback.findMany({
      where: {
        orderId: id,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
  ]);

  if (!order) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Order not found",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    order,
    vendorOrders,
    settlements,
    kwikTasks,
    feedback,
  });
}
