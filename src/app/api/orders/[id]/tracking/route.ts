import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return Response.json({ ok: false, error: msg }, { status });
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const url = new URL(req.url);
    const { id: paramId } = await ctx.params;

    const queryId = url.searchParams.get("orderId") || url.searchParams.get("id");
    const orderId = String(paramId || queryId || "").trim();

    if (!orderId) {
      return bad(
        "Missing id param. Your route is /api/orders/[id]/tracking so call /api/orders/<id>/tracking",
        400
      );
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { delivery: true },
    });

    if (!order) {
      return bad("Order not found", 404);
    }

    const delivery = order.delivery;

    const orFilters: Prisma.DeliveryWebhookEventWhereInput[] = [
      ...(delivery?.kwikTaskId ? [{ jobId: delivery.kwikTaskId }] : []),
      ...(delivery?.kwikUniqueOrderId
        ? [{ uniqueOrderId: delivery.kwikUniqueOrderId }]
        : []),
    ];

    const events = delivery
      ? await prisma.deliveryWebhookEvent.findMany({
          where: orFilters.length ? { OR: orFilters } : undefined,
          orderBy: { receivedAt: "asc" },
          take: 50,
        })
      : [];

    return Response.json({
      ok: true,
      debug: { paramId: paramId ?? null, queryId: queryId ?? null },
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        deliveryPartner: order.deliveryPartner,
        createdAt: order.createdAt,
      },
      delivery: delivery
        ? {
            id: delivery.id,
            status: delivery.status,
            partner: delivery.partner,
            kwikTaskId: delivery.kwikTaskId,
            kwikUniqueOrderId: delivery.kwikUniqueOrderId,
            kwikJobStatus: delivery.kwikJobStatus,
            kwikTrackingUrl: delivery.kwikTrackingUrl,
            lastWebhookAt: delivery.lastWebhookAt,
            lastStatusCheckAt: delivery.lastStatusCheckAt,
            statusCheckAttempts: delivery.statusCheckAttempts,
            nextStatusCheckAt: delivery.nextStatusCheckAt,
            lastStatusCheckError: delivery.lastStatusCheckError,
            updatedAt: delivery.updatedAt,
          }
        : null,
      timeline: events.map((event) => ({
        id: event.id,
        jobId: event.jobId,
        uniqueOrderId: event.uniqueOrderId,
        jobStatus: event.jobStatus,
        receivedAt: event.receivedAt,
        processedAt: event.processedAt,
        status: event.status,
        error: event.error,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "tracking_error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
