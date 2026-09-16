import { Prisma, type Discount } from "@prisma/client";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { verifyAuthToken } from "@/lib/auth";
import {
  parseCoordinatesFromSearchParams,
  resolveMarketSelection,
  type MarketSelectionSource,
} from "@/lib/marketplace/marketSelection";
import { prisma } from "@/lib/prisma";
import {
  applyDiscountToPriceNgn,
  getActiveDiscounts,
  getBestActiveDiscountForProduct,
} from "@/services/discount.service";

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

function marketplaceProductWhere(marketClusterId?: string | null): Prisma.ProductWhereInput {
  return {
    isActive: true,
    approvalStatus: "APPROVED",
    ...(marketClusterId ? { marketClusterId } : {}),
    OR: [
      { vendorId: null },
      {
        vendor: {
          status: "APPROVED",
          isActive: true,
          isVisible: true,
        },
      },
    ],
  };
}

function serializeDiscount(discount: Discount | null) {
  if (!discount) return null;

  return {
    id: discount.id,
    title: discount.title,
    description: discount.description,
    type: discount.type,
    percentageOff: discount.percentageOff,
    fixedAmountOff: discount.fixedAmountOff,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
  };
}

const productSelect = {
  id: true,
  name: true,
  slug: true,
  category: true,
  subCategory: true,
  imageUrl: true,
  isFeatured: true,
  ratingAverage: true,
  ratingCount: true,
  marketClusterId: true,
  createdAt: true,
  updatedAt: true,
  vendor: {
    select: {
      id: true,
      displayName: true,
      slug: true,
      logoUrl: true,
      ratingAverage: true,
      ratingCount: true,
    },
  },
  marketCluster: {
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      state: true,
      centerAddress: true,
    },
  },
  variants: {
    orderBy: { priceNgn: "asc" as const },
    select: {
      id: true,
      name: true,
      unit: true,
      unitWeightKg: true,
      priceNgn: true,
      stockQty: true,
    },
  },
} satisfies Prisma.ProductSelect;

type DashboardProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

function serializeProduct(product: DashboardProduct, discounts: Discount[]) {
  const discount = getBestActiveDiscountForProduct(discounts, product.id);

  return {
    ...product,
    seller: {
      name: product.vendor?.displayName ?? "Manna",
      vendorId: product.vendor?.id ?? null,
      vendorSlug: product.vendor?.slug ?? null,
      logoUrl: product.vendor?.logoUrl ?? null,
      rating: {
        average: product.vendor?.ratingAverage ?? 0,
        count: product.vendor?.ratingCount ?? 0,
      },
    },
    rating: {
      average: product.ratingAverage,
      count: product.ratingCount,
    },
    discount: serializeDiscount(discount),
    variants: product.variants.map((variant) => {
      const originalPriceNgn = variant.priceNgn;
      const discountedPriceNgn = discount
        ? applyDiscountToPriceNgn(originalPriceNgn, discount)
        : originalPriceNgn;

      return {
        ...variant,
        originalPriceNgn,
        discountedPriceNgn,
        hasDiscount: discountedPriceNgn < originalPriceNgn,
      };
    }),
  };
}

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("manna_token")?.value;

    if (!token) return unauthorized();

    const decoded = verifyAuthToken(token);
    if (!decoded?.userId || decoded.role !== "CUSTOMER") return unauthorized();

    const coordinateInput = parseCoordinatesFromSearchParams(req.nextUrl.searchParams);
    if (coordinateInput.error) {
      return NextResponse.json({ message: coordinateInput.error }, { status: 400 });
    }

    const requestedMarketClusterId = req.nextUrl.searchParams.get("marketClusterId")?.trim() || null;

    const [user, cart, recentOrders] = await Promise.all([
      prisma.user.findFirst({
        where: { id: decoded.userId, role: "CUSTOMER" },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          role: true,
          isFaceCaptured: true,
          isFaceVerified: true,
          createdAt: true,
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
      }),
      prisma.cart.findUnique({
        where: { userId: decoded.userId },
        select: {
          id: true,
          marketClusterId: true,
          _count: { select: { items: true } },
          marketCluster: {
            select: {
              id: true,
              name: true,
              slug: true,
              city: true,
              state: true,
            },
          },
        },
      }),
      prisma.order.findMany({
        where: { userId: decoded.userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          totalAmountNgn: true,
          deliveryFeeNgn: true,
          deliveryAddress1: true,
          deliveryAddress2: true,
          city: true,
          state: true,
          deliveryLat: true,
          deliveryLng: true,
          deliveryEstimate: true,
          createdAt: true,
          marketCluster: {
            select: {
              id: true,
              name: true,
              slug: true,
              city: true,
              state: true,
            },
          },
          delivery: {
            select: {
              id: true,
              status: true,
              kwikTrackingUrl: true,
              kwikTaskId: true,
              deliveredAt: true,
            },
          },
          items: {
            take: 3,
            select: {
              id: true,
              quantity: true,
              unitPriceNgn: true,
              subtotalNgn: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  imageUrl: true,
                  slug: true,
                },
              },
              productVariant: {
                select: {
                  id: true,
                  name: true,
                  unit: true,
                  unitWeightKg: true,
                },
              },
            },
          },
        },
      }),
    ]);

    if (!user) return unauthorized();

    const latestOrder = recentOrders[0] ?? null;
    const profileLatitude = user.deliveryProfile?.latitude;
    const profileLongitude = user.deliveryProfile?.longitude;
    const profileCoordinates =
      profileLatitude !== null &&
      profileLatitude !== undefined &&
      profileLongitude !== null &&
      profileLongitude !== undefined
        ? { lat: profileLatitude, lng: profileLongitude }
        : null;
    const lastOrderCoordinates =
      latestOrder?.deliveryLat !== null &&
      latestOrder?.deliveryLat !== undefined &&
      latestOrder.deliveryLng !== null &&
      latestOrder.deliveryLng !== undefined
        ? { lat: latestOrder.deliveryLat, lng: latestOrder.deliveryLng }
        : null;

    let source: MarketSelectionSource = "NONE";
    let marketClusterId: string | null = null;

    if (requestedMarketClusterId) {
      source = "EXPLICIT";
      marketClusterId = requestedMarketClusterId;
    } else if (cart?.marketClusterId && cart._count.items > 0) {
      source = "CART";
      marketClusterId = cart.marketClusterId;
    } else if (coordinateInput.coordinates) {
      source = "COORDINATES";
    } else if (profileCoordinates) {
      source = "PROFILE";
    } else if (lastOrderCoordinates) {
      source = "LAST_ORDER";
    }

    const selectionCoordinates = coordinateInput.coordinates ?? profileCoordinates ?? lastOrderCoordinates;

    const marketSelection = marketClusterId
      ? await resolveMarketSelection({
          marketClusterId,
          coordinates: selectionCoordinates,
          source: source === "CART" ? "CART" : "EXPLICIT",
        })
      : await resolveMarketSelection({
          coordinates: selectionCoordinates,
        });

    if (marketClusterId && !marketSelection.selectedMarket) {
      return NextResponse.json({ message: "Market cluster not found or inactive" }, { status: 404 });
    }

    const normalizedSource: MarketSelectionSource =
      source === "PROFILE" && marketSelection.source === "COORDINATES"
        ? "PROFILE"
        : source === "LAST_ORDER" && marketSelection.source === "COORDINATES"
          ? "LAST_ORDER"
          : source === "COORDINATES" && marketSelection.source === "COORDINATES"
            ? "COORDINATES"
            : marketSelection.source;

    const locationWasUsed = Boolean(selectionCoordinates);
    const locationOutsideServiceArea =
      locationWasUsed &&
      !marketClusterId &&
      marketSelection.serviceable === false;

    const selectedMarketClusterId = marketSelection.selectedMarket?.id ?? null;
    const catalogWhere = marketplaceProductWhere(selectedMarketClusterId);

    const activeDiscounts = await getActiveDiscounts();

    let categories: Array<{ name: string; imageUrl: string | null; subCategories: string[] }> = [];
    let featuredProducts: ReturnType<typeof serializeProduct>[] = [];
    let mostOrderedProducts: Array<ReturnType<typeof serializeProduct> & { totalOrderedQty: number }> = [];

    if (!locationOutsideServiceArea) {
      const [categoryPairs, categoryImageRows, featuredProductsRaw, topOrdered] = await Promise.all([
        prisma.product.findMany({
          where: catalogWhere,
          select: { category: true, subCategory: true },
          distinct: ["category", "subCategory"],
        }),
        prisma.product.findMany({
          where: {
            ...catalogWhere,
            imageUrl: { not: null },
          },
          orderBy: { updatedAt: "desc" },
          select: { category: true, imageUrl: true },
        }),
        prisma.product.findMany({
          where: {
            ...catalogWhere,
            isFeatured: true,
          },
          orderBy: [{ ratingAverage: "desc" }, { updatedAt: "desc" }],
          take: 8,
          select: productSelect,
        }),
        prisma.orderItem.groupBy({
          by: ["productId"],
          where: { product: catalogWhere },
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: "desc" } },
          take: 8,
        }),
      ]);

      const categoryMap = new Map<string, Set<string>>();
      for (const row of categoryPairs) {
        const category = row.category.trim();
        if (!category) continue;
        if (!categoryMap.has(category)) categoryMap.set(category, new Set());
        const subCategory = row.subCategory?.trim();
        if (subCategory) categoryMap.get(category)!.add(subCategory);
      }

      const categoryImageMap = new Map<string, string>();
      for (const row of categoryImageRows) {
        const image = row.imageUrl?.trim();
        if (image && !categoryImageMap.has(row.category)) {
          categoryImageMap.set(row.category, image);
        }
      }

      categories = Array.from(categoryMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, subCategories]) => ({
          name,
          imageUrl: categoryImageMap.get(name) ?? null,
          subCategories: Array.from(subCategories).sort((a, b) => a.localeCompare(b)),
        }));

      featuredProducts = featuredProductsRaw.map((product) =>
        serializeProduct(product, activeDiscounts)
      );

      const topProductIds = topOrdered.map((row) => row.productId);
      const topProductsRaw = topProductIds.length
        ? await prisma.product.findMany({
            where: {
              ...catalogWhere,
              id: { in: topProductIds },
            },
            select: productSelect,
          })
        : [];

      const quantityMap = new Map(
        topOrdered.map((row) => [row.productId, row._sum.quantity ?? 0])
      );

      mostOrderedProducts = topProductIds
        .map((productId) => {
          const product = topProductsRaw.find((row) => row.id === productId);
          if (!product) return null;
          return {
            ...serializeProduct(product, activeDiscounts),
            totalOrderedQty: quantityMap.get(productId) ?? 0,
          };
        })
        .filter((product): product is NonNullable<typeof product> => product !== null);
    }

    const [pendingPaymentCount, processingCount, outForDeliveryCount, deliveredCount] =
      await Promise.all([
        prisma.order.count({ where: { userId: user.id, status: "PENDING_PAYMENT" } }),
        prisma.order.count({ where: { userId: user.id, status: "PROCESSING" } }),
        prisma.order.count({ where: { userId: user.id, status: "OUT_FOR_DELIVERY" } }),
        prisma.order.count({ where: { userId: user.id, status: "DELIVERED" } }),
      ]);

    const lastDeliveryLocation = user.deliveryProfile
      ? {
          address1: user.deliveryProfile.address1,
          address2: user.deliveryProfile.address2,
          city: user.deliveryProfile.city,
          state: user.deliveryProfile.state,
          lat: user.deliveryProfile.latitude,
          lng: user.deliveryProfile.longitude,
          label: [user.deliveryProfile.address1, user.deliveryProfile.city].filter(Boolean).join(", "),
          source: "PROFILE" as const,
        }
      : latestOrder
        ? {
            address1: latestOrder.deliveryAddress1,
            address2: latestOrder.deliveryAddress2,
            city: latestOrder.city,
            state: latestOrder.state,
            lat: latestOrder.deliveryLat,
            lng: latestOrder.deliveryLng,
            label: [latestOrder.deliveryAddress1, latestOrder.city].filter(Boolean).join(", "),
            source: "LAST_ORDER" as const,
          }
        : null;

    return NextResponse.json({
      user,
      marketContext: {
        source: normalizedSource,
        serviceable: marketSelection.serviceable,
        selectedMarket: marketSelection.selectedMarket,
        nearestMarket: marketSelection.nearestMarket,
        outsideServiceArea: locationOutsideServiceArea,
        cartMarketCluster: cart?.marketCluster ?? null,
      },
      cartSummary: {
        itemCount: cart?._count.items ?? 0,
        marketClusterId: cart?.marketClusterId ?? null,
      },
      lastDeliveryLocation,
      discounts: activeDiscounts.slice(0, 3).map(serializeDiscount),
      categories,
      featuredProducts,
      mostOrderedProducts,
      orderSummary: {
        pendingPayment: pendingPaymentCount,
        processing: processingCount,
        outForDelivery: outForDeliveryCount,
        delivered: deliveredCount,
      },
      recentOrders,
    });
  } catch (error) {
    console.error("ME_DASHBOARD_ERROR", error);
    return NextResponse.json({ message: "Something went wrong" }, { status: 500 });
  }
}
