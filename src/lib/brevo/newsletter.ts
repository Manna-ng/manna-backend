const BREVO_CONTACTS_URL = "https://api.brevo.com/v3/contacts";
const DEFAULT_NEWSLETTER_LIST_ID = 5;
const REQUEST_TIMEOUT_MS = 10_000;

export type NewsletterSubscriptionResult = {
  providerContactId?: number;
};

function getBrevoConfig() {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const rawListId = process.env.BREVO_NEWSLETTER_LIST_ID?.trim();

  const listId = rawListId
    ? Number.parseInt(rawListId, 10)
    : DEFAULT_NEWSLETTER_LIST_ID;

  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not configured");
  }

  if (!Number.isInteger(listId) || listId <= 0) {
    throw new Error(
      "BREVO_NEWSLETTER_LIST_ID must be a positive integer"
    );
  }

  return {
    apiKey,
    listId,
  };
}

export async function subscribeEmailToNewsletter(
  email: string
): Promise<NewsletterSubscriptionResult> {
  const { apiKey, listId } = getBrevoConfig();

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(BREVO_CONTACTS_URL, {
      method: "POST",

      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },

      body: JSON.stringify({
        email,
        listIds: [listId],
        updateEnabled: true,
      }),

      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          id?: number;
          message?: string;
          code?: string;
        }
      | null;

    if (!response.ok) {
      const providerMessage =
        payload?.message ||
        payload?.code ||
        "unknown_error";

      console.error(
        "BREVO_NEWSLETTER_SUBSCRIBE_FAILED",
        {
          status: response.status,
          providerMessage,
        }
      );

      throw new Error(
        "Brevo rejected the newsletter subscription request"
      );
    }

    return {
      providerContactId:
        typeof payload?.id === "number"
          ? payload.id
          : undefined,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "Brevo newsletter request timed out"
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}