import { createVendorOrdersForPaidMarketplaceOrder } from "@/lib/marketplace/vendorOrders";
import {
  notifyOrderPaidStakeholders,
  notifyVendorStockState,
} from "@/lib/notifications/eventTriggers";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardV14OrderMutationIfReleased, isV14OrderLockReleased } from "@/lib/marketplace/orderV14ReleaseGuard";

export const runtime = "nodejs"; // important for crypto

function verifyPaystackSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return false;

  const hash = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex");

  return hash === signature;
}

async function prepareLegacyMarketplaceOrderForVendors(
  orderId: string
) {
  await prisma.delivery.upsert({
    where: { orderId },
    update: {
      processingStatus: "QUEUED",
      requiresManualDispatch: false,
      scheduledDispatchAt: null,
      dispatchDeferredReason:
        "WAITING_FOR_VENDOR_READY",
    },
    create: {
      orderId,
      partner: "KWIK",
      status: "CREATED",
      processingStatus: "QUEUED",
      requiresManualDispatch: false,
      dispatchDeferredReason:
        "WAITING_FOR_VENDOR_READY",
    },
  });

  const result =
    await createVendorOrdersForPaidMarketplaceOrder(
      orderId
    );

  await notifyOrderPaidStakeholders(
    orderId
  ).catch(() => undefined);

  return result;
}
export async function POST(req: Request) {
  try {
    const rawBody = await req.text(); // must be RAW
    const signature = req.headers.get("x-paystack-signature");

    if (!verifyPaystackSignature(rawBody, signature)) {
      return NextResponse.json({ ok: false, message: "Invalid signature" }, { status: 401 });
    }

    const event = JSON.parse(rawBody);

    // Paystack success event is usually: "charge.success"
    if (event?.event !== "charge.success") {
      return NextResponse.json({ ok: true, message: "Ignored event" }, { status: 200 });
    }

    const reference: string | undefined = event?.data?.reference;
    if (!reference) {
      return NextResponse.json({ ok: false, message: "Missing reference" }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: { paymentReference: reference },
      include: { items: { include: { productVariant: true, product: true } } },
    });

    if (!order) return NextResponse.json({ ok: false, message: "Order not found" }, { status: 404 });

    // idempotent + marketplace/notification catch-up
    if (order.paymentStatus === "PAID") {
      if (order.deliveryQuoteId) {
        await prepareLegacyMarketplaceOrderForVendors(
          order.id
        );
      } else {
        await notifyOrderPaidStakeholders(
          order.id
        ).catch(() => undefined);
      }

      return NextResponse.json({ ok: true, message: "Already processed" }, { status: 200 });
    }

    await prisma.$transaction(async (tx) => {
      await guardV14OrderMutationIfReleased(tx, order.id);
      // This guarded branch is dormant until a separately reviewed global release.
      // It re-reads payment identity AFTER the row lock, before stock mutation.
      if (isV14OrderLockReleased()) {
        const lockedOrder = await tx.order.findUnique({
          where: { id: order.id },
          select: { paymentStatus: true, paymentReference: true },
        });
        if (!lockedOrder || lockedOrder.paymentReference !== reference ||
          lockedOrder.paymentStatus !== "PENDING") {
          throw new Error("Payment state changed while processing signed charge event; reconcile before retry.");
        }
      }
      // deduct stock
      for (const item of order.items) {
        const pv = item.productVariant;
        if (!pv) continue;
        if (pv.stockQty === null || pv.stockQty === undefined) continue;

        const updated = await tx.productVariant.updateMany({
          where: { id: pv.id, stockQty: { gte: item.quantity } },
          data: { stockQty: { decrement: item.quantity } },
        });

        if (updated.count !== 1) {
          throw new Error(`Insufficient stock: ${item.product.name} - ${pv.name}`);
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: "PAID", status: "PROCESSING", paidAt: new Date() },
      });
    });

    const changedVariantIds =
      Array.from(
        new Set(
          order.items
            .map(
              (item) =>
                item.productVariant?.id
            )
            .filter(
              (id): id is string =>
                Boolean(id)
            )
        )
      );

    await Promise.all(
      changedVariantIds.map(
        (variantId) =>
          notifyVendorStockState(
            variantId
          ).catch(() => undefined)
      )
    );

    if (order.deliveryQuoteId) {
      await prepareLegacyMarketplaceOrderForVendors(
        order.id
      );
    } else {
      await notifyOrderPaidStakeholders(
        order.id
      ).catch(() => undefined);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    let message = "Something went wrong";
    if (err instanceof Error && err.message) {
      message = err.message;
    } else if (typeof err === "string") {
      message = err;
    }

    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
