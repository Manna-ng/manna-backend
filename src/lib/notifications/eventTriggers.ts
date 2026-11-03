import { prisma } from "@/lib/prisma";
import { createNotification, createNotificationOnce } from "./notificationService";

type AdminRecipient = {
  recipientRole: "ADMIN";
  recipientUserId: string;
};

async function getAdminRecipients(): Promise<AdminRecipient[]> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  return admins.map((admin) => ({ recipientRole: "ADMIN", recipientUserId: admin.id }));
}

export async function notifyAdminVendorRegistered(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, displayName: true, marketClusterId: true },
  });

  if (!vendor) return null;

  return createNotificationOnce({
    eventType: "VENDOR_REGISTERED",
    category: "VENDOR",
    priority: "HIGH",
    title: "New vendor registration",
    body: `${vendor.displayName} submitted a vendor registration for review.`,
    actionUrl: `/admin/vendors/${vendor.id}`,
    actionLabel: "Review vendor",
    vendorId: vendor.id,
    marketClusterId: vendor.marketClusterId,
    recipients: await getAdminRecipients(),
  });
}

export async function notifyVendorApproved(vendorId: string) {
  const vendorUsers = await prisma.vendorUser.findMany({
    where: { vendorId, isActive: true },
    select: { userId: true, vendor: { select: { displayName: true } } },
  });

  if (vendorUsers.length === 0) return null;

  return createNotificationOnce({
    eventType: "VENDOR_APPROVED",
    category: "VENDOR",
    priority: "HIGH",
    title: "Your store is approved",
    body: `${vendorUsers[0].vendor.displayName} can now sell on Manna.`,
    actionUrl: "/vendor/dashboard",
    actionLabel: "Open dashboard",
    vendorId,
    recipients: vendorUsers.map((item) => ({
      recipientRole: "VENDOR",
      recipientUserId: item.userId,
      vendorId,
    })),
  });
}

export async function notifyVendorNewOrder(vendorOrderId: string) {
  const vendorOrder = await prisma.vendorOrder.findUnique({
    where: { id: vendorOrderId },
    select: {
      id: true,
      orderId: true,
      vendorId: true,
      marketClusterId: true,
      grossAmountNgn: true,
    },
  });

  if (!vendorOrder) return null;

  const vendorUsers = await prisma.vendorUser.findMany({
    where: { vendorId: vendorOrder.vendorId, isActive: true },
    select: { userId: true },
  });

  return createNotificationOnce({
    eventType: "VENDOR_NEW_ORDER",
    category: "ORDER",
    priority: "URGENT",
    title: "New order received",
    body: `Prepare the items for this order. Total: Ã¢â€šÂ¦${vendorOrder.grossAmountNgn.toLocaleString("en-NG")}.`,
    actionUrl: `/vendor/orders/${vendorOrder.id}`,
    actionLabel: "View order",
    orderId: vendorOrder.orderId,
    vendorId: vendorOrder.vendorId,
    vendorOrderId: vendorOrder.id,
    marketClusterId: vendorOrder.marketClusterId,
    recipients: vendorUsers.map((user) => ({
      recipientRole: "VENDOR",
      recipientUserId: user.userId,
      vendorId: vendorOrder.vendorId,
    })),
  });
}

export async function notifyCustomerOrderPaid(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, orderNumber: true },
  });

  if (!order?.userId) return null;

  return createNotificationOnce({
    eventType: "CUSTOMER_ORDER_PAID",
    category: "PAYMENT",
    priority: "HIGH",
    title: "Payment received",
    body: `Your Manna order ${order.orderNumber} has been received. Vendors are preparing your items.`,
    actionUrl: `/orders/${order.id}`,
    actionLabel: "Track order",
    orderId: order.id,
    recipients: [{ recipientRole: "CUSTOMER", recipientUserId: order.userId }],
  });
}

export async function notifyCustomerDeliveryStarted(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, orderNumber: true, delivery: { select: { id: true } } },
  });

  if (!order?.userId) return null;

  return createNotificationOnce({
    eventType: "CUSTOMER_DELIVERY_STARTED",
    category: "DELIVERY",
    priority: "HIGH",
    title: "Your order is on the way",
    body: `Your Manna order ${order.orderNumber} has been picked up and is on the way.`,
    actionUrl: `/orders/${order.id}/tracking`,
    actionLabel: "Track delivery",
    orderId: order.id,
    deliveryId: order.delivery?.id ?? null,
    recipients: [{ recipientRole: "CUSTOMER", recipientUserId: order.userId }],
  });
}

export async function notifyCustomerOrderDeliveredFeedback(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, orderNumber: true, delivery: { select: { id: true } } },
  });

  if (!order?.userId) return null;

  return createNotificationOnce({
    eventType: "CUSTOMER_ORDER_DELIVERED_FEEDBACK",
    category: "FEEDBACK",
    priority: "HIGH",
    title: "Order delivered",
    body: `Your Manna order ${order.orderNumber} has been delivered. Please tell us how it went.`,
    actionUrl: `/orders/${order.id}/feedback`,
    actionLabel: "Give feedback",
    orderId: order.id,
    deliveryId: order.delivery?.id ?? null,
    recipients: [{ recipientRole: "CUSTOMER", recipientUserId: order.userId }],
  });
}

export async function notifyAdminDeliveryFailed(orderId: string, reason?: string | null) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, delivery: { select: { id: true } } },
  });

  if (!order) return null;

  return createNotificationOnce({
    eventType: "ADMIN_DELIVERY_FAILED",
    category: "DELIVERY",
    priority: "URGENT",
    title: "Delivery issue needs attention",
    body: `Order ${order.orderNumber} has a delivery problem${reason ? `: ${reason}` : "."}`,
    actionUrl: `/admin/orders/${order.id}`,
    actionLabel: "Review order",
    orderId: order.id,
    deliveryId: order.delivery?.id ?? null,
    recipients: await getAdminRecipients(),
  });
}

export async function notifyVendorSettlementGenerated(vendorId: string, settlementId: string) {
  const settlement = await prisma.vendorSettlement.findUnique({
    where: { id: settlementId },
    select: { id: true, payableAmountNgn: true, orderId: true },
  });

  if (!settlement) return null;

  const vendorUsers = await prisma.vendorUser.findMany({
    where: { vendorId, isActive: true },
    select: { userId: true },
  });

  return createNotificationOnce({
    eventType: "VENDOR_SETTLEMENT_GENERATED",
    category: "SETTLEMENT",
    priority: "NORMAL",
    title: "Settlement created",
    body: `Ã¢â€šÂ¦${settlement.payableAmountNgn.toLocaleString("en-NG")} is pending payout for a delivered order.`,
    actionUrl: `/vendor/settlements/${settlement.id}`,
    actionLabel: "View settlement",
    orderId: settlement.orderId,
    vendorId,
    recipients: vendorUsers.map((user) => ({
      recipientRole: "VENDOR",
      recipientUserId: user.userId,
      vendorId,
    })),
  });
}
type DeliveryEventStatus =
  | "CREATED"
  | "ASSIGNED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED";

async function notifyAdminOrderPaid(
  orderId: string
) {
  const order =
    await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        totalAmountNgn: true,
      },
    });

  if (!order) return null;

  return createNotificationOnce({
    eventType: "ADMIN_ORDER_PAID",
    category: "ORDER",
    priority: "NORMAL",
    title: "New paid order",
    body: `Order ${order.orderNumber} has been paid. Total: Ã¢â€šÂ¦${order.totalAmountNgn.toLocaleString("en-NG")}.`,
    actionUrl: `/admin/orders/${order.id}`,
    actionLabel: "View order",
    orderId: order.id,
    recipients:
      await getAdminRecipients(),
  });
}

export async function notifyOrderPaidStakeholders(
  orderId: string
) {
  const results: unknown[] = [];

  const customerResult =
    await notifyCustomerOrderPaid(
      orderId
    ).catch(() => null);

  if (customerResult) {
    results.push(customerResult);
  }

  const vendorOrders =
    await prisma.vendorOrder.findMany({
      where: { orderId },
      select: { id: true },
    });

  for (const vendorOrder of vendorOrders) {
    const result =
      await notifyVendorNewOrder(
        vendorOrder.id
      ).catch(() => null);

    if (result) {
      results.push(result);
    }
  }

  const adminResult =
    await notifyAdminOrderPaid(
      orderId
    ).catch(() => null);

  if (adminResult) {
    results.push(adminResult);
  }

  return results;
}

async function vendorOrderRecipients(
  vendorId: string
) {
  const users =
    await prisma.vendorUser.findMany({
      where: {
        vendorId,
        isActive: true,
      },
      select: {
        userId: true,
      },
    });

  return users.map((user) => ({
    recipientRole:
      "VENDOR" as const,
    recipientUserId:
      user.userId,
    vendorId,
  }));
}

export async function notifyDeliveryStatusChanged(
  orderId: string,
  nextStatus: DeliveryEventStatus
) {

  const order =
    await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        userId: true,
        delivery: {
          select: {
            id: true,
          },
        },
      },
    });

  if (!order) return [];

  const vendorOrders =
    await prisma.vendorOrder.findMany({
      where: { orderId },
      select: {
        id: true,
        vendorId: true,
      },
    });

  const results: unknown[] = [];

  for (
    const vendorOrder
    of vendorOrders
  ) {
    const recipients =
      await vendorOrderRecipients(
        vendorOrder.vendorId
      );

    if (recipients.length === 0) {
      continue;
    }

    let title: string | null = null;
    let body: string | null = null;
    let priority:
      | "NORMAL"
      | "HIGH"
      | "URGENT" =
        "NORMAL";

    if (nextStatus === "ASSIGNED") {
      title = "Rider assigned";
      body = `A rider has been assigned for order ${order.orderNumber}. Keep the package ready for pickup.`;
      priority = "HIGH";
    } else if (
      nextStatus === "PICKED_UP" ||
      nextStatus === "IN_TRANSIT"
    ) {
      title = "Package picked up";
      body = `Your package for order ${order.orderNumber} has been picked up and is on the way to the customer.`;
      priority = "NORMAL";
    } else if (
      nextStatus === "DELIVERED"
    ) {
      title = "Order delivered";
      body = `Order ${order.orderNumber} has been delivered successfully. Your eligible earnings will move into settlement.`;
      priority = "NORMAL";
    } else if (
      nextStatus === "FAILED" ||
      nextStatus === "CANCELLED"
    ) {
      title = "Delivery problem";
      body = `Order ${order.orderNumber} has a delivery issue. Manna is reviewing it.`;
      priority = "URGENT";
    }

    if (title && body) {
      const vendorResult =
        await createNotificationOnce({
          eventType:
            `VENDOR_DELIVERY_${nextStatus}`,
          category: "DELIVERY",
          priority,
          title,
          body,
          actionUrl:
            `/vendor/orders/${vendorOrder.id}`,
          actionLabel:
            "View order",
          orderId,
          vendorId:
            vendorOrder.vendorId,
          vendorOrderId:
            vendorOrder.id,
          deliveryId:
            order.delivery?.id ?? null,
          recipients,
        }).catch(() => null);

      if (vendorResult) {
        results.push(vendorResult);
      }
    }
  }

  if (
    nextStatus === "PICKED_UP" ||
    nextStatus === "IN_TRANSIT"
  ) {
    const result =
      await notifyCustomerDeliveryStarted(
        orderId
      ).catch(() => null);

    if (result) results.push(result);
  }

  if (nextStatus === "DELIVERED") {
    const customerResult =
      await notifyCustomerOrderDeliveredFeedback(
        orderId
      ).catch(() => null);

    if (customerResult) {
      results.push(customerResult);
    }

    const adminResult =
      await createNotificationOnce({
        eventType:
          "ADMIN_ORDER_DELIVERED",
        category: "DELIVERY",
        priority: "NORMAL",
        title: "Order delivered",
        body: `Order ${order.orderNumber} has been delivered successfully.`,
        actionUrl:
          `/admin/orders/${order.id}`,
        actionLabel:
          "View order",
        orderId,
        deliveryId:
          order.delivery?.id ?? null,
        recipients:
          await getAdminRecipients(),
      }).catch(() => null);

    if (adminResult) {
      results.push(adminResult);
    }
  }

  if (
    nextStatus === "FAILED" ||
    nextStatus === "CANCELLED"
  ) {
    const adminResult =
      await notifyAdminDeliveryFailed(
        orderId,
        `Kwik status: ${nextStatus}`
      ).catch(() => null);

    if (adminResult) {
      results.push(adminResult);
    }

    if (order.userId) {
      const customerResult =
        await createNotificationOnce({
          eventType:
            `CUSTOMER_DELIVERY_${nextStatus}`,
          category: "DELIVERY",
          priority: "HIGH",
          title: "Delivery update",
          body: `There is an issue with delivery for order ${order.orderNumber}. Manna is reviewing it.`,
          actionUrl:
            `/orders/${order.id}/tracking`,
          actionLabel:
            "View delivery",
          orderId,
          deliveryId:
            order.delivery?.id ?? null,
          recipients: [{
            recipientRole:
              "CUSTOMER",
            recipientUserId:
              order.userId,
          }],
        }).catch(() => null);

      if (customerResult) {
        results.push(customerResult);
      }
    }
  }

  return results;
}

const STOCK_EVENT_TYPES = [
  "VENDOR_LOW_STOCK",
  "VENDOR_OUT_OF_STOCK",
  "VENDOR_BACK_IN_STOCK",
] as const;

export async function notifyVendorStockState(
  variantId: string
) {
  const variant =
    await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        name: true,
        stockQty: true,
        product: {
          select: {
            id: true,
            name: true,
            vendorId: true,
          },
        },
      },
    });

  if (
    !variant ||
    variant.stockQty === null ||
    !variant.product.vendorId
  ) {
    return null;
  }

  const thresholdRaw =
    Number(
      process.env
        .VENDOR_LOW_STOCK_THRESHOLD ??
      "5"
    );

  const threshold =
    Number.isFinite(thresholdRaw) &&
    thresholdRaw >= 1
      ? Math.floor(thresholdRaw)
      : 5;

  const actionUrl =
    `/vendor/products/${variant.product.id}?variantId=${variant.id}`;

  const previous =
    await prisma.notification.findFirst({
      where: {
        vendorId:
          variant.product.vendorId,
        actionUrl,
        eventType: {
          in: [
            ...STOCK_EVENT_TYPES,
          ],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        eventType: true,
      },
    });

  let eventType:
    typeof STOCK_EVENT_TYPES[number] |
    null = null;

  let title = "";
  let body = "";
  let priority:
    | "NORMAL"
    | "HIGH"
    | "URGENT" =
      "NORMAL";

  if (variant.stockQty === 0) {
    eventType =
      "VENDOR_OUT_OF_STOCK";
    title = "Product out of stock";
    body = `${variant.product.name} Ã¢â‚¬â€œ ${variant.name} is now out of stock. Update stock to keep it available to customers.`;
    priority = "HIGH";
  } else if (
    variant.stockQty <= threshold
  ) {
    eventType =
      "VENDOR_LOW_STOCK";
    title = "Low stock";
    body = `${variant.product.name} Ã¢â‚¬â€œ ${variant.name} has only ${variant.stockQty} left.`;
    priority = "NORMAL";
  } else if (
    previous?.eventType ===
      "VENDOR_LOW_STOCK" ||
    previous?.eventType ===
      "VENDOR_OUT_OF_STOCK"
  ) {
    eventType =
      "VENDOR_BACK_IN_STOCK";
    title = "Stock replenished";
    body = `${variant.product.name} Ã¢â‚¬â€œ ${variant.name} is back in stock with ${variant.stockQty} available.`;
    priority = "NORMAL";
  }

  if (
    !eventType ||
    previous?.eventType === eventType
  ) {
    return null;
  }

  const recipients =
    await vendorOrderRecipients(
      variant.product.vendorId
    );

  if (recipients.length === 0) {
    return null;
  }

  const vendorNotification =
    await createNotification({
      eventType,
      category: "INVENTORY",
      priority,
      title,
      body,
      actionUrl,
      actionLabel:
        "Manage product",
      vendorId:
        variant.product.vendorId,
      recipients,
    });

  if (
    eventType ===
    "VENDOR_OUT_OF_STOCK"
  ) {
    await createNotification({
      eventType:
        "ADMIN_VENDOR_OUT_OF_STOCK",
      category: "INVENTORY",
      priority: "NORMAL",
      title:
        "Vendor product out of stock",
      body: `${variant.product.name} Ã¢â‚¬â€œ ${variant.name} is out of stock.`,
      actionUrl:
        `/admin/products/${variant.product.id}`,
      actionLabel:
        "View product",
      vendorId:
        variant.product.vendorId,
      recipients:
        await getAdminRecipients(),
    }).catch(() => undefined);
  }

  return vendorNotification;
}

export async function notifySettlementAvailabilityForOrder(
  orderId: string
) {
  const settlements =
    await prisma.vendorSettlement.findMany({
      where: {
        orderId,
        status: {
          in: ["AVAILABLE", "PENDING_PAYOUT"],
        },
      },
      select: {
        id: true,
        vendorId: true,
      },
    });

  const results: unknown[] = [];

  for (
    const settlement
    of settlements
  ) {
    const result =
      await notifyVendorSettlementGenerated(
        settlement.vendorId,
        settlement.id
      ).catch(() => null);

    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Withdrawal hooks.
 * The payout module should call these at the corresponding Paystack
 * transfer lifecycle transitions.
 */
export async function notifyVendorWithdrawalRequested(
  vendorId: string,
  amountNgn: number,
  reference: string
) {
  const recipients =
    await vendorOrderRecipients(vendorId);

  if (recipients.length === 0) {
    return null;
  }

  return createNotification({
    eventType:
      "VENDOR_WITHDRAWAL_REQUESTED",
    category: "SETTLEMENT",
    priority: "NORMAL",
    title: "Withdrawal processing",
    body: `Your Ã¢â€šÂ¦${amountNgn.toLocaleString("en-NG")} withdrawal is being processed.`,
    actionUrl:
      "/vendor/settlements",
    actionLabel:
      "View balance",
    vendorId,
    metadata: {
      payoutReference: reference,
    },
    recipients,
  });
}

export async function notifyVendorWithdrawalSucceeded(
  vendorId: string,
  amountNgn: number,
  reference: string
) {
  const recipients =
    await vendorOrderRecipients(vendorId);

  if (recipients.length === 0) {
    return null;
  }

  return createNotification({
    eventType:
      "VENDOR_WITHDRAWAL_SUCCESS",
    category: "SETTLEMENT",
    priority: "HIGH",
    title: "Withdrawal successful",
    body: `Ã¢â€šÂ¦${amountNgn.toLocaleString("en-NG")} has been sent to your payout account.`,
    actionUrl:
      "/vendor/settlements",
    actionLabel:
      "View balance",
    vendorId,
    metadata: {
      payoutReference: reference,
    },
    recipients,
  });
}

export async function notifyVendorWithdrawalFailed(
  vendorId: string,
  amountNgn: number,
  reference: string,
  reason?: string | null
) {
  const recipients =
    await vendorOrderRecipients(vendorId);

  const vendorNotification =
    recipients.length > 0
      ? await createNotification({
          eventType:
            "VENDOR_WITHDRAWAL_FAILED",
          category: "SETTLEMENT",
          priority: "URGENT",
          title: "Withdrawal failed",
          body: `Your Ã¢â€šÂ¦${amountNgn.toLocaleString("en-NG")} withdrawal was not completed${reason ? `: ${reason}` : "."}`,
          actionUrl:
            "/vendor/settlements",
          actionLabel:
            "View balance",
          vendorId,
          metadata: {
            payoutReference:
              reference,
          },
          recipients,
        })
      : null;

  await createNotification({
    eventType:
      "ADMIN_VENDOR_WITHDRAWAL_FAILED",
    category: "SETTLEMENT",
    priority: "URGENT",
    title: "Vendor payout failed",
    body: `A Ã¢â€šÂ¦${amountNgn.toLocaleString("en-NG")} vendor payout failed${reason ? `: ${reason}` : "."}`,
    actionUrl:
      "/admin/vendors",
    actionLabel:
      "Review payout",
    vendorId,
    metadata: {
      payoutReference:
        reference,
    },
    recipients:
      await getAdminRecipients(),
  }).catch(() => undefined);

  return vendorNotification;
}
export async function notifyOrderCancelledStakeholders(
  orderId: string
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      paymentStatus: true,
    },
  });

  if (!order) return [];

  const vendorOrders = await prisma.vendorOrder.findMany({
    where: { orderId },
    select: {
      id: true,
      vendorId: true,
    },
  });

  const results: unknown[] = [];

  if (order.userId) {
    const customerResult = await createNotificationOnce({
      eventType: "CUSTOMER_ORDER_CANCELLED",
      category: "ORDER",
      priority: "HIGH",
      title: "Order cancelled",
      body: `Order ${order.orderNumber} has been cancelled.`,
      actionUrl: `/orders/${order.id}`,
      actionLabel: "View order",
      orderId,
      recipients: [{
        recipientRole: "CUSTOMER",
        recipientUserId: order.userId,
      }],
    }).catch(() => null);

    if (customerResult) {
      results.push(customerResult);
    }
  }

  for (const vendorOrder of vendorOrders) {
    const recipients =
      await vendorOrderRecipients(
        vendorOrder.vendorId
      );

    if (recipients.length === 0) {
      continue;
    }

    const vendorResult = await createNotificationOnce({
      eventType: "VENDOR_ORDER_CANCELLED",
      category: "ORDER",
      priority: "URGENT",
      title: "Order cancelled",
      body: `Order ${order.orderNumber} has been cancelled. Stop preparing this order if work has not already stopped.`,
      actionUrl:
        `/vendor/orders/${vendorOrder.id}`,
      actionLabel: "View order",
      orderId,
      vendorId: vendorOrder.vendorId,
      vendorOrderId: vendorOrder.id,
      recipients,
    }).catch(() => null);

    if (vendorResult) {
      results.push(vendorResult);
    }
  }

  if (
    order.paymentStatus === "PAID" ||
    vendorOrders.length > 0
  ) {
    const adminResult = await createNotificationOnce({
      eventType: "ADMIN_ORDER_CANCELLED",
      category: "ORDER",
      priority: "HIGH",
      title: "Order cancelled",
      body: `Order ${order.orderNumber} has been cancelled and may require operational review.`,
      actionUrl: `/admin/orders/${order.id}`,
      actionLabel: "Review order",
      orderId,
      recipients: await getAdminRecipients(),
    }).catch(() => null);

    if (adminResult) {
      results.push(adminResult);
    }
  }

  return results;
}

export async function notifyVendorOrderReady(
  vendorOrderId: string,
  allReady: boolean
) {
  const vendorOrder =
    await prisma.vendorOrder.findUnique({
      where: { id: vendorOrderId },
      select: {
        id: true,
        orderId: true,
        vendorId: true,
      },
    });

  if (!vendorOrder) return [];

  const order = await prisma.order.findUnique({
    where: { id: vendorOrder.orderId },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
    },
  });

  if (!order) return [];

  const results: unknown[] = [];
  const vendorRecipients =
    await vendorOrderRecipients(
      vendorOrder.vendorId
    );

  if (vendorRecipients.length > 0) {
    const vendorResult = await createNotificationOnce({
      eventType: "VENDOR_ORDER_READY_CONFIRMED",
      category: "ORDER",
      priority: "NORMAL",
      title: "Ready for pickup confirmed",
      body: `Your package for order ${order.orderNumber} is marked ready for pickup.`,
      actionUrl:
        `/vendor/orders/${vendorOrder.id}`,
      actionLabel: "View order",
      orderId: order.id,
      vendorId: vendorOrder.vendorId,
      vendorOrderId: vendorOrder.id,
      recipients: vendorRecipients,
    }).catch(() => null);

    if (vendorResult) {
      results.push(vendorResult);
    }
  }

  if (allReady && order.userId) {
    const customerResult = await createNotificationOnce({
      eventType: "CUSTOMER_ORDER_ALL_VENDORS_READY",
      category: "ORDER",
      priority: "NORMAL",
      title: "Your order is prepared",
      body: `All packages for order ${order.orderNumber} are ready. Rider pickup is next.`,
      actionUrl: `/orders/${order.id}/tracking`,
      actionLabel: "Track order",
      orderId: order.id,
      recipients: [{
        recipientRole: "CUSTOMER",
        recipientUserId: order.userId,
      }],
    }).catch(() => null);

    if (customerResult) {
      results.push(customerResult);
    }
  }

  if (allReady) {
    const adminResult = await createNotificationOnce({
      eventType: "ADMIN_ORDER_ALL_VENDORS_READY",
      category: "ORDER",
      priority: "HIGH",
      title: "All vendors ready",
      body: `All vendor packages for order ${order.orderNumber} are ready for pickup.`,
      actionUrl: `/admin/orders/${order.id}`,
      actionLabel: "View order",
      orderId: order.id,
      recipients: await getAdminRecipients(),
    }).catch(() => null);

    if (adminResult) {
      results.push(adminResult);
    }
  }

  return results;
}

export async function notifyVendorProductModeration(
  productId: string,
  approvalStatus: string,
  reason?: string | null
) {
  const product =
    await prisma.product.findUnique({
      where: {
        id: productId,
      },
      select: {
        id: true,
        name: true,
        vendorId: true,
      },
    });

  if (
    !product?.vendorId
  ) {
    return null;
  }

  const recipients =
    await vendorOrderRecipients(
      product.vendorId
    );

  if (
    recipients.length === 0
  ) {
    return null;
  }

  const normalized =
    approvalStatus.toUpperCase();

  const title =
    normalized === "APPROVED"
      ? "Product approved"
      : normalized === "REJECTED"
        ? "Product needs changes"
        : normalized === "SUSPENDED"
          ? "Product suspended"
          : "Product review updated";

  const message =
    normalized === "APPROVED"
      ? `${product.name} has been approved and can be active in the Manna marketplace.`
      : reason
        ? `${product.name}: ${reason}`
        : `${product.name} review status is now ${normalized.toLowerCase().replaceAll("_", " ")}.`;

  return createNotification({
    eventType:
      `VENDOR_PRODUCT_${normalized}`,
    category: "VENDOR",
    priority:
      normalized === "REJECTED" ||
      normalized === "SUSPENDED"
        ? "HIGH"
        : "NORMAL",
    title,
    body: message,
    actionUrl:
      `/vendor/products/${product.id}`,
    actionLabel:
      "Review product",
    vendorId:
      product.vendorId,
    metadata: {
      productId:
        product.id,
      approvalStatus:
        normalized,
      reason:
        reason ?? null,
    },
    recipients,
  });
}
