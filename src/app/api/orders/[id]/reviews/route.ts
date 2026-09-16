import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import { refreshMarketplaceRatings } from "@/lib/marketplace/ratings";
import { requireCustomerUser } from "@/lib/notifications/auth";
import { prisma } from "@/lib/prisma";

type JsonObject = Record<string, unknown>;

type ProductReviewInput = {
  orderItemId: string;
  rating: number;
  comment: string | null;
};

type VendorReviewInput = {
  vendorId: string;
  rating: number;
  comment: string | null;
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanComment(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("COMMENT_INVALID");
  const comment = value.trim();
  if (comment.length > 1500) throw new Error("COMMENT_TOO_LONG");
  return comment || null;
}

function readRating(value: unknown) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("RATING_INVALID");
  }
  return rating;
}

function parseProductReviews(value: unknown): ProductReviewInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("PRODUCT_REVIEWS_INVALID");
  if (value.length > 50) throw new Error("TOO_MANY_REVIEWS");

  return value.map((row) => {
    if (!isJsonObject(row) || typeof row.orderItemId !== "string" || !row.orderItemId.trim()) {
      throw new Error("PRODUCT_REVIEWS_INVALID");
    }

    return {
      orderItemId: row.orderItemId.trim(),
      rating: readRating(row.rating),
      comment: cleanComment(row.comment),
    };
  });
}

function parseVendorReviews(value: unknown): VendorReviewInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("VENDOR_REVIEWS_INVALID");
  if (value.length > 20) throw new Error("TOO_MANY_REVIEWS");

  return value.map((row) => {
    if (!isJsonObject(row) || typeof row.vendorId !== "string" || !row.vendorId.trim()) {
      throw new Error("VENDOR_REVIEWS_INVALID");
    }

    return {
      vendorId: row.vendorId.trim(),
      rating: readRating(row.rating),
      comment: cleanComment(row.comment),
    };
  });
}

function badRequestMessage(error: unknown) {
  if (!(error instanceof Error)) return null;

  if (error.message === "RATING_INVALID") return "rating must be an integer from 1 to 5";
  if (error.message === "COMMENT_INVALID") return "comment must be text";
  if (error.message === "COMMENT_TOO_LONG") return "comment cannot exceed 1500 characters";
  if (error.message === "PRODUCT_REVIEWS_INVALID") return "productReviews is invalid";
  if (error.message === "VENDOR_REVIEWS_INVALID") return "vendorReviews is invalid";
  if (error.message === "TOO_MANY_REVIEWS") return "Too many reviews were submitted at once";
  return null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await ctx.params;
    const user = await requireCustomerUser();

    if (user.role !== "CUSTOMER") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      select: { id: true, status: true },
    });

    if (!order) {
      return NextResponse.json({ message: "Order not found" }, { status: 404 });
    }

    const [productReviews, vendorReviews] = await Promise.all([
      prisma.productReview.findMany({
        where: { orderId, userId: user.id },
        orderBy: { createdAt: "asc" },
      }),
      prisma.vendorReview.findMany({
        where: { orderId, userId: user.id },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return NextResponse.json({
      canReview: order.status === "DELIVERED",
      productReviews,
      vendorReviews,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load reviews";
    const status = message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ message }, { status });
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await ctx.params;
    const user = await requireCustomerUser();

    if (user.role !== "CUSTOMER") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!isJsonObject(body)) {
      return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
    }

    const productReviews = parseProductReviews(body.productReviews);
    const vendorReviews = parseVendorReviews(body.vendorReviews);

    if (productReviews.length === 0 && vendorReviews.length === 0) {
      return NextResponse.json(
        { message: "Submit at least one product or vendor review" },
        { status: 400 }
      );
    }

    const duplicateOrderItemIds = productReviews
      .map((review) => review.orderItemId)
      .filter((id, index, all) => all.indexOf(id) !== index);
    const duplicateVendorIds = vendorReviews
      .map((review) => review.vendorId)
      .filter((id, index, all) => all.indexOf(id) !== index);

    if (duplicateOrderItemIds.length > 0 || duplicateVendorIds.length > 0) {
      return NextResponse.json(
        { message: "Each product item and vendor can only appear once per request" },
        { status: 400 }
      );
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        items: {
          select: {
            id: true,
            productId: true,
            product: {
              select: {
                vendorId: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ message: "Order not found" }, { status: 404 });
    }

    if (order.status !== "DELIVERED" || order.paymentStatus !== "PAID") {
      return NextResponse.json(
        { message: "Marketplace reviews are only available after a paid order is delivered" },
        { status: 409 }
      );
    }

    const itemMap = new Map(order.items.map((item) => [item.id, item]));
    const vendorIdsInOrder = new Set(
      order.items
        .map((item) => item.product.vendorId)
        .filter((vendorId): vendorId is string => Boolean(vendorId))
    );

    for (const review of productReviews) {
      if (!itemMap.has(review.orderItemId)) {
        return NextResponse.json(
          { message: "A product review references an item that is not in this order" },
          { status: 400 }
        );
      }
    }

    for (const review of vendorReviews) {
      if (!vendorIdsInOrder.has(review.vendorId)) {
        return NextResponse.json(
          { message: "A vendor review references a vendor that is not in this order" },
          { status: 400 }
        );
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const affectedProductIds = new Set<string>();
        const affectedVendorIds = new Set<string>();

        const savedProductReviews = [];
        for (const review of productReviews) {
          const item = itemMap.get(review.orderItemId)!;
          affectedProductIds.add(item.productId);

          const saved = await tx.productReview.upsert({
            where: { orderItemId: item.id },
            update: {
              rating: review.rating,
              comment: review.comment,
            },
            create: {
              orderId: order.id,
              orderItemId: item.id,
              productId: item.productId,
              userId: user.id,
              rating: review.rating,
              comment: review.comment,
            },
          });

          savedProductReviews.push(saved);
        }

        const savedVendorReviews = [];
        for (const review of vendorReviews) {
          affectedVendorIds.add(review.vendorId);

          const saved = await tx.vendorReview.upsert({
            where: {
              orderId_vendorId: {
                orderId: order.id,
                vendorId: review.vendorId,
              },
            },
            update: {
              rating: review.rating,
              comment: review.comment,
            },
            create: {
              orderId: order.id,
              vendorId: review.vendorId,
              userId: user.id,
              rating: review.rating,
              comment: review.comment,
            },
          });

          savedVendorReviews.push(saved);
        }

        await refreshMarketplaceRatings(tx, {
          productIds: affectedProductIds,
          vendorIds: affectedVendorIds,
        });

        return {
          productReviews: savedProductReviews,
          vendorReviews: savedVendorReviews,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return NextResponse.json({
      message: "Reviews saved",
      ...result,
    });
  } catch (error) {
    const badRequest = badRequestMessage(error);
    if (badRequest) {
      return NextResponse.json({ message: badRequest }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unable to submit reviews";
    const status = message.includes("Unauthorized") ? 401 : 500;
    console.error("POST /api/orders/[id]/reviews error:", error);
    return NextResponse.json({ message }, { status });
  }
}
