import {
  NextResponse,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";

export async function GET() {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const user =
    await prisma.user.findUnique({
      where: {
        id: admin.adminId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });

  if (
    !user ||
    user.role !== "ADMIN"
  ) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Admin access required",
      },
      { status: 403 }
    );
  }

  return NextResponse.json({
    ok: true,
    admin: user,
    csrfToken:
      admin.csrfToken,
  });
}
