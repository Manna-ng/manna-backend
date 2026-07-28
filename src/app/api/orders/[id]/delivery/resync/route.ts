import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getKwikJobStatus } from "@/services/kwikWebhook";
import {
  canMoveForward,
  mapKwikStatusToDeliveryStatus,
  type DeliveryStatus,
} from "@/lib/kwik-status";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id: orderId } = await ctx.params;

    if (!orderId) return bad("Missing order id");

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { delivery: true },
    });

    if (!order) return bad("Order not found", 404);
    if (!order.delivery) return bad("Order has no delivery", 400);

    const delivery = order.delivery;
    if (!delivery.kwikTaskId) {
      return bad("Delivery missing kwikTaskId (job id)", 400);
    }

    const kwik = await getKwikJobStatus({
      jobId: delivery.kwikTaskId,
      statusCheckUrl: delivery.kwikStatusCheckUrl ?? null,
    });

    const jobStatus = kwik.job_status;
    const mappedStatus = mapKwikStatusToDeliveryStatus(jobStatus);

    const deliveryData: Prisma.DeliveryUpdateInput = {
      kwikJobStatus: jobStatus,
      lastStatusCheckAt: new Date(),
      lastStatusCheckError: null,
      statusCheckAttempts: 0,
      nextStatusCheckAt: null,
      kwikRawResponse: kwik.raw as Prisma.InputJsonValue,
    };

    if (kwik.unique_order_id && !delivery.kwikUniqueOrderId) {
      deliveryData.kwikUniqueOrderId = kwik.unique_order_id;
    }

    if (kwik.tracking_url && !delivery.kwikTrackingUrl) {
      deliveryData.kwikTrackingUrl = kwik.tracking_url;
    }

    const currentStatus = delivery.status as DeliveryStatus;
    const shouldUpdate =
      currentStatus !== mappedStatus && canMoveForward(currentStatus, mappedStatus);

    if (shouldUpdate) {
      deliveryData.status = mappedStatus;
    }

    if (mappedStatus === "DELIVERED") {
      deliveryData.deliveredAt = delivery.deliveredAt ?? new Date();
      deliveryData.kwikLastTerminalStatus = jobStatus;
    }

    await prisma.$transaction(async (tx) => {
      await tx.delivery.update({ where: { id: delivery.id }, data: deliveryData });

      if (mappedStatus === "DELIVERED") {
        await tx.order.update({ where: { id: orderId }, data: { status: "DELIVERED" } });
      } else if (mappedStatus === "FAILED" || mappedStatus === "CANCELLED") {
        if (order.status !== "DELIVERED") {
          await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
        }
      } else if (mappedStatus === "ASSIGNED" || mappedStatus === "IN_TRANSIT") {
        if (order.status !== "DELIVERED") {
          await tx.order.update({ where: { id: orderId }, data: { status: "OUT_FOR_DELIVERY" } });
        }
      }
    });

    return Response.json({
      ok: true,
      orderId,
      deliveryId: delivery.id,
      jobId: delivery.kwikTaskId,
      jobStatus,
      mappedStatus,
      updated: shouldUpdate,
      usedEndpoint: kwik.usedEndpoint,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "resync_error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
