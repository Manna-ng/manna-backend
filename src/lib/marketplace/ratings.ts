import type { Prisma } from "@prisma/client";

export async function refreshProductRating(
  tx: Prisma.TransactionClient,
  productId: string
) {
  const aggregate = await tx.productReview.aggregate({
    where: {
      productId,
      status: "PUBLISHED",
    },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await tx.product.update({
    where: { id: productId },
    data: {
      ratingAverage: aggregate._avg.rating ?? 0,
      ratingCount: aggregate._count.rating,
    },
  });
}

export async function refreshVendorRating(
  tx: Prisma.TransactionClient,
  vendorId: string
) {
  const aggregate = await tx.vendorReview.aggregate({
    where: {
      vendorId,
      status: "PUBLISHED",
    },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await tx.vendor.update({
    where: { id: vendorId },
    data: {
      ratingAverage: aggregate._avg.rating ?? 0,
      ratingCount: aggregate._count.rating,
    },
  });
}

export async function refreshMarketplaceRatings(
  tx: Prisma.TransactionClient,
  input: {
    productIds?: Iterable<string>;
    vendorIds?: Iterable<string>;
  }
) {
  const productIds = [...new Set(input.productIds ?? [])];
  const vendorIds = [...new Set(input.vendorIds ?? [])];

  for (const productId of productIds) {
    await refreshProductRating(tx, productId);
  }

  for (const vendorId of vendorIds) {
    await refreshVendorRating(tx, vendorId);
  }
}

export function publicReviewerName(name: string | null | undefined) {
  const firstName = name?.trim().split(/\s+/)[0];
  return firstName || "Verified customer";
}
