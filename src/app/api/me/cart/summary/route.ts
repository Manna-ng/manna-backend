import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  applyDiscountDetailed,
  getActiveDiscounts,
  getBestActiveDiscountForProduct,
} from "@/services/discount.service";

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("manna_token")?.value;
    if (!token) return unauthorized();

    const decoded = verifyAuthToken(token);
    if (!decoded?.userId || decoded.role !== "CUSTOMER") return unauthorized();

    // GET must not create or mutate a cart. An account with no cart simply has an empty cart.
    const cart = await prisma.cart.findUnique({
      where: { userId: decoded.userId },
      select: {
        id: true,
        updatedAt: true,
        marketCluster: {
          select: {
            id: true,
            name: true,
            slug: true,
            city: true,
            state: true,
          },
        },
        items: {
          orderBy: { updatedAt: "desc" },
          take: 100,
          select: {
            id: true,
            quantity: true,
            createdAt: true,
            updatedAt: true,
            productId: true,
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                imageUrl: true,
                marketClusterId: true,
                vendor: {
                  select: {
                    id: true,
                    displayName: true,
                    slug: true,
                  },
                },
              },
            },
            productVariant: {
              select: {
                id: true,
                name: true,
                unit: true,
                unitWeightKg: true,
                priceNgn: true,
                stockQty: true,
              },
            },
          },
        },
      },
    });

    if (!cart) {
      return NextResponse.json({
        cart: null,
        summary: {
          totalItems: 0,
          currency: "NGN",
          subtotalBeforeDiscountNgn: 0,
          discountTotalNgn: 0,
          subtotalAfterDiscountNgn: 0,
        },
        items: [],
      });
    }

    const discounts = await getActiveDiscounts();

    let totalItems = 0;
    let subtotalBeforeDiscountNgn = 0;
    let discountTotalNgn = 0;
    let subtotalAfterDiscountNgn = 0;

    const items = cart.items.map((item) => {
      const originalUnitPriceNgn = item.productVariant?.priceNgn ?? 0;
      const appliedDiscount = getBestActiveDiscountForProduct(discounts, item.productId);
      const { finalAmount: discountedUnitPriceNgn, discountAmount: discountAmountPerUnitNgn } =
        applyDiscountDetailed(originalUnitPriceNgn, appliedDiscount);

      const lineTotalBeforeDiscountNgn = originalUnitPriceNgn * item.quantity;
      const lineDiscountNgn = discountAmountPerUnitNgn * item.quantity;
      const lineTotalAfterDiscountNgn = discountedUnitPriceNgn * item.quantity;

      totalItems += item.quantity;
      subtotalBeforeDiscountNgn += lineTotalBeforeDiscountNgn;
      discountTotalNgn += lineDiscountNgn;
      subtotalAfterDiscountNgn += lineTotalAfterDiscountNgn;

      return {
        id: item.id,
        quantity: item.quantity,
        originalUnitPriceNgn,
        discountedUnitPriceNgn,
        discountAmountPerUnitNgn,
        lineTotalBeforeDiscountNgn,
        lineDiscountNgn,
        lineTotalAfterDiscountNgn,
        product: item.product,
        variant: item.productVariant,
        appliedDiscount: appliedDiscount
          ? {
              id: appliedDiscount.id,
              title: appliedDiscount.title,
              type: appliedDiscount.type,
              percentageOff: appliedDiscount.percentageOff,
              fixedAmountOff: appliedDiscount.fixedAmountOff,
              appliesToAll: appliedDiscount.appliesToAll,
              productIds: appliedDiscount.productIds,
              startsAt: appliedDiscount.startsAt,
              endsAt: appliedDiscount.endsAt,
            }
          : null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    return NextResponse.json({
      cart: {
        id: cart.id,
        updatedAt: cart.updatedAt,
        marketCluster: cart.marketCluster,
      },
      summary: {
        totalItems,
        currency: "NGN",
        subtotalBeforeDiscountNgn,
        discountTotalNgn,
        subtotalAfterDiscountNgn,
      },
      items,
    });
  } catch (error) {
    console.error("CART_SUMMARY_ERROR", error);
    return NextResponse.json({ message: "Unable to load your cart" }, { status: 500 });
  }
}
