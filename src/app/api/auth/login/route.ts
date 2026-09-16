import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import {
  signAuthToken,
  verifyPassword,
} from "@/lib/auth";

function normalizePhone(
  value: string
): string | null {
  const raw = value.trim();

  const digits =
    raw.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (
    digits.length === 11 &&
    digits.startsWith("0")
  ) {
    return `+234${digits.slice(1)}`;
  }

  if (
    digits.length === 13 &&
    digits.startsWith("234")
  ) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+234${digits}`;
  }

  if (
    raw.startsWith("+") &&
    digits.length >= 10 &&
    digits.length <= 15
  ) {
    return `+${digits}`;
  }

  return null;
}

export async function POST(
  req: Request
) {
  try {
    const body =
      (await req.json()) as Record<
        string,
        unknown
      >;

    const password =
      typeof body.password ===
      "string"
        ? body.password
        : "";

    /**
     * New frontend sends identifier.
     *
     * email/phone fallbacks are kept
     * so older clients don't break.
     */
    const rawIdentifier =
      typeof body.identifier ===
      "string"
        ? body.identifier.trim()
        : typeof body.email ===
            "string"
          ? body.email.trim()
          : typeof body.phone ===
              "string"
            ? body.phone.trim()
            : "";

    if (
      !rawIdentifier ||
      !password
    ) {
      return NextResponse.json(
        {
          message:
            "Email or phone number and password are required",
        },
        {
          status: 400,
        }
      );
    }

    const isEmail =
      rawIdentifier.includes("@");

    /**
     * IMPORTANT:
     *
     * This endpoint is CUSTOMER ONLY.
     *
     * It can never issue manna_token
     * to ADMIN or VENDOR users.
     */
    const user = isEmail
      ? await prisma.user.findFirst({
          where: {
            role: "CUSTOMER",

            email: {
              equals:
                rawIdentifier.toLowerCase(),

              mode: "insensitive",
            },
          },

          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            passwordHash: true,
            role: true,
          },
        })
      : await prisma.user.findFirst({
          where: {
            role: "CUSTOMER",

            OR: Array.from(
              new Set(
                [
                  rawIdentifier,
                  normalizePhone(
                    rawIdentifier
                  ),
                ].filter(
                  (
                    value
                  ): value is string =>
                    Boolean(value)
                )
              )
            ).map((phone) => ({
              phone,
            })),
          },

          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            passwordHash: true,
            role: true,
          },
        });

    if (!user) {
      return NextResponse.json(
        {
          message:
            "Invalid email/phone or password",
        },
        {
          status: 401,
        }
      );
    }

    /**
     * OAuth-only customer.
     */
    if (!user.passwordHash) {
      return NextResponse.json(
        {
          message:
            "This account uses Google or Apple sign-in",
        },
        {
          status: 401,
        }
      );
    }

    const validPassword =
      await verifyPassword(
        password,
        user.passwordHash
      );

    if (!validPassword) {
      return NextResponse.json(
        {
          message:
            "Invalid email/phone or password",
        },
        {
          status: 401,
        }
      );
    }

    const token = signAuthToken(
      user.id,
      user.role
    );

    const response =
      NextResponse.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: "CUSTOMER" as const,
        },
      });

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
    console.error(
      "LOGIN_ERROR",
      error
    );

    return NextResponse.json(
      {
        message:
          "We couldn’t log you in right now. Please try again.",
      },
      {
        status: 500,
      }
    );
  }
}