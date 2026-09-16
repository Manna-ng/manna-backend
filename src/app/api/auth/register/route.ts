import {
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  hashPassword,
} from "@/lib/auth";

import {
  EMAIL_PATTERN,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  validatePassword,
} from "@/lib/auth/customer-input";

import {
  issueOtpChallenge,
  OtpCooldownError,
  OtpRateLimitError,
  releaseOtpCooldownAfterDeliveryFailure,
} from "@/lib/auth/otp";

import {
  sendAuthOtpEmail,
} from "@/lib/auth/otp-email";

export async function POST(
  req: Request
) {
  try {
    const body =
      (await req.json()) as Record<
        string,
        unknown
      >;

    const name =
      normalizeName(
        body.name ??
          body.fullName
      );

    const email =
      normalizeEmail(
        body.email
      );

    const phone =
      normalizePhone(
        body.phone
      );

    const password =
      body.password;

    if (!name) {
      return NextResponse.json(
        {
          message:
            "Full name is required",
        },

        {
          status: 400,
        }
      );
    }

    if (
      !email ||
      !EMAIL_PATTERN.test(
        email
      )
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

    if (!phone) {
      return NextResponse.json(
        {
          message:
            "Enter a valid phone number",
        },

        {
          status: 400,
        }
      );
    }

    const passwordError =
      validatePassword(
        password
      );

    if (passwordError) {
      return NextResponse.json(
        {
          message:
            passwordError,
        },

        {
          status: 400,
        }
      );
    }

    const existingUser =
      await prisma.user
        .findFirst({
          where: {
            OR: [
              {
                email,
              },

              {
                phone,
              },
            ],
          },

          select: {
            id: true,
          },
        });

    if (existingUser) {
      return NextResponse.json(
        {
          message:
            "An account already exists with this email or phone number",
        },

        {
          status: 409,
        }
      );
    }

    /*
     * The customer is NOT created
     * yet.
     *
     * We hash the password and
     * retain only the pending
     * signup until email OTP has
     * been verified.
     */
    const passwordHash =
      await hashPassword(
        password as string
      );

    const otp =
      await issueOtpChallenge(
        {
          purpose:
            "SIGNUP",

          email,

          pendingSignup: {
            name,
            phone,
            passwordHash,
          },
        }
      );

    try {
      await sendAuthOtpEmail(
        {
          purpose:
            "SIGNUP",

          email,

          name,

          code:
            otp.code,
        }
      );
    } catch (error) {
      await releaseOtpCooldownAfterDeliveryFailure(
        "SIGNUP",
        email
      );

      throw error;
    }

    return NextResponse.json(
      {
        verificationRequired:
          true,

        email,

        expiresInSeconds:
          otp.expiresInSeconds,

        resendAfterSeconds:
          otp.resendAfterSeconds,

        message:
          "We sent a 6-digit verification code to your email.",
      },

      {
        status: 202,
      }
    );
  } catch (error) {
    if (
      error instanceof
      OtpCooldownError
    ) {
      return NextResponse.json(
        {
          message:
            error.message,

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
          message:
            error.message,
        },

        {
          status: 429,
        }
      );
    }

    console.error(
      "REGISTER_START_ERROR",
      error
    );

    return NextResponse.json(
      {
        message:
          "We couldn’t send your verification code right now. Please try again.",
      },

      {
        status: 502,
      }
    );
  }
}