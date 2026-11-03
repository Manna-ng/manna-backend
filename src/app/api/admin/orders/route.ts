import {
  NextResponse,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";

function toInt(
  value: string | null,
  fallback: number
) {
  const parsed =
    Number(value);

  return (
    Number.isFinite(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

export async function GET(
  req: Request
) {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const url =
      new URL(req.url);

    const page =
      toInt(
        url.searchParams.get(
          "page"
        ),
        1
      );

    const pageSize =
      Math.min(
        toInt(
          url.searchParams.get(
            "pageSize"
          ),
          20
        ),
        100
      );

    const status =
      url.searchParams.get(
        "status"
      );

    const paymentStatus =
      url.searchParams.get(
        "paymentStatus"
      );

    const q =
      (
        url.searchParams.get(
          "q"
        ) || ""
      ).trim();

    const where:
      Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }

    if (paymentStatus) {
      where.paymentStatus =
        paymentStatus;
    }

    if (q) {
      where.OR = [
        {
          orderNumber: {
            contains: q,
            mode: "insensitive",
          },
        },
        {
          user: {
            is: {
              phone: {
                contains: q,
                mode: "insensitive",
              },
            },
          },
        },
        {
          user: {
            is: {
              email: {
                contains: q,
                mode: "insensitive",
              },
            },
          },
        },
        {
          user: {
            is: {
              name: {
                contains: q,
                mode: "insensitive",
              },
            },
          },
        },
      ];
    }

    const [
      total,
      orders,
    ] =
      await prisma.$transaction([
        prisma.order.count({
          where:
            where as never,
        }),
        prisma.order.findMany({
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
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
              },
            },
            delivery: true,
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    imageUrl: true,
                    vendorId: true,
                  },
                },
                productVariant: {
                  select: {
                    id: true,
                    name: true,
                    unit: true,
                    unitWeightKg:
                      true,
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
      orders,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "list_orders_error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
