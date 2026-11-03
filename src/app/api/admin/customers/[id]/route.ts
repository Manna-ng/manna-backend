import {
  NextResponse,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";

export async function GET(
  _req: Request,
  ctx: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const { id } =
    await ctx.params;

  const [
    customer,
    feedback,
  ] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id,
        role: "CUSTOMER",
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        deliveryProfile:
          true,
        orders: {
          orderBy: {
            createdAt: "desc",
          },
          take: 100,
          include: {
            delivery: true,
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    imageUrl: true,
                  },
                },
                productVariant:
                  true,
              },
            },
          },
        },
      },
    }),
    prisma.customerFeedback.findMany({
      where: {
        userId: id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    }),
  ]);

  if (!customer) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Customer not found",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    customer,
    feedback,
  });
}
