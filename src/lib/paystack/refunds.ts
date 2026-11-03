/**
 * Full refunds only. No call site is enabled in V14R1.
 * Creating a refund is NOT equivalent to processing it; webhook/reconciliation
 * is required before marking any order REFUNDED.
 */
export type PaystackRefundStatus =
  | "pending"
  | "processing"
  | "needs-attention"
  | "failed"
  | "processed";

export type PaystackRefundResult = {
  providerRefundId: string;
  status: PaystackRefundStatus;
  amountKobo: number;
  currency: "NGN";
};

export class PaystackRefundRequestError extends Error {
  constructor(
    message: string,
    public readonly uncertain: boolean,
    public readonly httpStatus: number | null = null
  ) {
    super(message);
    this.name = "PaystackRefundRequestError";
  }
}

function paystackRefundSecret(): string {
  const mode = process.env.PAYSTACK_MODE;
  if (mode !== "test" && mode !== "live") {
    throw new PaystackRefundRequestError(
      "PAYSTACK_MODE must explicitly be test or live for refunds.", false
    );
  }
  if (
    mode === "live" &&
    process.env.MANNA_REFUND_LIVE_ENABLED !== "YES_I_APPROVE_LIVE_REFUNDS"
  ) {
    throw new PaystackRefundRequestError(
      "Live refunds are disabled pending explicit release authorization.", false
    );
  }
  const secret =
    mode === "live"
      ? process.env.PAYSTACK_SECRET_KEY_LIVE
      : process.env.PAYSTACK_SECRET_KEY_TEST;
  if (!secret) {
    throw new PaystackRefundRequestError(
      "Paystack refund credential is unavailable.", false
    );
  }
  return secret;
}

function parseRefundResult(
  input: unknown,
  expectedAmountKobo: number
): PaystackRefundResult {
  if (!input || typeof input !== "object") {
    throw new PaystackRefundRequestError(
      "Refund provider result missing; reconcile outcome before retrying.", true
    );
  }
  const data = input as Record<string, unknown>;
  const status = data.status;
  const id = data.id;
  const amount = data.amount;
  if (
    status !== "pending" &&
    status !== "processing" &&
    status !== "needs-attention" &&
    status !== "failed" &&
    status !== "processed"
  ) {
    throw new PaystackRefundRequestError(
      "Unknown refund provider status; reconcile outcome before retrying.", true
    );
  }
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    !String(id).trim() ||
    data.currency !== "NGN" ||
    amount !== expectedAmountKobo
  ) {
    throw new PaystackRefundRequestError(
      "Refund provider identity/amount mismatch; reconcile before retrying.", true
    );
  }
  return {
    providerRefundId: String(id),
    status,
    amountKobo: expectedAmountKobo,
    currency: "NGN",
  };
}

async function paystackRefundRequest(
  path: string,
  init: RequestInit,
  expectedAmountKobo: number
): Promise<PaystackRefundResult> {
  const secret = paystackRefundSecret();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
    });
  } catch {
    throw new PaystackRefundRequestError(
      "Refund network outcome unknown; reconcile before retrying.", true
    );
  } finally {
    clearTimeout(timer);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PaystackRefundRequestError(
      "Refund provider response unreadable; reconcile before retrying.", true,
      response.status
    );
  }
  if (!payload || typeof payload !== "object") {
    throw new PaystackRefundRequestError(
      "Refund provider returned no envelope; reconcile before retrying.", true,
      response.status
    );
  }
  const envelope = payload as Record<string, unknown>;
  if (!response.ok || envelope.status !== true) {
    const message =
      typeof envelope.message === "string" ? envelope.message : "Refund request rejected";
    // 5xx is uncertain; 4xx may be rejected, but future reconciliation is still prudent.
    throw new PaystackRefundRequestError(
      message,
      response.status >= 500,
      response.status
    );
  }
  return parseRefundResult(envelope.data, expectedAmountKobo);
}

export async function createPaystackFullRefund(input: {
  transactionReference: string;
  expectedAmountKobo: number;
  customerNote?: string;
  merchantNote?: string;
}): Promise<PaystackRefundResult> {
  if (!input.transactionReference.trim() ||
      !Number.isSafeInteger(input.expectedAmountKobo) ||
      input.expectedAmountKobo <= 0) {
    throw new PaystackRefundRequestError("Invalid full-refund request.", false);
  }
  // Paystack defaults to a FULL refund when amount is omitted.
  // Do not add a partial amount to this V14 contract.
  return paystackRefundRequest(
    "/refund",
    {
      method: "POST",
      body: JSON.stringify({
        transaction: input.transactionReference,
        currency: "NGN",
        customer_note: input.customerNote?.slice(0, 180),
        merchant_note: input.merchantNote?.slice(0, 180),
      }),
    },
    input.expectedAmountKobo
  );
}

export async function fetchPaystackRefund(input: {
  providerRefundId: string;
  expectedAmountKobo: number;
}): Promise<PaystackRefundResult> {
  if (!/^\d+$/.test(input.providerRefundId) ||
      !Number.isSafeInteger(input.expectedAmountKobo) ||
      input.expectedAmountKobo <= 0) {
    throw new PaystackRefundRequestError("Invalid refund reconciliation input.", false);
  }
  return paystackRefundRequest(
    `/refund/${encodeURIComponent(input.providerRefundId)}`,
    { method: "GET" },
    input.expectedAmountKobo
  );
}
