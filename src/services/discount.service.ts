import { prisma } from "@/lib/prisma";
import type { Discount } from "@prisma/client";

export async function getActiveDiscounts() {
  const now = new Date();

  return prisma.discount.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    // Latest campaign wins inside each priority class.
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Checks whether a discount applies to a given productId
 * based on the current schema: appliesToAll OR productIds(Json array).
 */
export function isDiscountEligibleForProduct(
  discount: Discount | null | undefined,
  productId: string
) {
  if (!discount) return false;
  if (discount.appliesToAll) return true;
  if (!discount.productIds) return false;

  const ids = discount.productIds as unknown as string[];
  return Array.isArray(ids) && ids.includes(productId);
}

/**
 * Product-specific discounts win over global discounts.
 * Within each class, the first item wins, so pass the array returned by
 * getActiveDiscounts() (already newest-first).
 */
export function getBestActiveDiscountForProduct(
  discounts: Discount[],
  productId: string
) {
  const productSpecific = discounts.find(
    (discount) =>
      !discount.appliesToAll &&
      isDiscountEligibleForProduct(discount, productId)
  );

  if (productSpecific) return productSpecific;

  return discounts.find((discount) => discount.appliesToAll) ?? null;
}

export async function getActiveDiscountForProduct(productId: string) {
  const discounts = await getActiveDiscounts();
  return getBestActiveDiscountForProduct(discounts, productId);
}

// Backward-compatible alias used by existing routes.
export const getActiveDiscountsForProduct = getActiveDiscountForProduct;

export function applyDiscountDetailed(amount: number, discount?: Discount | null) {
  if (!discount) {
    return { finalAmount: amount, discountAmount: 0 };
  }

  let off = 0;

  if (discount.type === "PERCENTAGE" && discount.percentageOff) {
    off = Math.floor((discount.percentageOff / 100) * amount);
  } else if (discount.type === "FIXED" && discount.fixedAmountOff) {
    off = discount.fixedAmountOff;
  }

  off = Math.max(0, off);
  const finalAmount = Math.max(amount - off, 0);

  return { finalAmount, discountAmount: Math.min(off, amount) };
}

export function applyDiscountToPriceNgn(
  priceNgn: number,
  discount?: Discount | null
) {
  return applyDiscountDetailed(priceNgn, discount).finalAmount;
}
