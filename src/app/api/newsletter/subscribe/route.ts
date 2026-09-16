import { NextResponse } from "next/server";

import {
  subscribeEmailToNewsletter,
} from "@/lib/brevo/newsletter";

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type NewsletterRequestBody = {
  email?: unknown;
  website?: unknown;
};

export async function POST(req: Request) {
  let body: NewsletterRequestBody;

  try {
    body =
      (await req.json()) as NewsletterRequestBody;
  } catch {
    return NextResponse.json(
      {
        message: "Invalid request body",
      },
      {
        status: 400,
      }
    );
  }

  /**
   * Honeypot anti-bot field.
   *
   * Real users will never fill this field.
   * Bots commonly populate every input.
   */
  if (
    typeof body.website === "string" &&
    body.website.trim()
  ) {
    return NextResponse.json({
      subscribed: true,
      message: "Thanks for subscribing to Manna.",
    });
  }

  const email =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";

  if (
    !email ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email)
  ) {
    return NextResponse.json(
      {
        message:
          "Enter a valid email address",
      },
      {
        status: 400,
      }
    );
  }

  try {
    await subscribeEmailToNewsletter(email);

    return NextResponse.json({
      subscribed: true,
      message:
        "You’re subscribed. Welcome to Manna!",
    });
  } catch (error) {
    console.error(
      "NEWSLETTER_SUBSCRIBE_ERROR",
      error
    );

    const isConfigurationError =
      error instanceof Error &&
      (
        error.message.includes(
          "BREVO_API_KEY"
        ) ||
        error.message.includes(
          "BREVO_NEWSLETTER_LIST_ID"
        )
      );

    return NextResponse.json(
      {
        message: isConfigurationError
          ? "Newsletter service is not configured yet"
          : "We couldn’t subscribe you right now. Please try again.",
      },
      {
        status: isConfigurationError
          ? 503
          : 502,
      }
    );
  }
}