import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { haversineDistanceKm } from "@/lib/marketplace/geo";
import { parseCoordinatesFromSearchParams } from "@/lib/marketplace/marketSelection";
import { publicReviewerName } from "@/lib/marketplace/ratings";
import { prisma } from "@/lib/prisma";
import {
  applyDiscountToPriceNgn,
  getActiveDiscounts,
  getBestActiveDiscountForProduct,
} from "@/services/discount.service";

const productSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  category: true,
  subCategory: true,
  imageUrl: true,
  isActive: true,
  approvalStatus: true,
  ratingAverage: true,
  ratingCount: true,
  createdAt: true,
  updatedAt: true,
  vendor: {
    select: {
      id: true,
      displayName: true,
      slug: true,
      description: true,
      logoUrl: true,
      coverImageUrl: true,
      status: true,
      isActive: true,
      isVisible: true,
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

type ProductDetail = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await ctx.params;
    const coordinateInput = parseCoordinatesFromSearchParams(req.nextUrl.searchParams);

    if (coordinateInput.error) {
      return NextResponse.json({ message: coordinateInput.error }, { status: 400 });
    }

    const [product, discounts] = await Promise.all([
      prisma.product.findUnique({
        where: { slug },
        select: productSelect,
      }),
      getActiveDiscounts(),
    ]);

    const vendorUnavailable =
      product?.vendor &&
      (product.vendor.status !== "APPROVED" ||
        !product.vendor.isActive ||
        !product.vendor.isVisible);

    if (
      !product ||
      !product.isActive ||
      product.approvalStatus !== "APPROVED" ||
      vendorUnavailable
    ) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }

    const [ratingBreakdownRows, reviewPreview, media] = await Promise.all([
      prisma.productReview.groupBy({
        by: ["rating"],
        where: {
          productId: product.id,
          status: "PUBLISHED",
        },
        _count: { rating: true },
      }),
      prisma.productReview.findMany({
        where: {
          productId: product.id,
          status: "PUBLISHED",
        },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          user: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.mediaAsset.findMany({
        where: {
          productId: product.id,
          approvalStatus: "APPROVED",
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          mediaType: true,
          purpose: true,
          contentType: true,
          publicUrl: true,
          originalFilename: true,
          sizeBytes: true,
          createdAt: true,
        },
      }),
    ]);

    const discount = getBestActiveDiscountForProduct(discounts, product.id);
    const mappedProduct: ProductDetail & Record<string, unknown> = {
      ...product,
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

    const distanceKm =
      coordinateInput.coordinates && product.marketCluster
        ? haversineDistanceKm(coordinateInput.coordinates, {
            lat: product.marketCluster.centerLat,
            lng: product.marketCluster.centerLng,
          })
        : null;

    const ratingBreakdown = Object.fromEntries(
      [1, 2, 3, 4, 5].map((rating) => [
        rating,
        ratingBreakdownRows.find((row) => row.rating === rating)?._count.rating ?? 0,
      ])
    );

    return NextResponse.json({
      discount: discount
        ? {
            id: discount.id,
            title: discount.title,
            description: discount.description,
            type: discount.type,
            percentageOff: discount.percentageOff,
            fixedAmountOff: discount.fixedAmountOff,
            startsAt: discount.startsAt,
            endsAt: discount.endsAt,
          }
        : null,
      product: {
        ...mappedProduct,
        rating: {
          average: product.ratingAverage,
          count: product.ratingCount,
          breakdown: ratingBreakdown,
        },
        seller: {
          name: product.vendor?.displayName ?? "Manna",
          vendorId: product.vendor?.id ?? null,
          vendorSlug: product.vendor?.slug ?? null,
          logoUrl: product.vendor?.logoUrl ?? null,
          description: product.vendor?.description ?? null,
          rating: {
            average: product.vendor?.ratingAverage ?? 0,
            count: product.vendor?.ratingCount ?? 0,
          },
        },
        market: product.marketCluster
          ? {
              ...product.marketCluster,
              distanceKm: distanceKm === null ? null : Number(distanceKm.toFixed(2)),
              isEligible:
                distanceKm === null
                  ? null
                  : distanceKm <= product.marketCluster.radiusKm,
            }
          : null,
        media,
        reviewPreview: reviewPreview.map((review) => ({
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt,
          reviewerName: publicReviewerName(review.user.name),
          verifiedPurchase: true,
        })),
      },
    });
  } catch (error) {
    console.error("GET /api/products/[slug] error:", error);
    return NextResponse.json({ message: "Failed to fetch product" }, { status: 500 });
  }
}
