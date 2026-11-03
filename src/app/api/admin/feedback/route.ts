import {
  NextResponse,
  type NextRequest,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";

export async function GET(
  req: NextRequest
) {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const status =
    req.nextUrl.searchParams.get(
      "status"
    );

  const orderId =
    req.nextUrl.searchParams.get(
      "orderId"
    );

  const rawLimit =
    Number(
      req.nextUrl.searchParams.get(
        "limit"
      ) ?? "50"
    );

  const limit =
    Number.isInteger(
      rawLimit
    )
      ? Math.min(
          Math.max(
            rawLimit,
            1
          ),
          100
        )
      : 50;

  const feedback =
    await prisma.customerFeedback.findMany({
      where: {
        ...(status
          ? { status }
          : {}),
        ...(orderId
          ? { orderId }
          : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
    });

  return NextResponse.json({
    data: feedback,
  });
}
