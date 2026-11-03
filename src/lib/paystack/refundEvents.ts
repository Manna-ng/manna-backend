/** Refund events are NOT proof of a successful customer repayment until processed. */
export type PaystackRefundEventName =
  | "refund.pending"
  | "refund.processing"
  | "refund.needs-attention"
  | "refund.failed"
  | "refund.processed";

export type VerifiedRefundEvent = {
  event: PaystackRefundEventName;
  transactionReference: string;
  refundReference: string | null;
  amountKobo: number;
  currency: "NGN";
};

export function parsePaystackRefundEvent(
  payload: unknown
): VerifiedRefundEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const event = record.event;
  if (
    event !== "refund.pending" &&
    event !== "refund.processing" &&
    event !== "refund.needs-attention" &&
    event !== "refund.failed" &&
    event !== "refund.processed"
  ) return null;

  if (!record.data || typeof record.data !== "object") return null;
  const data = record.data as Record<string, unknown>;
  const ref = data.transaction_reference;
  if (typeof ref !== "string" || !ref.trim()) return null;
  const rawAmount = data.amount;
  const amount =
    typeof rawAmount === "number"
      ? rawAmount
      : typeof rawAmount === "string" && /^\d+$/.test(rawAmount)
        ? Number(rawAmount)
        : Number.NaN;
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  if (data.currency !== "NGN") return null;
  const refundReference =
    typeof data.refund_reference === "string" && data.refund_reference
      ? data.refund_reference
      : null;
  return {
    event,
    transactionReference: ref,
    refundReference,
    amountKobo: amount,
    currency: "NGN",
  };
}
