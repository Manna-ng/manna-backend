import {
  NextResponse,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";
import {
  notifyOrderCancelledStakeholders,
} from "@/lib/notifications/eventTriggers";

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

  const order =
    await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
      },
    });

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

  if (
    order.paymentStatus ===
    "PAID"
  ) {
    return NextResponse.json(
      {
        ok: false,
        code:
          "PAID_ORDER_REFUND_REQUIRED",
        message:
          "Paid orders cannot be cancelled through the simple status path. Use the refund/dispute workflow once it is enabled.",
      },
      { status: 409 }
    );
  }

  if (
    order.status !==
      "PENDING_PAYMENT" ||
    order.paymentStatus !==
      "PENDING"
  ) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Only unpaid pending orders can be cancelled directly.",
      },
      { status: 409 }
    );
  }

  await prisma.order.update({
    where: { id },
    data: {
      status: "CANCELLED",
    },
  });

  await notifyOrderCancelledStakeholders(
    id
  ).catch(
    () => undefined
  );

  return NextResponse.json({
    ok: true,
  });
}
