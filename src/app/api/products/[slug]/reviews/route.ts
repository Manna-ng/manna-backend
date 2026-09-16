import { NextResponse, type NextRequest } from "next/server";

import { publicReviewerName } from "@/lib/marketplace/ratings";
import { prisma } from "@/lib/prisma";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

function readPositiveInt(value: string | null, fallback: number, max?: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await ctx.params;
    const page = readPositiveInt(req.nextUrl.searchParams.get("page"), 1);
    const pageSize = readPositiveInt(
      req.nextUrl.searchParams.get("pageSize"),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    );
    const ratingRaw = req.nextUrl.searchParams.get("rating");
    const rating = ratingRaw ? Number(ratingRaw) : null;
    const sort = req.nextUrl.searchParams.get("sort")?.toLowerCase() || "newest";

    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return NextResponse.json({ message: "rating must be an integer from 1 to 5" }, { status: 400 });
    }

    if (!["newest", "highest", "lowest"].includes(sort)) {
      return NextResponse.json(
        { message: "sort must be newest, highest, or lowest" },
        { status: 400 }
      );
    }

    const product = await prisma.product.findFirst({
      where: {
        slug,
        isActive: true,
        approvalStatus: "APPROVED",
        OR: [
          { vendorId: null },
          { vendor: { status: "APPROVED", isActive: true, isVisible: true } },
        ],
      },
      select: {
        id: true,
        ratingAverage: true,
        ratingCount: true,
      },
    });

    if (!product) {
      return NextResponse.json({ message: "Product not found" }, { status: 404 });
    }

    const where = {
      productId: product.id,
      status: "PUBLISHED" as const,
      ...(rating !== null ? { rating } : {}),
    };

    const orderBy =
      sort === "highest"
        ? [{ rating: "desc" as const }, { createdAt: "desc" as const }]
        : sort === "lowest"
          ? [{ rating: "asc" as const }, { createdAt: "desc" as const }]
          : [{ createdAt: "desc" as const }];

    const [total, reviews, breakdownRows] = await Promise.all([
      prisma.productReview.count({ where }),
      prisma.productReview.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: { name: true },
          },
        },
      }),
      prisma.productReview.groupBy({
        by: ["rating"],
        where: {
          productId: product.id,
          status: "PUBLISHED",
        },
        _count: { rating: true },
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    return NextResponse.json({
      summary: {
        average: product.ratingAverage,
        count: product.ratingCount,
        breakdown: Object.fromEntries(
          [1, 2, 3, 4, 5].map((star) => [
            star,
            breakdownRows.find((row) => row.rating === star)?._count.rating ?? 0,
          ])
        ),
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        reviewerName: publicReviewerName(review.user.name),
        verifiedPurchase: true,
      })),
    });
  } catch (error) {
    console.error("GET /api/products/[slug]/reviews error:", error);
    return NextResponse.json({ message: "Failed to fetch reviews" }, { status: 500 });
  }
}
