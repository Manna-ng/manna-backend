import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminAuthToken } from "@/lib/auth";

export type RequireAdminResult =
  | {
      ok: true;
      adminId: string;
      csrfToken: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

function unauthorized() {
  return NextResponse.json(
    { message: "Admin authentication required" },
    { status: 401 }
  );
}

function forbidden() {
  return NextResponse.json(
    { message: "Admin access required" },
    { status: 403 }
  );
}

export async function requireAdmin(): Promise<RequireAdminResult> {
  const cookieStore = await cookies();
  const adminToken =
    cookieStore.get("manna_admin_token")?.value;

  if (!adminToken) {
    return {
      ok: false,
      response: unauthorized(),
    };
  }

  const adminSession =
    verifyAdminAuthToken(adminToken);

  if (!adminSession) {
    return {
      ok: false,
      response: unauthorized(),
    };
  }

  const admin =
    await prisma.user.findFirst({
      where: {
        id: adminSession.userId,
        role: "ADMIN",
      },
      select: {
        id: true,
      },
    });

  if (!admin) {
    return {
      ok: false,
      response: forbidden(),
    };
  }

  return {
    ok: true,
    adminId: admin.id,
    csrfToken: adminSession.csrfToken,
  };
}
