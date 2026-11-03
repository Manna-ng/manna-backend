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

  const status =
    req.nextUrl.searchParams.get(
      "status"
    );

  const processingStatus =
    req.nextUrl.searchParams.get(
      "processingStatus"
    );

  const q =
    req.nextUrl.searchParams.get(
      "q"
    )?.trim();

  const where:
    Record<string, unknown> = {};

  if (status) {
    where.status = status;
  }

  if (processingStatus) {
    where.processingStatus =
      processingStatus;
  }

  if (q) {
    where.OR = [
      {
        order: {
          is: {
            orderNumber: {
              contains: q,
              mode: "insensitive",
            },
          },
        },
      },
      {
        order: {
          is: {
            user: {
              is: {
                name: {
                  contains: q,
                  mode: "insensitive",
                },
              },
            },
          },
        },
      },
      {
        order: {
          is: {
            user: {
              is: {
                email: {
                  contains: q,
                  mode: "insensitive",
                },
              },
            },
          },
        },
      },
    ];
  }

  const [
    total,
    deliveries,
  ] =
    await prisma.$transaction([
      prisma.delivery.count({
        where:
          where as never,
      }),
      prisma.delivery.findMany({
        where:
          where as never,
        orderBy: {
          createdAt: "desc",
        },
        skip:
          (page - 1) *
          pageSize,
        take: pageSize,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              paymentStatus:
                true,
              totalAmountNgn:
                true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
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
    deliveries,
  });
}
