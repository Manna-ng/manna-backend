const BREVO_TRANSACTIONAL_EMAIL_URL =
  "https://api.brevo.com/v3/smtp/email";

const REQUEST_TIMEOUT_MS =
  10_000;

function requiredEnv(
  name: string
) {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is not configured`
    );
  }

  return value;
}

export async function sendBrevoTransactionalEmail(
  input: {
    toEmail: string;
    toName?: string | null;

    subject: string;

    htmlContent: string;
    textContent: string;

    tags?: string[];
  }
) {
  const apiKey =
    requiredEnv(
      "BREVO_API_KEY"
    );

  const senderEmail =
    requiredEnv(
      "BREVO_SENDER_EMAIL"
    );

  const senderName =
    process.env
      .BREVO_SENDER_NAME
      ?.trim() ||
    "Manna";

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),

      REQUEST_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        BREVO_TRANSACTIONAL_EMAIL_URL,

        {
          method: "POST",

          headers: {
            accept:
              "application/json",

            "api-key":
              apiKey,

            "content-type":
              "application/json",
          },

          body: JSON.stringify(
            {
              sender: {
                email:
                  senderEmail,

                name:
                  senderName,
              },

              to: [
                {
                  email:
                    input.toEmail,

                  ...(input.toName
                    ? {
                        name:
                          input.toName,
                      }
                    : {}),
                },
              ],

              subject:
                input.subject,

              htmlContent:
                input.htmlContent,

              textContent:
                input.textContent,

              ...(input.tags
                ?.length
                ? {
                    tags:
                      input.tags,
                  }
                : {}),
            }
          ),

          cache: "no-store",

          signal:
            controller.signal,
        }
      );

    const payload =
      (await response
        .json()
        .catch(
          () => null
        )) as
        | {
            messageId?: string;
            message?: string;
            code?: string;
          }
        | null;

    if (!response.ok) {
      console.error(
        "BREVO_TRANSACTIONAL_EMAIL_FAILED",

        {
          status:
            response.status,

          providerMessage:
            payload?.message ??
            payload?.code ??
            "unknown_error",
        }
      );

      throw new Error(
        "Brevo rejected the transactional email request"
      );
    }

    return {
      messageId:
        typeof payload
          ?.messageId ===
        "string"
          ? payload.messageId
          : undefined,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name ===
        "AbortError"
    ) {
      throw new Error(
        "Brevo transactional email request timed out"
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}