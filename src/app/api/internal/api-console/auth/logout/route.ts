import { NextResponse } from "next/server";

export async function POST() {
  const response =
    NextResponse.json({
      success: true,
    });

  /**
   * ONLY customer cookie is removed.
   *
   * Never touch manna_admin_token here.
   */
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

  return response;
}