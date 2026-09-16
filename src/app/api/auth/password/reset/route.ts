import {
  cookies,
} from "next/headers";

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
  verifyPasswordResetToken,
} from "@/lib/auth/password-reset";

import {
  validatePassword,
} from "@/lib/auth/customer-input";

function clearResetCookie(
  response: NextResponse
) {
  response.cookies.set(
    "manna_password_reset_token",

    "",

    {
      httpOnly: true,

      secure:
        process.env.NODE_ENV ===
        "production",

      sameSite:
        "lax",

      path: "/",

      maxAge: 0,
    }
  );
}

export async function POST(
  req: Request
) {
  try {
    const cookieStore =
      await cookies();

    const token =
      cookieStore.get(
        "manna_password_reset_token"
      )?.value;

    if (!token) {
      return NextResponse.json(
        {
          message:
            "Your password reset session has expired. Request a new code.",
        },

        {
          status: 401,
        }
      );
    }

    const session =
      verifyPasswordResetToken(
        token
      );

    if (!session) {
      const response =
        NextResponse.json(
          {
            message:
              "Your password reset session has expired. Request a new code.",
          },

          {
            status: 401,
          }
        );

      clearResetCookie(
        response
      );

      return response;
    }

    const body =
      (await req.json()) as Record<
        string,
        unknown
      >;

    const password =
      body.password;

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

    const passwordHash =
      await hashPassword(
        password as string
      );

    const updated =
      await prisma.user
        .updateMany({
          where: {
            id:
              session.userId,

            role:
              "CUSTOMER",

            email: {
              equals:
                session.email,

              mode:
                "insensitive",
            },
          },

          data: {
            passwordHash,
          },
        });

    if (
      updated.count !== 1
    ) {
      const response =
        NextResponse.json(
          {
            message:
              "Your password reset session is no longer valid.",
          },

          {
            status: 401,
          }
        );

      clearResetCookie(
        response
      );

      return response;
    }

    await prisma
      .authOtpChallenge
      .deleteMany({
        where: {
          purpose:
            "PASSWORD_RESET",

          email:
            session.email,
        },
      });

    const response =
      NextResponse.json(
        {
          reset: true,

          message:
            "Your password has been updated. You can now log in.",
        }
      );

    clearResetCookie(
      response
    );

    return response;
  } catch (error) {
    console.error(
      "PASSWORD_RESET_ERROR",
      error
    );

    return NextResponse.json(
      {
        message:
          "We couldn’t reset your password right now. Please try again.",
      },

      {
        status: 500,
      }
    );
  }
}