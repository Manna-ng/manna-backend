// src/app/api/internal/order/[orderid]/create-delivery/route.ts
import { prisma } from "@/lib/prisma";
import { createKwikDelivery } from "@/services/kwikWebhook";

type Ctx = { params: Promise<{ orderid: string }> };

function getKwikVehicleId(): number {
  const vehicleId = Number(process.env.KWIK_VEHICLE_ID ?? "1");
  return Number.isFinite(vehicleId) && vehicleId > 0 ? vehicleId : 1;
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { orderid } = await ctx.params;
    const orderId = orderid;

    if (!orderId) {
      return Response.json({ error: "Missing order id in route params" }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true, delivery: true },
    });

    if (!order) return new Response("Order not found", { status: 404 });

    if (order.delivery) {
      return Response.json(order.delivery, { status: 200 });
    }

    if (order.paymentStatus !== "PAID") {
      return new Response("Order is not PAID yet", { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json(
        { error: "Missing/invalid lat,lng query params. Example: ?lat=6.515759&lng=3.3898447" },
        { status: 400 }
      );
    }

    const kwik = await createKwikDelivery({
      orderId: order.id,
      customerName: order.user?.name ?? "Customer",
      customerPhone: order.user?.phone ?? "",
      address: order.deliveryAddress1,
      city: order.city,
      state: order.state,
      amountNgn: order.deliveryFeeNgn,
      deliveryLat: lat,
      deliveryLng: lng,
      vehicleId: getKwikVehicleId(),
    });

    const delivery = await prisma.delivery.create({
      data: {
        orderId: order.id,
        kwikTaskId: String(kwik.taskId),
        kwikTrackingUrl: kwik.trackingUrl,
        kwikRawResponse: JSON.parse(JSON.stringify(kwik.raw)) as never,
        status: "CREATED",
        partner: "KWIK",
      },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { status: "OUT_FOR_DELIVERY" },
    });

    return Response.json(
  {
    delivery,
    kwik: {
      taskId: kwik.taskId,
      trackingUrl: kwik.trackingUrl,
    },
  },
  { status: 201 }
);

  } catch (err: unknown) {
    const responseData = (err as { response?: { data?: unknown } })?.response?.data;
    console.error("CREATE_DELIVERY_ERROR:", responseData ?? err);

    return Response.json(
      {
        error: "Create delivery failed",
        details: responseData ?? String((err as Error)?.message ?? err),
      },
      { status: 500 }
    );
  }
}