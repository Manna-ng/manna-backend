type PaystackEnvelope<T> = {
  status?: boolean;
  message?: string;
  data?: T;
};

type TransferRecipientData = {
  recipient_code?: string;
};

type TransferData = {
  transfer_code?: string;
  reference?: string;
  status?: string;
  amount?: number;
};

export class PaystackTransferRequestError
  extends Error {
  readonly uncertain: boolean;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    uncertain: boolean,
    httpStatus: number | null = null
  ) {
    super(message);
    this.name =
      "PaystackTransferRequestError";
    this.uncertain = uncertain;
    this.httpStatus = httpStatus;
  }
}

function getPaystackSecret() {
  const mode =
    process.env.PAYSTACK_MODE ??
    "test";

  const secret =
    mode === "live"
      ? process.env
          .PAYSTACK_SECRET_KEY_LIVE
      : process.env
          .PAYSTACK_SECRET_KEY_TEST;

  if (!secret) {
    throw new Error(
      "Paystack secret key is not configured for the current mode."
    );
  }

  return secret;
}

async function paystackRequest<T>(
  path: string,
  init: RequestInit
): Promise<T> {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      15_000
    );

  let response: Response;

  try {
    response = await fetch(
      `https://api.paystack.co${path}`,
      {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization:
            `Bearer ${getPaystackSecret()}`,
          "Content-Type":
            "application/json",
          ...(init.headers ?? {}),
        },
      }
    );
  } catch {
    throw new PaystackTransferRequestError(
      "Paystack request outcome is unknown because the network request did not complete cleanly.",
      true,
      null
    );
  } finally {
    clearTimeout(timeout);
  }

  let payload:
    | PaystackEnvelope<T>
    | null = null;

  try {
    payload =
      (await response.json()) as
        PaystackEnvelope<T>;
  } catch {
    payload = null;
  }

  if (
    !response.ok ||
    payload?.status === false
  ) {
    const message =
      payload?.message ||
      `Paystack request failed with HTTP ${response.status}.`;

    throw new PaystackTransferRequestError(
      message,
      response.status >= 500,
      response.status
    );
  }

  if (!payload?.data) {
    throw new PaystackTransferRequestError(
      "Paystack returned no data.",
      false,
      response.status
    );
  }

  return payload.data;
}

export async function createPaystackTransferRecipient(
  input: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }
) {
  const data =
    await paystackRequest<TransferRecipientData>(
      "/transferrecipient",
      {
        method: "POST",
        body: JSON.stringify({
          type: "nuban",
          name: input.name,
          account_number:
            input.accountNumber,
          bank_code:
            input.bankCode,
          currency: "NGN",
        }),
      }
    );

  const recipientCode =
    typeof data.recipient_code ===
      "string"
      ? data.recipient_code
      : "";

  if (!recipientCode) {
    throw new PaystackTransferRequestError(
      "Paystack did not return a transfer recipient code.",
      false
    );
  }

  return {
    recipientCode,
  };
}

export async function initiatePaystackTransfer(
  input: {
    amountNgn: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }
) {
  if (
    !Number.isInteger(
      input.amountNgn
    ) ||
    input.amountNgn <= 0
  ) {
    throw new Error(
      "Transfer amount must be a positive whole NGN amount."
    );
  }

  const data =
    await paystackRequest<TransferData>(
      "/transfer",
      {
        method: "POST",
        body: JSON.stringify({
          source: "balance",
          amount:
            input.amountNgn * 100,
          recipient:
            input.recipientCode,
          reference:
            input.reference,
          reason: input.reason,
          currency: "NGN",
        }),
      }
    );

  return {
    transferCode:
      typeof data.transfer_code ===
        "string"
        ? data.transfer_code
        : null,
    reference:
      typeof data.reference ===
        "string"
        ? data.reference
        : input.reference,
    status:
      typeof data.status ===
        "string"
        ? data.status.toLowerCase()
        : "pending",
  };
}


export async function finalizePaystackTransferOtp(
  input: {
    transferCode: string;
    otp: string;
  }
) {
  const data =
    await paystackRequest<TransferData>(
      "/transfer/finalize_transfer",
      {
        method: "POST",
        body: JSON.stringify({
          transfer_code:
            input.transferCode,
          otp: input.otp,
        }),
      }
    );

  return {
    transferCode:
      typeof data.transfer_code ===
        "string"
        ? data.transfer_code
        : input.transferCode,
    reference:
      typeof data.reference ===
        "string"
        ? data.reference
        : null,
    status:
      typeof data.status ===
        "string"
        ? data.status.toLowerCase()
        : "pending",
  };
}

export async function verifyPaystackTransfer(
  reference: string
) {
  return paystackRequest<TransferData>(
    `/transfer/verify/${encodeURIComponent(
      reference
    )}`,
    {
      method: "GET",
    }
  );
}
