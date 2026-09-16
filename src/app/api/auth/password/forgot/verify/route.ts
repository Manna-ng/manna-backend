import {
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  PASSWORD_RESET_MAX_AGE_SECONDS,
  signPasswordResetToken,
} from "@/lib/auth/password-reset";

import {
  EMAIL_PATTERN,
  normalizeEmail,
} from "@/lib/auth/customer-input";

import {
  OtpVerificationError,
  validateOtpCode,
} from "@/lib/auth/otp";

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

    const code =
      typeof body.code ===
      "string"
        ? body.code.trim()
        : "";

    if (
      !email ||
      !EMAIL_PATTERN.test(
        email
      ) ||
      !/^\d{6}$/.test(code)
    ) {
      return NextResponse.json(
        {
          message:
            "Enter the 6-digit password reset code sent to your email.",
        },

        {
          status: 400,
        }
      );
    }

    const challenge =
      await validateOtpCode(
        {
          purpose:
            "PASSWORD_RESET",

          email,

          code,
        }
      );

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
            email: true,
          },
        });

    if (!user?.email) {
      return NextResponse.json(
        {
          message:
            "The verification code is invalid or expired.",
        },

        {
          status: 400,
        }
      );
    }

    const consumed =
      await prisma
        .authOtpChallenge
        .updateMany({
          where: {
            id:
              challenge.id,

            consumedAt:
              null,

            expiresAt: {
              gt:
                new Date(),
            },
          },

          data: {
            consumedAt:
              new Date(),
          },
        });

    if (
      consumed.count !== 1
    ) {
      return NextResponse.json(
        {
          message:
            "The verification code is invalid or expired.",
        },

        {
          status: 400,
        }
      );
    }

    const resetToken =
      signPasswordResetToken(
        user.id,
        user.email
      );

    const response =
      NextResponse.json(
        {
          verified: true,

          message:
            "Email verified. You can now choose a new password.",
        }
      );

    response.cookies.set(
      "manna_password_reset_token",

      resetToken,

      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          "production",

        sameSite:
          "lax",

        path: "/",

        maxAge:
          PASSWORD_RESET_MAX_AGE_SECONDS,
      }
    );

    return response;
  } catch (error) {
    if (
      error instanceof
      OtpVerificationError
    ) {
      return NextResponse.json(
        {
          message:
            error.message,

          remainingAttempts:
            error.remainingAttempts,
        },

        {
          status:
            error.code ===
            "LOCKED"
              ? 429
              : 400,
        }
      );
    }

    console.error(
      "PASSWORD_FORGOT_VERIFY_ERROR",
      error
    );

    return NextResponse.json(
      {
        message:
          "We couldn’t verify the reset code right now. Please try again.",
      },

      {
        status: 500,
      }
    );
  }
}