import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifyAuthToken } from "@/lib/auth";
import { createMarketplacePendingOrderFromQuote } from "@/lib/checkout/marketplaceCheckout";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({
  deliveryQuoteId: z.string().uuid(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().min(1),
      })
    )
    .min(1),
});

function unauthorized() {
  return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());

    const cookieStore = await cookies();
    const token = cookieStore.get("manna_token")?.value;
    if (!token) return unauthorized();

    const decoded = verifyAuthToken(token);
    if (!decoded?.userId || decoded.role !== "CUSTOMER") return unauthorized();

    const customer = await prisma.user.findFirst({
      where: { id: decoded.userId, role: "CUSTOMER" },
      select: {
        deliveryProfile: {
          select: {
            address1: true,
            address2: true,
            city: true,
            state: true,
            latitude: true,
            longitude: true,
            deliveryNote: true,
          },
        },
      },
    });

    if (!customer?.deliveryProfile) {
      return NextResponse.json(
        {
          ok: false,
          code: "DELIVERY_PROFILE_REQUIRED",
          message: "Add your delivery details in My Manna Account before checkout.",
        },
        { status: 409 }
      );
    }

    const delivery = customer.deliveryProfile;
    const deliveryLatitude = delivery.latitude;
    const deliveryLongitude = delivery.longitude;

    if (deliveryLatitude === null || deliveryLongitude === null) {
      return NextResponse.json(
        {
          ok: false,
          code: "DELIVERY_LOCATION_REQUIRED",
          message:
            "Use current location in My Manna Account so Manna can calculate delivery before checkout.",
        },
        { status: 409 }
      );
    }
    const result = await createMarketplacePendingOrderFromQuote({
      userId: decoded.userId,
      deliveryQuoteId: body.deliveryQuoteId,
      items: body.items,
      deliveryAddress1: delivery.address1,
      deliveryAddress2: delivery.address2 ?? undefined,
      city: delivery.city,
      state: delivery.state,
      deliveryNote: delivery.deliveryNote ?? undefined,
      deliveryLat: deliveryLatitude,
      deliveryLng: deliveryLongitude,
    });

    return NextResponse.json(
      {
        ok: true,
        order: {
          id: result.order.id,
          orderNumber: result.order.orderNumber,
          status: result.order.status,
          paymentStatus: result.order.paymentStatus,
          deliveryQuoteId: body.deliveryQuoteId,
          totals: result.totals,
        },
        deliveryQuote: result.deliveryQuote,
        pricing: {
          currency: result.pricing.currency,
          totals: result.totals,
          items: result.pricing.items,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
