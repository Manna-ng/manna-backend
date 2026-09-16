import jwt from "jsonwebtoken";

const PASSWORD_RESET_TOKEN_EXPIRY =
  "10m";

export const PASSWORD_RESET_MAX_AGE_SECONDS =
  10 * 60;

const PASSWORD_RESET_SCOPE =
  "MANNA_PASSWORD_RESET";

export type PasswordResetSession = {
  userId: string;
  email: string;
};

function getJwtSecret() {
  const secret =
    process.env
      .JWT_SECRET
      ?.trim();

  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set"
    );
  }

  return secret;
}

export function signPasswordResetToken(
  userId: string,
  email: string
): string {
  return jwt.sign(
    {
      sub: userId,

      email:
        email
          .trim()
          .toLowerCase(),

      scope:
        PASSWORD_RESET_SCOPE,
    },

    getJwtSecret(),

    {
      expiresIn:
        PASSWORD_RESET_TOKEN_EXPIRY,
    }
  );
}

export function verifyPasswordResetToken(
  token: string
): PasswordResetSession | null {
  try {
    const decoded =
      jwt.verify(
        token,
        getJwtSecret()
      ) as jwt.JwtPayload & {
        email?: unknown;
        scope?: unknown;
      };

    if (
      typeof decoded.sub !==
        "string" ||
      typeof decoded.email !==
        "string" ||
      decoded.scope !==
        PASSWORD_RESET_SCOPE
    ) {
      return null;
    }

    return {
      userId:
        decoded.sub,

      email:
        decoded.email
          .trim()
          .toLowerCase(),
    };
  } catch {
    return null;
  }
}