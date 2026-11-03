import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createDeliveryFromOrder } from "@/lib/delivery/createDeliveryFromOrder";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: deliveryId } = await params;
    const admin = await requireAdmin();

    if (!admin.ok) {
      return admin.response;
    }


    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        orderId: true,
        processingStatus: true,
        requiresManualDispatch: true,
        kwikTaskId: true,
      },
    });

    if (!delivery) {
      return NextResponse.json(
        { ok: false, message: "Delivery not found" },
        { status: 404 }
      );
    }

    if (delivery.kwikTaskId) {
      return NextResponse.json(
        {
          ok: false,
          message: "Delivery has already been dispatched",
        },
        { status: 409 }
      );
    }

    if (delivery.processingStatus !== "QUEUED") {
      return NextResponse.json(
        {
          ok: false,
          message: "Delivery is not queued for manual dispatch",
        },
        { status: 409 }
      );
    }

    if (!delivery.requiresManualDispatch) {
      return NextResponse.json(
        {
          ok: false,
          message: "This delivery does not require manual dispatch",
        },
        { status: 409 }
      );
    }

    const claimed = await prisma.delivery.updateMany({
      where: {
        id: delivery.id,
        kwikTaskId: null,
        processingStatus: "QUEUED",
        requiresManualDispatch: true,
      },
      data: {
        processingStatus: "READY_FOR_DISPATCH",
        requiresManualDispatch: false,
        dispatchDeferredReason: null,
        scheduledDispatchAt: null,
      },
    });

    if (claimed.count !== 1) {
      return NextResponse.json(
        {
          ok: false,
          message: "Delivery dispatch is already being processed",
        },
        { status: 409 }
      );
    }

    const dispatchedDelivery = await createDeliveryFromOrder(delivery.orderId);

    return NextResponse.json({
      ok: true,
      message: "Delivery dispatched successfully",
      deliveryId: dispatchedDelivery.id,
      orderId: delivery.orderId,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Something went wrong";

    return NextResponse.json(
      { ok: false, message },
      { status: 400 }
    );
  }
}