import { prisma } from "@/lib/prisma"
import { createKwikDelivery } from "@/services/kwikWebhook"

function getKwikVehicleId(): number {
  const vehicleId = Number(process.env.KWIK_VEHICLE_ID ?? "1");
  return Number.isFinite(vehicleId) && vehicleId > 0 ? vehicleId : 1;
}

export async function createDelivery(orderId: string, deliveryLat: number, deliveryLng: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true },
  })

  if (!order) throw new Error("Order not found")
  if (order.paymentStatus !== "PAID") throw new Error("Order not paid")

  const existing = await prisma.delivery.findUnique({ where: { orderId } })
  if (existing) return existing

  if (!Number.isFinite(deliveryLat) || !Number.isFinite(deliveryLng)) {
    throw new Error("deliveryLat and deliveryLng are required")
  }

 const kwik = await createKwikDelivery({
  orderId: order.id,
  customerName: order.user?.name ?? "Customer",
  customerPhone: order.user?.phone ?? "N/A",
  address: order.deliveryAddress1,
  city: order.city,
  state: order.state,
  deliveryLat,
  deliveryLng,
  amountNgn: order.deliveryFeeNgn,
  vehicleId: getKwikVehicleId(),
});

  const delivery = await prisma.delivery.create({
    data: {
      orderId: order.id,
      kwikTaskId: kwik.taskId,
      kwikTrackingUrl: kwik.trackingUrl,
      kwikRawResponse: JSON.parse(JSON.stringify(kwik.raw)) as never,
      status: "CREATED",
      partner: "KWIK",
    },
  })

  await prisma.order.update({
    where: { id: order.id },
    data: { status: "OUT_FOR_DELIVERY" },
  })

  return delivery
}
