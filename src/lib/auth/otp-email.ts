import type {
  AuthOtpPurpose,
} from "@prisma/client";

import {
  sendBrevoTransactionalEmail,
} from "@/lib/brevo/transactional";

function escapeHtml(
  value: string
) {
  return value
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

export async function sendAuthOtpEmail(
  input: {
    purpose: AuthOtpPurpose;
    email: string;
    code: string;
    name?: string | null;
  }
) {
  const isSignup =
    input.purpose ===
    "SIGNUP";

  const subject =
    isSignup
      ? `${input.code} is your Manna verification code`
      : `${input.code} is your Manna password reset code`;

  const safeName =
    escapeHtml(
      input.name?.trim() ||
        "there"
    );

  const purposeText =
    isSignup
      ? "complete your Manna account setup"
      : "reset your Manna password";

  const htmlContent = `
<!doctype html>
<html>
  <body
    style="
      margin:0;
      padding:0;
      background:#fffdf0;
      font-family:Arial,Helvetica,sans-serif;
      color:#072720;
    "
  >
    <div
      style="
        max-width:560px;
        margin:0 auto;
        padding:40px 24px;
      "
    >
      <div
        style="
          background:#ffffff;
          border-radius:20px;
          padding:32px;
          border:1px solid #e8eadf;
        "
      >
        <div
  style="
    margin-bottom:22px;
  "
>
  <img
    src="${process.env.MANNA_EMAIL_LOGO_URL ?? ""}"
    alt="Manna"
    width="44"
    height="44"
    style="
      display:inline-block;
      vertical-align:middle;
      object-fit:contain;
      margin-right:10px;
    "
  />

  <span
    style="
      display:inline-block;
      vertical-align:middle;
      font-size:28px;
      font-weight:700;
      color:#00A14B;
    "
  >
    Manna
  </span>
</div>

        <p
          style="
            font-size:16px;
            line-height:1.6;
            margin:0 0 12px;
          "
        >
          Hi ${safeName},
        </p>

        <p
          style="
            font-size:16px;
            line-height:1.6;
            margin:0 0 24px;
          "
        >
          Use this verification
          code to ${purposeText}:
        </p>

        <div
          style="
            font-size:34px;
            letter-spacing:10px;
            font-weight:700;
            color:#086453;
            background:#DFFBCB;
            padding:20px 18px;
            border-radius:14px;
            text-align:center;
          "
        >
          ${input.code}
        </div>

        <p
          style="
            font-size:14px;
            line-height:1.6;
            color:#5f6f69;
            margin:24px 0 0;
          "
        >
          This code expires in
          5 minutes. Never share
          this code with anyone,
          including someone
          claiming to be from
          Manna.
        </p>

        <p
          style="
            font-size:14px;
            line-height:1.6;
            color:#5f6f69;
            margin:12px 0 0;
          "
        >
          If you did not request
          this, you can safely
          ignore this email.
        </p>
      </div>
    </div>
  </body>
</html>
`;

  const textContent = [
    `Hi ${
      input.name?.trim() ||
      "there"
    },`,

    "",

    `Your Manna verification code is ${input.code}.`,

    `Use it to ${purposeText}.`,

    "",

    "This code expires in 5 minutes. Never share it with anyone.",

    "If you did not request this, you can safely ignore this email.",
  ].join("\n");

  return sendBrevoTransactionalEmail(
    {
      toEmail:
        input.email,

      toName:
        input.name,

      subject,

      htmlContent,

      textContent,

      tags: [
        isSignup
          ? "manna-signup-otp"
          : "manna-password-reset-otp",
      ],
    }
  );
}