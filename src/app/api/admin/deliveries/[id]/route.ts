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

  const delivery =
    await prisma.delivery.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
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
                productVariant:
                  true,
              },
            },
          },
        },
      },
    });

  if (!delivery) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Delivery not found",
      },
      { status: 404 }
    );
  }

  const kwikTask =
    await prisma.kwikDeliveryTask.findUnique({
      where: {
        deliveryId: id,
      },
    });

  return NextResponse.json({
    ok: true,
    delivery,
    kwikTask,
  });
}
