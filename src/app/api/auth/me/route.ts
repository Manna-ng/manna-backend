import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  verifyAuthToken,
} from "@/lib/auth";

import { prisma } from "@/lib/prisma";

function unauthenticatedResponse(
  clearCookie = false
) {
  const response =
    NextResponse.json(
      {
        user: null,
      },
      {
        status: 200,
      }
    );

  if (clearCookie) {
    response.cookies.set(
      "manna_token",
      "",
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          "production",

        sameSite: "lax",

        path: "/",

        maxAge: 0,
      }
    );
  }

  return response;
}

export async function GET() {
  try {
    const cookieStore =
      await cookies();

    const token =
      cookieStore.get(
        "manna_token"
      )?.value;

    if (!token) {
      return unauthenticatedResponse();
    }

    const decoded =
      verifyAuthToken(token);

    /**
     * Customer session must carry
     * CUSTOMER role.
     */
    if (
      !decoded ||
      decoded.role !== "CUSTOMER"
    ) {
      return unauthenticatedResponse(
        true
      );
    }

    const user =
      await prisma.user.findFirst({
        where: {
          id: decoded.userId,
          role: "CUSTOMER",
        },

        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          role: true,

          isFaceCaptured: true,
          isFaceVerified: true,

          createdAt: true,
        },
      });

    if (!user) {
      return unauthenticatedResponse(
        true
      );
    }

    return NextResponse.json({
      user: {
        ...user,
        role: "CUSTOMER" as const,
      },
    });
  } catch (error) {
    console.error(
      "ME_ERROR",
      error
    );

    return NextResponse.json(
      {
        message:
          "Something went wrong",
      },
      {
        status: 500,
      }
    );
  }
}