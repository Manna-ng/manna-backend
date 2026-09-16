import {
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  EMAIL_PATTERN,
  normalizeEmail,
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

const GENERIC_MESSAGE =
  "If a customer account exists for that email, we’ve sent a 6-digit password reset code.";

export async function POST(
  req: Request
) {
  try {
    const body =
      (await req.json()) as Record<
        string,
        unknown
      >;

    const email =
      normalizeEmail(
        body.email
      );

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

    const user =
      await prisma.user
        .findFirst({
          where: {
            role:
              "CUSTOMER",

            email: {
              equals:
                email,

              mode:
                "insensitive",
            },
          },

          select: {
            id: true,
            name: true,
            email: true,
          },
        });

    /*
     * Do not reveal whether an
     * account actually exists.
     */
    if (!user?.email) {
      return NextResponse.json(
        {
          requested: true,

          message:
            GENERIC_MESSAGE,

          resendAfterSeconds:
            60,
        }
      );
    }

    try {
      const otp =
        await issueOtpChallenge(
          {
            purpose:
              "PASSWORD_RESET",

            email,
          }
        );

      try {
        await sendAuthOtpEmail(
          {
            purpose:
              "PASSWORD_RESET",

            email,

            name:
              user.name,

            code:
              otp.code,
          }
        );
      } catch (error) {
        await releaseOtpCooldownAfterDeliveryFailure(
          "PASSWORD_RESET",
          email
        );

        throw error;
      }
    } catch (error) {
      /*
       * Do not expose a different
       * response based on whether
       * the email exists.
       */
      if (
        error instanceof
          OtpCooldownError ||
        error instanceof
          OtpRateLimitError
      ) {
        return NextResponse.json(
          {
            requested: true,

            message:
              GENERIC_MESSAGE,

            resendAfterSeconds:
              error instanceof
              OtpCooldownError
                ? error
                    .retryAfterSeconds
                : 60,
          }
        );
      }

      throw error;
    }

    return NextResponse.json(
      {
        requested: true,

        message:
          GENERIC_MESSAGE,

        resendAfterSeconds:
          60,
      }
    );
  } catch (error) {
    console.error(
      "PASSWORD_FORGOT_ERROR",
      error
    );

    /*
     * Still return a generic
     * response so this endpoint
     * cannot be used to discover
     * registered accounts.
     */
    return NextResponse.json(
      {
        requested: true,

        message:
          GENERIC_MESSAGE,

        resendAfterSeconds:
          60,
      }
    );
  }
}