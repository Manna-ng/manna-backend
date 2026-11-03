import {
  NextResponse,
  type NextRequest,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";

function toInt(
  value: string | null,
  fallback: number
) {
  const parsed =
    Number(value);

  return (
    Number.isInteger(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

export async function GET(
  req: NextRequest
) {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const page =
    toInt(
      req.nextUrl.searchParams.get(
        "page"
      ),
      1
    );

  const pageSize =
    Math.min(
      toInt(
        req.nextUrl.searchParams.get(
          "pageSize"
        ),
        20
      ),
      100
    );

  const q =
    req.nextUrl.searchParams.get(
      "q"
    )?.trim();

  const where:
    Record<string, unknown> = {
      role: "CUSTOMER",
  };

  if (q) {
    where.OR = [
      {
        name: {
          contains: q,
          mode: "insensitive",
        },
      },
      {
        email: {
          contains: q,
          mode: "insensitive",
        },
      },
      {
        phone: {
          contains: q,
          mode: "insensitive",
        },
      },
    ];
  }

  const [
    total,
    customers,
  ] =
    await prisma.$transaction([
      prisma.user.count({
        where:
          where as never,
      }),
      prisma.user.findMany({
        where:
          where as never,
        orderBy: {
          createdAt: "desc",
        },
        skip:
          (page - 1) *
          pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          createdAt: true,
          updatedAt: true,
          deliveryProfile:
            true,
          _count: {
            select: {
              orders: true,
            },
          },
        },
      }),
    ]);

  return NextResponse.json({
    ok: true,
    page,
    pageSize,
    total,
    totalPages:
      Math.ceil(
        total /
          pageSize
      ),
    customers,
  });
}
