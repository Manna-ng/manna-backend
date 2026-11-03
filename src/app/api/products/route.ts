import { cookies } from "next/headers";
import { verifyAuthToken } from "@/lib/auth";
import {
  haversineDistanceKm,
  type Coordinates,
} from "@/lib/marketplace/geo";
import { Prisma, type Discount } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import {
  parseCoordinatesFromSearchParams,
  resolveMarketSelection,
} from "@/lib/marketplace/marketSelection";
import { prisma } from "@/lib/prisma";
import {
  applyDiscountToPriceNgn,
  getActiveDiscounts,
  getBestActiveDiscountForProduct,
} from "@/services/discount.service";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;

function readPositiveInt(value: string | null, fallback: number, max?: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function readOptionalNumber(value: string | null) {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: string | null) {
  if (value === null) return null;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  return null;
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

async function resolveCatalogCoordinates(
  explicitCoordinates: Coordinates | null
): Promise<{
  coordinates: Coordinates | null;
  source: "REQUEST" | "PROFILE" | "NONE";
}> {
  if (explicitCoordinates) {
    return {
      coordinates: explicitCoordinates,
      source: "REQUEST",
    };
  }

  try {
    const cookieStore = await cookies();
    const token =
      cookieStore.get("manna_token")?.value;

    const decoded = token
      ? verifyAuthToken(token)
      : null;

    if (
      !decoded?.userId ||
      decoded.role !== "CUSTOMER"
    ) {
      return {
        coordinates: null,
        source: "NONE",
      };
    }

    const profile =
      await prisma.customerDeliveryProfile.findUnique({
        where: {
          userId: decoded.userId,
        },
        select: {
          latitude: true,
          longitude: true,
        },
      });

    if (
      !profile ||
      profile.latitude === null ||
      profile.longitude === null ||
      !Number.isFinite(profile.latitude) ||
      !Number.isFinite(profile.longitude)
    ) {
      return {
        coordinates: null,
        source: "NONE",
      };
    }

    return {
      coordinates: {
        lat: profile.latitude,
        lng: profile.longitude,
      },
      source: "PROFILE",
    };
  } catch {
    return {
      coordinates: null,
      source: "NONE",
    };
  }
}

const proximityProductSelect = {
  id: true,
  vendor: {
    select: {
      pickupLocations: {
        where: {
          isActive: true,
          latitude: { not: null },
          longitude: { not: null },
          capturedAt: { not: null },
        },
        orderBy: [
          { isDefault: "desc" as const },
          { createdAt: "asc" as const },
        ],
        take: 1,
        select: {
          latitude: true,
          longitude: true,
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type ProximityProduct =
  Prisma.ProductGetPayload<{
    select: typeof proximityProductSelect;
  }>;

function productDistanceKm(
  product: ProximityProduct,
  coordinates: Coordinates
): number | null {
  const pickup =
    product.vendor?.pickupLocations[0];

  const latitude =
    pickup?.latitude ?? null;

  const longitude =
    pickup?.longitude ?? null;

  if (
    latitude === null ||
    longitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  return Number(
    haversineDistanceKm(
      coordinates,
      {
        lat: latitude,
        lng: longitude,
      }
    ).toFixed(2)
  );
}

function rankProductsByProximity(
  products: ProximityProduct[],
  coordinates: Coordinates
) {
  return products
    .map((product, index) => ({
      product,
      index,
      distanceKm:
        productDistanceKm(
          product,
          coordinates
        ),
    }))
    .sort((a, b) => {
      const aDistance =
        a.distanceKm ??
        Number.POSITIVE_INFINITY;

      const bDistance =
        b.distanceKm ??
        Number.POSITIVE_INFINITY;

      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }

      return a.index - b.index;
    });
}
const productSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
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
      centerLat: true,
      centerLng: true,
      radiusKm: true,
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

type CatalogProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

function serializeProduct(
  product: CatalogProduct,
  discounts: Discount[],
  distanceKm: number | null = null
) {
  const discount = getBestActiveDiscountForProduct(discounts, product.id);

  return {
    ...product,
    rating: {
      average: product.ratingAverage,
      count: product.ratingCount,
    },
    distanceKm,
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
    const searchParams = req.nextUrl.searchParams;
    const coordinateInput = parseCoordinatesFromSearchParams(searchParams);

    if (coordinateInput.error) {
      return NextResponse.json({ message: coordinateInput.error }, { status: 400 });
    }

    const catalogLocation =
      await resolveCatalogCoordinates(
        coordinateInput.coordinates
      );

    const rankingCoordinates =
      catalogLocation.coordinates;

    const requestedMarketClusterId = searchParams.get("marketClusterId")?.trim() || null;
    const marketSelection = await resolveMarketSelection({
      coordinates: rankingCoordinates,
      marketClusterId: requestedMarketClusterId,
      source: requestedMarketClusterId ? "EXPLICIT" : undefined,
    });

    if (requestedMarketClusterId && !marketSelection.selectedMarket) {
      return NextResponse.json({ message: "Market cluster not found or inactive" }, { status: 404 });
    }

    const outsideServiceArea =
      Boolean(rankingCoordinates) &&
      !requestedMarketClusterId &&
      marketSelection.serviceable === false;

    const q = searchParams.get("q")?.trim() || null;
    const category = searchParams.get("category")?.trim() || null;
    const subCategory = searchParams.get("subCategory")?.trim() || null;
    const vendorId = searchParams.get("vendorId")?.trim() || null;
    const minPrice = readOptionalNumber(searchParams.get("minPrice"));
    const maxPrice = readOptionalNumber(searchParams.get("maxPrice"));
    const minRating = readOptionalNumber(searchParams.get("minRating"));
    const availability = searchParams.get("availability")?.trim().toLowerCase() || null;
    const discounted = readBoolean(searchParams.get("discounted"));
    const sort = searchParams.get("sort")?.trim().toLowerCase() || "featured";
    const page = readPositiveInt(searchParams.get("page"), 1);
    const pageSize = readPositiveInt(
      searchParams.get("pageSize"),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    );

    if (minPrice !== null && minPrice < 0) {
      return NextResponse.json({ message: "minPrice cannot be negative" }, { status: 400 });
    }

    if (maxPrice !== null && maxPrice < 0) {
      return NextResponse.json({ message: "maxPrice cannot be negative" }, { status: 400 });
    }

    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      return NextResponse.json({ message: "minPrice cannot be greater than maxPrice" }, { status: 400 });
    }

    if (minRating !== null && (minRating < 1 || minRating > 5)) {
      return NextResponse.json({ message: "minRating must be between 1 and 5" }, { status: 400 });
    }

    if (availability && !["in_stock", "out_of_stock", "all"].includes(availability)) {
      return NextResponse.json(
        { message: "availability must be in_stock, out_of_stock, or all" },
        { status: 400 }
      );
    }

    const activeDiscounts = await getActiveDiscounts();
    const and: Prisma.ProductWhereInput[] = [
      {
        isActive: true,
        approvalStatus: "APPROVED",
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
      },
    ];

    if (
      requestedMarketClusterId &&
      marketSelection.selectedMarket?.id
    ) {
      and.push({
        marketClusterId:
          marketSelection.selectedMarket.id,
      });
    }

    if (q) {
      and.push({
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
          { subCategory: { contains: q, mode: "insensitive" } },
          { vendor: { displayName: { contains: q, mode: "insensitive" } } },
        ],
      });
    }

    if (category) and.push({ category: { equals: category, mode: "insensitive" } });
    if (subCategory) and.push({ subCategory: { equals: subCategory, mode: "insensitive" } });
    if (vendorId) and.push({ vendorId });

    if (minRating !== null) {
      and.push({ ratingCount: { gt: 0 }, ratingAverage: { gte: minRating } });
    }

    if (minPrice !== null || maxPrice !== null) {
      and.push({
        variants: {
          some: {
            priceNgn: {
              ...(minPrice !== null ? { gte: Math.floor(minPrice) } : {}),
              ...(maxPrice !== null ? { lte: Math.floor(maxPrice) } : {}),
            },
          },
        },
      });
    }

    if (availability === "in_stock") {
      and.push({
        variants: {
          some: {
            OR: [{ stockQty: null }, { stockQty: { gt: 0 } }],
          },
        },
      });
    } else if (availability === "out_of_stock") {
      and.push({
        AND: [
          { variants: { some: {} } },
          { variants: { every: { stockQty: 0 } } },
        ],
      });
    }

    if (discounted === true) {
      const hasGlobalDiscount = activeDiscounts.some((discount) => discount.appliesToAll);

      if (!hasGlobalDiscount) {
        const discountedProductIds = new Set<string>();
        for (const discount of activeDiscounts) {
          if (discount.appliesToAll || !Array.isArray(discount.productIds)) continue;
          for (const productId of discount.productIds as unknown as string[]) {
            if (typeof productId === "string") discountedProductIds.add(productId);
          }
        }

        and.push({ id: { in: [...discountedProductIds] } });
      }
    } else if (discounted === false) {
      const hasGlobalDiscount = activeDiscounts.some((discount) => discount.appliesToAll);

      if (hasGlobalDiscount) {
        // Every currently visible product receives a global discount.
        and.push({ id: { in: [] } });
      } else {
        const discountedProductIds = new Set<string>();
        for (const discount of activeDiscounts) {
          if (discount.appliesToAll || !Array.isArray(discount.productIds)) continue;
          for (const productId of discount.productIds as unknown as string[]) {
            if (typeof productId === "string") discountedProductIds.add(productId);
          }
        }

        if (discountedProductIds.size > 0) {
          and.push({ id: { notIn: [...discountedProductIds] } });
        }
      }
    }

    const where: Prisma.ProductWhereInput = { AND: and };

    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      sort === "rating"
        ? [{ ratingAverage: "desc" }, { ratingCount: "desc" }, { createdAt: "desc" }]
        : sort === "newest"
          ? [{ createdAt: "desc" }]
          : [{ isFeatured: "desc" }, { ratingAverage: "desc" }, { createdAt: "desc" }];

    const categoryBaseWhere: Prisma.ProductWhereInput = {
      isActive: true,
      approvalStatus: "APPROVED",
      ...(requestedMarketClusterId &&
      marketSelection.selectedMarket?.id
        ? {
            marketClusterId:
              marketSelection.selectedMarket.id,
          }
        : {}),
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


    const [total, categoryPairs] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where: categoryBaseWhere,
        select: { category: true, subCategory: true },
        distinct: ["category", "subCategory"],
      }),
    ]);

    const distanceByProductId =
      new Map<string, number | null>();

    let products: CatalogProduct[];

    if (rankingCoordinates) {
      const proximityCandidates =
        await prisma.product.findMany({
          where,
          orderBy,
          select: proximityProductSelect,
        });

      const ranked =
        rankProductsByProximity(
          proximityCandidates,
          rankingCoordinates
        );

      const pageStart =
        (page - 1) * pageSize;

      const pageEntries =
        ranked.slice(
          pageStart,
          pageStart + pageSize
        );

      const pageIds =
        pageEntries.map(
          (entry) => entry.product.id
        );

      for (const entry of pageEntries) {
        distanceByProductId.set(
          entry.product.id,
          entry.distanceKm
        );
      }

      const rows =
        pageIds.length > 0
          ? await prisma.product.findMany({
              where: {
                id: {
                  in: pageIds,
                },
              },
              select: productSelect,
            })
          : [];

      const rowsById =
        new Map(
          rows.map(
            (row) => [
              row.id,
              row,
            ])
        );

      products =
        pageIds
          .map(
            (id) => rowsById.get(id)
          )
          .filter(
            (
              row
            ): row is CatalogProduct =>
              Boolean(row)
          );
    } else {
      products =
        await prisma.product.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: productSelect,
        });
    }

    const categoryMap = new Map<string, Set<string>>();
    for (const row of categoryPairs) {
      const categoryName = row.category.trim();
      if (!categoryName) continue;
      if (!categoryMap.has(categoryName)) categoryMap.set(categoryName, new Set());
      const sub = row.subCategory?.trim();
      if (sub) categoryMap.get(categoryName)!.add(sub);
    }

    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    return NextResponse.json({
      marketContext: {
        serviceable: marketSelection.serviceable,
        selectedMarket: marketSelection.selectedMarket,
        nearestMarket: marketSelection.nearestMarket,
        outsideServiceArea,
        proximityApplied:
          Boolean(rankingCoordinates),
        proximitySource:
          catalogLocation.source,
      },
      filters: {
        categories: Array.from(categoryMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, subCategories]) => ({
            name,
            subCategories: Array.from(subCategories).sort((a, b) => a.localeCompare(b)),
          })),
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      products: products.map((product) =>
        serializeProduct(
          product,
          activeDiscounts,
          distanceByProductId.get(
            product.id
          ) ?? null
        )
      ),
    });
  } catch (error) {
    console.error("GET /api/products error:", error);
    return NextResponse.json({ message: "Failed to fetch products" }, { status: 500 });
  }
}
