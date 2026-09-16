import { NextResponse } from "next/server";

import {
  EMAIL_PATTERN,
  normalizeEmail,
} from "@/lib/auth/customer-input";

import {
  getOtpChallenge,
  issueOtpChallenge,
  OtpCooldownError,
  OtpRateLimitError,
  releaseOtpCooldownAfterDeliveryFailure,
} from "@/lib/auth/otp";

import { sendAuthOtpEmail } from "@/lib/auth/otp-email";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<
      string,
      unknown
    >;

    const email = normalizeEmail(body.email);

    if (
      !email ||
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

    /**
     * We must already have a pending
     * signup from /api/auth/register.
     */
    const existing =
      await getOtpChallenge(
        "SIGNUP",
        email
      );

    if (
      !existing ||
      !existing.pendingName ||
      !existing.pendingPhone ||
      !existing.pendingPasswordHash
    ) {
      return NextResponse.json(
        {
          message:
            "Your signup session has expired. Please start signup again.",
        },
        {
          status: 404,
        }
      );
    }

    /**
     * Generate a fresh OTP.
     *
     * The old OTP becomes invalid.
     */
    const otp =
      await issueOtpChallenge({
        purpose: "SIGNUP",

        email,

        pendingSignup: {
          name: existing.pendingName,

          phone:
            existing.pendingPhone,

          passwordHash:
            existing.pendingPasswordHash,
        },
      });

    try {
      await sendAuthOtpEmail({
        purpose: "SIGNUP",

        email,

        name: existing.pendingName,

        code: otp.code,
      });
    } catch (error) {
      /**
       * Don't make the customer wait
       * 60 seconds when Brevo itself
       * failed to deliver the email.
       */
      await releaseOtpCooldownAfterDeliveryFailure(
        "SIGNUP",
        email
      );

      throw error;
    }

    return NextResponse.json({
      sent: true,

      resendAfterSeconds:
        otp.resendAfterSeconds,

      expiresInSeconds:
        otp.expiresInSeconds,

      message:
        "A new verification code has been sent to your email.",
    });
  } catch (error) {
    if (
      error instanceof
      OtpCooldownError
    ) {
      return NextResponse.json(
        {
          message: error.message,

          retryAfterSeconds:
            error.retryAfterSeconds,
        },
        {
          status: 429,
        }
      );
    }

    if (
      error instanceof
      OtpRateLimitError
    ) {
      return NextResponse.json(
        {
          message: error.message,
        },
        {
          status: 429,
        }
      );
    }

    console.error(
      "REGISTER_RESEND_ERROR",
      error
    );

    return NextResponse.json(
      {
        message:
          "We couldn’t resend your verification code right now. Please try again.",
      },
      {
        status: 502,
      }
    );
  }
}