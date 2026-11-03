/**
 * V14R2: SELECT-only, NOT HTTP-exposed. Requires V14 migration before invocation.
 * No provider calls or database writes. A preview is NOT an authorization.
 * The next phase must recheck under the SAME lock used by vendor readiness,
 * Kwik dispatch, settlement generation and withdrawal before a refund hold.
 */
import { prisma } from "@/lib/prisma";
import {
  assessRefundPreview,
  type RefundPreview,
} from "@/lib/marketplace/orderRefundPolicy";

export async function readOrderRefundPreview(orderId: string): Promise<RefundPreview | null> {
  if (!orderId.trim()) throw new Error("Order ID required");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      paymentProvider: true,
      paymentReference: true,
      totalAmountNgn: true,
      payments: {
        select: { provider: true, reference: true, amountNgn: true,
                  currency: true, status: true },
      },
      delivery: {
        select: {
          status: true, processingStatus: true,
          kwikTaskId: true, kwikUniqueOrderId: true, lastWebhookAt: true,
        },
      },
      refund: { select: { status: true } },
    },
  });
  if (!order) return null;

  const [vendorOrders, vendorSettlementCount, kwikTaskCount] = await Promise.all([
    prisma.vendorOrder.findMany({
      where: { orderId },
      select: {
        status: true,
        confirmedAt: true, packingStartedAt: true,
        readyForPickupAt: true, pickedUpAt: true,
      },
    }),
    prisma.vendorSettlement.count({ where: { orderId } }),
    prisma.kwikDeliveryTask.count({ where: { orderId } }),
  ]);

  return assessRefundPreview({
    order: {
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentProvider: order.paymentProvider,
      paymentReference: order.paymentReference,
      totalAmountNgn: order.totalAmountNgn,
    },
    attempts: order.payments,
    vendorOrders,
    delivery: order.delivery,
    vendorSettlementCount,
    kwikTaskCount,
    existingRefund: order.refund,
  });
}
