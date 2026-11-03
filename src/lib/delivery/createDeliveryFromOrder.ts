import { prisma } from "@/lib/prisma";
import { createKwikDelivery } from "@/services/kwikWebhook";
import { selectKwikVehicleForWeight } from "@/lib/kwik/vehicleService";

export async function createDeliveryFromOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      delivery: true,
      user: true,
      items: { include: { productVariant: true, product: true } },
    },
  });

  if (!order) throw new Error("Order not found");

  if (order.deliveryQuoteId) {
    throw new Error(
      "Marketplace orders must be dispatched through the vendor-readiness stored-quote flow"
    );
  }

  if (order.delivery?.kwikTaskId || order.delivery?.kwikUniqueOrderId) {
    return order.delivery;
  }

  if (
    !Number.isFinite(order.deliveryLat ?? NaN) ||
    !Number.isFinite(order.deliveryLng ?? NaN)
  ) {
    throw new Error(
      "Order is missing deliveryLat/deliveryLng (required for KWIK)"
    );
  }

  let totalKg = 0;

  for (const item of order.items) {
    const kg = item.productVariant?.unitWeightKg;

    if (
      typeof kg !== "number" ||
      !Number.isFinite(kg) ||
      kg <= 0
    ) {
      throw new Error(
        `Missing or invalid unitWeightKg for variant in order (product: ${item.product?.name ?? "Unknown"})`
      );
    }

    totalKg +=
      kg *
      item.quantity;
  }

  totalKg =
    Math.round(totalKg * 1000) /
    1000;

  const selectedVehicle =
    await selectKwikVehicleForWeight(
      totalKg
    );

  const kwik = await createKwikDelivery({
    orderId: order.id,
    customerName:
      order.user?.name ??
      "Customer",
    customerPhone:
      order.user?.phone ??
      "",
    address:
      order.deliveryAddress1,
    city:
      order.city,
    state:
      order.state,
    deliveryLat:
      order.deliveryLat!,
    deliveryLng:
      order.deliveryLng!,
    amountNgn:
      order.deliveryFeeNgn,
    vehicleId:
      selectedVehicle.vehicleId,
  });

  const deliveryData = {
    partner: "KWIK" as const,
    status: "CREATED" as const,
    processingStatus:
      "DISPATCHED" as const,
    requiresManualDispatch:
      false,
    dispatchDeferredReason:
      null,
    kwikTaskId:
      String(kwik.taskId),
    kwikTrackingUrl:
      kwik.trackingUrl,
    kwikRawResponse:
      JSON.stringify(kwik.raw),
    kwikUniqueOrderId:
      kwik.uniqueOrderId,
    kwikJobStatus:
      1,
    kwikStatusCheckUrl:
      kwik.statusCheckUrl,
    kwikVehicleId:
      selectedVehicle.vehicleId,
    kwikVehicleLabel:
      selectedVehicle.name,
    totalWeightKg:
      totalKg,
  };

  const delivery =
    order.delivery
      ? await prisma.delivery.update({
          where: {
            id: order.delivery.id,
          },
          data: deliveryData,
        })
      : await prisma.delivery.create({
          data: {
            orderId: order.id,
            ...deliveryData,
          },
        });

  await prisma.order.update({
    where: {
      id: order.id,
    },
    data: {
      totalWeightKg:
        totalKg,
      status:
        "OUT_FOR_DELIVERY",
    },
  });

  return delivery;
}