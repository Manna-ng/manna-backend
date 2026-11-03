/**
 * V14R2: deterministic, fail-closed PREVIEW policy.
 * This module does not initiate or approve a refund, change a database row,
 * or release a vendor balance. It is a prerequisite to later locked orchestration.
 */
export type RefundReasonCode =
  | "ORDER_NOT_PAID"
  | "ORDER_NOT_PROCESSING"
  | "NOT_PAYSTACK"
  | "PAYMENT_REFERENCE_MISSING"
  | "INVALID_NGN_AMOUNT"
  | "PAYMENT_ATTEMPT_MISMATCH"
  | "PAYMENT_ATTEMPT_AMBIGUOUS"
  | "REFUND_ALREADY_EXISTS"
  | "VENDOR_SETTLEMENT_EXISTS"
  | "VENDOR_ORDER_IN_PROGRESS"
  | "DELIVERY_IN_PROGRESS"
  | "KWIK_TASK_EXISTS";

export type RefundPolicySnapshot = {
  order: {
    id: string;
    status: string;
    paymentStatus: string;
    paymentProvider: string | null;
    paymentReference: string | null;
    totalAmountNgn: number;
  };
  attempts: Array<{
    provider: string;
    reference: string;
    amountNgn: number;
    currency: string;
    status: string;
  }>;
  vendorOrders: Array<{
    status: string;
    confirmedAt: Date | null;
    packingStartedAt: Date | null;
    readyForPickupAt: Date | null;
    pickedUpAt: Date | null;
  }>;
  delivery: null | {
    status: string;
    processingStatus: string;
    kwikTaskId: string | null;
    kwikUniqueOrderId: string | null;
    lastWebhookAt: Date | null;
  };
  vendorSettlementCount: number;
  kwikTaskCount: number;
  existingRefund: null | { status: string };
};

export type RefundPreview = {
  eligibleForManualReview: boolean;
  blockers: RefundReasonCode[];
  orderId: string;
  amountNgn: number | null;
  expectedAmountKobo: number | null;
  requiresFreshPaystackChargeVerification: true;
  requiresTransactionalOrderAndDispatchLock: true;
  canCallProvider: false;
};

function safeAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) &&
    amount > 0 && Number.isSafeInteger(amount * 100) &&
    amount * 100 > 0;
}

export function assessRefundPreview(snapshot: RefundPolicySnapshot): RefundPreview {
  const blockers = new Set<RefundReasonCode>();
  const order = snapshot.order;
  if (order.paymentStatus !== "PAID") blockers.add("ORDER_NOT_PAID");
  if (order.status !== "PROCESSING") blockers.add("ORDER_NOT_PROCESSING");
  if (order.paymentProvider !== "PAYSTACK") blockers.add("NOT_PAYSTACK");
  if (!order.paymentReference?.trim()) blockers.add("PAYMENT_REFERENCE_MISSING");
  if (!safeAmount(order.totalAmountNgn)) blockers.add("INVALID_NGN_AMOUNT");

  // An Order.paymentStatus of PAID alone is insufficient identity evidence.
  // The existing payment webhook does not always mark PaymentAttempt PAID,
  // so only require exact provider/reference/amount/currency here. A fresh
  // provider-side charge verification is still MANDATORY before executing.
  const matchingAttempts = snapshot.attempts.filter((attempt) =>
    attempt.provider === "PAYSTACK" &&
    attempt.reference === order.paymentReference &&
    attempt.currency === "NGN" &&
    attempt.amountNgn === order.totalAmountNgn &&
    attempt.status !== "FAILED" &&
    attempt.status !== "REFUNDED"
  );
  if (matchingAttempts.length === 0) blockers.add("PAYMENT_ATTEMPT_MISMATCH");
  if (matchingAttempts.length > 1) blockers.add("PAYMENT_ATTEMPT_AMBIGUOUS");

  if (snapshot.existingRefund !== null) blockers.add("REFUND_ALREADY_EXISTS");
  if (snapshot.vendorSettlementCount !== 0) blockers.add("VENDOR_SETTLEMENT_EXISTS");
  if (snapshot.kwikTaskCount !== 0) blockers.add("KWIK_TASK_EXISTS");

  for (const vendorOrder of snapshot.vendorOrders) {
    // Widen this allowlist only when the live state machine is inspected and tested.
    if (vendorOrder.status !== "AWAITING_VENDOR" ||
        vendorOrder.confirmedAt !== null ||
        vendorOrder.packingStartedAt !== null ||
        vendorOrder.readyForPickupAt !== null ||
        vendorOrder.pickedUpAt !== null) {
      blockers.add("VENDOR_ORDER_IN_PROGRESS");
    }
  }

  if (snapshot.delivery !== null) {
    const delivery = snapshot.delivery;
    if (delivery.status !== "CREATED" ||
        (delivery.processingStatus !== "PENDING" &&
         delivery.processingStatus !== "QUEUED") ||
        delivery.kwikTaskId !== null ||
        delivery.kwikUniqueOrderId !== null ||
        delivery.lastWebhookAt !== null) {
      blockers.add("DELIVERY_IN_PROGRESS");
    }
  }

  const validAmount = safeAmount(order.totalAmountNgn);
  return {
    eligibleForManualReview: blockers.size === 0,
    blockers: [...blockers],
    orderId: order.id,
    amountNgn: validAmount ? order.totalAmountNgn : null,
    expectedAmountKobo: validAmount ? order.totalAmountNgn * 100 : null,
    requiresFreshPaystackChargeVerification: true,
    requiresTransactionalOrderAndDispatchLock: true,
    canCallProvider: false,
  };
}

/**
 * Signed webhook signals are only evidence to reconcile. They may NEVER directly
 * set Order.paymentStatus=REFUNDED: confirm the actual refund via provider GET,
 * and lock/reconcile the local transaction and delivery/settlement state first.
 */
export function refundWebhookRequiresProviderReconciliation(
  event: string
): boolean {
  return event === "refund.pending" || event === "refund.processing" ||
    event === "refund.needs-attention" || event === "refund.failed" ||
    event === "refund.processed";
}
