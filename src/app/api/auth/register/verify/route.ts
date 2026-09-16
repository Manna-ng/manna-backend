import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { signAuthToken } from "@/lib/auth";

import {
  EMAIL_PATTERN,
  normalizeEmail,
} from "@/lib/auth/customer-input";

import {
  OtpVerificationError,
  validateOtpCode,
} from "@/lib/auth/otp";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<
      string,
      unknown
    >;

    const email = normalizeEmail(body.email);

    const code =
      typeof body.code === "string"
        ? body.code.trim()
        : "";

    if (
      !email ||
      !EMAIL_PATTERN.test(email) ||
      !/^\d{6}$/.test(code)
    ) {
      return NextResponse.json(
        {
          message:
            "Enter the 6-digit verification code sent to your email.",
        },
        {
          status: 400,
        }
      );
    }

    /**
     * Validates:
     * - OTP exists
     * - OTP has not expired
     * - OTP has not been consumed
     * - attempts are still allowed
     * - submitted code matches
     */
    const challenge = await validateOtpCode({
      purpose: "SIGNUP",
      email,
      code,
    });

    /**
     * The signup details should have
     * been stored when /auth/register
     * generated the OTP.
     */
    if (
      !challenge.pendingName ||
      !challenge.pendingPhone ||
      !challenge.pendingPasswordHash
    ) {
      return NextResponse.json(
        {
          message:
            "Your signup session has expired. Please start signup again.",
        },
        {
          status: 400,
        }
      );
    }

    const pendingName = challenge.pendingName;
const pendingPhone = challenge.pendingPhone;
const pendingPasswordHash =
  challenge.pendingPasswordHash;

    const user = await prisma.$transaction(
      async (tx) => {
        /**
         * Consume OTP atomically.
         *
         * This prevents two simultaneous
         * requests from using the same OTP.
         */
        const consumed =
          await tx.authOtpChallenge.updateMany({
            where: {
              id: challenge.id,
              consumedAt: null,

              expiresAt: {
                gt: new Date(),
              },
            },

            data: {
              consumedAt: new Date(),
            },
          });

        if (consumed.count !== 1) {
          throw new OtpVerificationError(
            "CONSUMED",
            "This verification code has already been used."
          );
        }

        /**
         * Check again before account creation.
         *
         * This protects against another signup
         * completing while this OTP was pending.
         */
        const existingUser =
  await tx.user.findFirst({
    where: {
      OR: [
        {
          email,
        },
        {
          phone: pendingPhone,
        },
      ],
    },

    select: {
      id: true,
    },
  });

        if (existingUser) {
          throw new Error(
            "CUSTOMER_ALREADY_EXISTS"
          );
        }

        /**
         * Customer is created ONLY after
         * successful email verification.
         */
        return tx.user.create({
  data: {
    name: pendingName,
    email,
    phone: pendingPhone,
    passwordHash:
      pendingPasswordHash,

    role: "CUSTOMER",
  },

  select: {
    id: true,
    name: true,
    email: true,
    phone: true,
    role: true,
  },
});
      }
    );

    /**
     * Signup is complete.
     * Now create the customer session.
     */
    const token = signAuthToken(
      user.id,
      user.role
    );

    const response = NextResponse.json(
      {
        verified: true,

        user: {
          ...user,
          role: "CUSTOMER" as const,
        },

        message:
          "Your email has been verified and your Manna account is ready.",
      },
      {
        status: 201,
      }
    );

    /**
     * CUSTOMER AUTH COOKIE ONLY.
     *
     * Never use manna_admin_token here.
     */
    response.cookies.set(
      "manna_token",
      token,
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          "production",

        sameSite: "lax",

        path: "/",

        maxAge:
          7 * 24 * 60 * 60,
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
          message: error.message,

          remainingAttempts:
            error.remainingAttempts,
        },
        {
          status:
            error.code === "LOCKED"
              ? 429
              : 400,
        }
      );
    }

    if (
      error instanceof Error &&
      error.message ===
        "CUSTOMER_ALREADY_EXISTS"
    ) {
      return NextResponse.json(
        {
          message:
            "An account already exists with this email or phone number.",
        },
        {
          status: 409,
        }
      );
    }

    if (
      error instanceof
        Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          message:
            "An account already exists with this email or phone number.",
        },
        {
          status: 409,
        }
      );
    }

    console.error(
      "REGISTER_VERIFY_ERROR",
      error
    );

    return NextResponse.json(
      {
        message:
          "We couldn’t verify your account right now. Please try again.",
      },
      {
        status: 500,
      }
    );
  }
}