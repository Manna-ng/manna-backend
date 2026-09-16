import {
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import type {
  AuthOtpPurpose,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const OTP_CODE_LENGTH = 6;

export const OTP_TTL_SECONDS =
  5 * 60;

export const OTP_RESEND_COOLDOWN_SECONDS =
  60;

export const OTP_MAX_ATTEMPTS = 5;

export const OTP_MAX_SENDS_PER_HOUR =
  5;

const OTP_SEND_WINDOW_MS =
  60 * 60 * 1000;

type PendingSignupData = {
  name: string;
  phone: string;
  passwordHash: string;
};

export class OtpCooldownError
  extends Error {
  retryAfterSeconds: number;

  constructor(
    retryAfterSeconds: number
  ) {
    super(
      `Please wait ${retryAfterSeconds} seconds before requesting another code.`
    );

    this.name =
      "OtpCooldownError";

    this.retryAfterSeconds =
      retryAfterSeconds;
  }
}

export class OtpRateLimitError
  extends Error {
  constructor() {
    super(
      "Too many verification codes have been requested. Please try again later."
    );

    this.name =
      "OtpRateLimitError";
  }
}

export class OtpVerificationError
  extends Error {
  code:
    | "NOT_FOUND"
    | "EXPIRED"
    | "INVALID"
    | "LOCKED"
    | "CONSUMED";

  remainingAttempts?: number;

  constructor(
    code:
      | "NOT_FOUND"
      | "EXPIRED"
      | "INVALID"
      | "LOCKED"
      | "CONSUMED",

    message: string,

    remainingAttempts?: number
  ) {
    super(message);

    this.name =
      "OtpVerificationError";

    this.code = code;

    this.remainingAttempts =
      remainingAttempts;
  }
}

function getOtpSecret() {
  const secret =
    process.env.AUTH_OTP_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim();

  if (
    !secret ||
    secret.length < 32
  ) {
    throw new Error(
      "AUTH_OTP_SECRET or JWT_SECRET must be at least 32 characters."
    );
  }

  return secret;
}

function normalizeEmail(
  email: string
) {
  return email
    .trim()
    .toLowerCase();
}

function generateOtpCode() {
  return randomInt(
    0,
    1_000_000
  )
    .toString()
    .padStart(
      OTP_CODE_LENGTH,
      "0"
    );
}

function hashOtpCode(
  purpose: AuthOtpPurpose,
  email: string,
  code: string
) {
  return createHmac(
    "sha256",
    getOtpSecret()
  )
    .update(
      `${purpose}:${normalizeEmail(
        email
      )}:${code}`
    )
    .digest("hex");
}

function safeEqualHex(
  left: string,
  right: string
) {
  try {
    const leftBuffer =
      Buffer.from(
        left,
        "hex"
      );

    const rightBuffer =
      Buffer.from(
        right,
        "hex"
      );

    if (
      leftBuffer.length !==
      rightBuffer.length
    ) {
      return false;
    }

    return timingSafeEqual(
      leftBuffer,
      rightBuffer
    );
  } catch {
    return false;
  }
}

export async function issueOtpChallenge(
  input: {
    purpose: AuthOtpPurpose;
    email: string;
    pendingSignup?: PendingSignupData;
  }
) {
  const email =
    normalizeEmail(input.email);

  const now =
    new Date();

  const existing =
    await prisma.authOtpChallenge
      .findUnique({
        where: {
          purpose_email: {
            purpose:
              input.purpose,

            email,
          },
        },
      });

  if (
    existing &&
    existing.resendAvailableAt
      .getTime() >
      now.getTime()
  ) {
    const retryAfterSeconds =
      Math.max(
        1,

        Math.ceil(
          (
            existing
              .resendAvailableAt
              .getTime() -
            now.getTime()
          ) / 1000
        )
      );

    throw new OtpCooldownError(
      retryAfterSeconds
    );
  }

  const windowExpired =
    !existing ||
    now.getTime() -
      existing
        .sendWindowStartedAt
        .getTime() >=
      OTP_SEND_WINDOW_MS;

  const sendCount =
    windowExpired
      ? 1
      : (
          existing?.sendCount ??
          0
        ) + 1;

  if (
    sendCount >
    OTP_MAX_SENDS_PER_HOUR
  ) {
    throw new OtpRateLimitError();
  }

  const code =
    generateOtpCode();

  const codeHash =
    hashOtpCode(
      input.purpose,
      email,
      code
    );

  const expiresAt =
    new Date(
      now.getTime() +
        OTP_TTL_SECONDS *
          1000
    );

  const resendAvailableAt =
    new Date(
      now.getTime() +
        OTP_RESEND_COOLDOWN_SECONDS *
          1000
    );

  if (
    input.purpose ===
      "SIGNUP" &&
    input.pendingSignup
  ) {
    /*
     * If somebody starts another
     * signup using the same phone,
     * the latest pending signup
     * becomes authoritative.
     */
    await prisma
      .authOtpChallenge
      .deleteMany({
        where: {
          purpose:
            "SIGNUP",

          pendingPhone:
            input.pendingSignup
              .phone,

          email: {
            not: email,
          },

          consumedAt: null,
        },
      });
  }

  const challenge =
    await prisma
      .authOtpChallenge
      .upsert({
        where: {
          purpose_email: {
            purpose:
              input.purpose,

            email,
          },
        },

        create: {
          purpose:
            input.purpose,

          email,

          codeHash,

          pendingName:
            input.pendingSignup
              ?.name,

          pendingPhone:
            input.pendingSignup
              ?.phone,

          pendingPasswordHash:
            input.pendingSignup
              ?.passwordHash,

          attempts: 0,

          sendCount,

          sendWindowStartedAt:
            windowExpired
              ? now
              : existing
                  ?.sendWindowStartedAt ??
                now,

          expiresAt,

          resendAvailableAt,

          consumedAt: null,
        },

        update: {
          codeHash,

          pendingName:
            input.pendingSignup
              ?.name ??
            existing?.pendingName,

          pendingPhone:
            input.pendingSignup
              ?.phone ??
            existing?.pendingPhone,

          pendingPasswordHash:
            input.pendingSignup
              ?.passwordHash ??
            existing
              ?.pendingPasswordHash,

          attempts: 0,

          sendCount,

          sendWindowStartedAt:
            windowExpired
              ? now
              : existing
                  ?.sendWindowStartedAt ??
                now,

          expiresAt,

          resendAvailableAt,

          consumedAt: null,
        },
      });

  return {
    challenge,
    code,

    expiresInSeconds:
      OTP_TTL_SECONDS,

    resendAfterSeconds:
      OTP_RESEND_COOLDOWN_SECONDS,
  };
}

export async function releaseOtpCooldownAfterDeliveryFailure(
  purpose: AuthOtpPurpose,
  email: string
) {
  const normalizedEmail =
    normalizeEmail(email);

  await prisma
    .authOtpChallenge
    .update({
      where: {
        purpose_email: {
          purpose,

          email:
            normalizedEmail,
        },
      },

      data: {
        resendAvailableAt:
          new Date(),
      },
    })
    .catch(
      () => undefined
    );
}

export async function getOtpChallenge(
  purpose: AuthOtpPurpose,
  email: string
) {
  return prisma
    .authOtpChallenge
    .findUnique({
      where: {
        purpose_email: {
          purpose,

          email:
            normalizeEmail(
              email
            ),
        },
      },
    });
}

export async function validateOtpCode(
  input: {
    purpose: AuthOtpPurpose;
    email: string;
    code: string;
  }
) {
  const email =
    normalizeEmail(input.email);

  const challenge =
    await getOtpChallenge(
      input.purpose,
      email
    );

  const now =
    new Date();

  if (!challenge) {
    throw new OtpVerificationError(
      "NOT_FOUND",

      "No active verification code was found. Request a new code."
    );
  }

  if (
    challenge.consumedAt
  ) {
    throw new OtpVerificationError(
      "CONSUMED",

      "This verification code has already been used."
    );
  }

  if (
    challenge.expiresAt
      .getTime() <=
    now.getTime()
  ) {
    throw new OtpVerificationError(
      "EXPIRED",

      "This verification code has expired. Request a new code."
    );
  }

  if (
    challenge.attempts >=
    OTP_MAX_ATTEMPTS
  ) {
    throw new OtpVerificationError(
      "LOCKED",

      "Too many incorrect attempts. Request a new verification code."
    );
  }

  const expectedHash =
    hashOtpCode(
      input.purpose,
      email,
      input.code
    );

  const isValid =
    safeEqualHex(
      expectedHash,
      challenge.codeHash
    );

  if (!isValid) {
    const attempts =
      challenge.attempts + 1;

    await prisma
      .authOtpChallenge
      .update({
        where: {
          id: challenge.id,
        },

        data: {
          attempts,
        },
      });

    const remainingAttempts =
      Math.max(
        0,

        OTP_MAX_ATTEMPTS -
          attempts
      );

    throw new OtpVerificationError(
      attempts >=
        OTP_MAX_ATTEMPTS
        ? "LOCKED"
        : "INVALID",

      attempts >=
        OTP_MAX_ATTEMPTS
        ? "Too many incorrect attempts. Request a new verification code."
        : "The verification code is incorrect.",

      remainingAttempts
    );
  }

  return challenge;
}