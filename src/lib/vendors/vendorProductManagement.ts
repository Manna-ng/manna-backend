import { cookies } from "next/headers";
import { verifyAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireApprovedVendorForUser } from "@/lib/vendors/vendorAccess";

type AuthToken = { userId?: string };

export async function requireApprovedVendorSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("manna_token")?.value;
  const decoded = token ? (verifyAuthToken(token) as AuthToken | null) : null;

  if (!decoded?.userId) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }

  const access = await requireApprovedVendorForUser(decoded.userId);
  if (access.ok === false) {
    return {
      ok: false as const,
      status: access.status,
      message: access.error,
      onboardingStatus: "onboardingStatus" in access ? access.onboardingStatus : undefined,
    };
  }

  return {
    ok: true as const,
    userId: decoded.userId,
    vendor: access.vendor,
    membership: access.membership,
  };
}

export async function requireOwnedVendorProduct(productId: string) {
  const session = await requireApprovedVendorSession();
  if (session.ok === false) return session;

  const product = await prisma.product.findFirst({
    where: { id: productId, vendorId: session.vendor.id },
    include: { variants: true },
  });

  if (!product) {
    return { ok: false as const, status: 404, message: "Product not found" };
  }

  return {
    ok: true as const,
    userId: session.userId,
    vendor: session.vendor,
    membership: session.membership,
    product,
  };
}

export async function loadVendorProductWithMedia(productId: string) {
  const [product, media] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    }),
    prisma.mediaAsset.findMany({
      where: { productId, approvalStatus: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        productId: true,
        publicUrl: true,
        mediaType: true,
        purpose: true,
        approvalStatus: true,
        createdAt: true,
      },
    }),
  ]);

  return product ? { ...product, media } : null;
}

export async function listVendorProductsWithMedia(vendorId: string) {
  const [products, media] = await Promise.all([
    prisma.product.findMany({
      where: { vendorId },
      orderBy: { updatedAt: "desc" },
      include: { variants: true },
    }),
    prisma.mediaAsset.findMany({
      where: { vendorId, productId: { not: null }, approvalStatus: { not: "DELETED" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        productId: true,
        publicUrl: true,
        mediaType: true,
        purpose: true,
        approvalStatus: true,
        createdAt: true,
      },
    }),
  ]);

  const mediaByProduct = new Map<string, typeof media>();
  for (const item of media) {
    if (!item.productId) continue;
    const list = mediaByProduct.get(item.productId) ?? [];
    list.push(item);
    mediaByProduct.set(item.productId, list);
  }

  return products.map((product) => ({
    ...product,
    media: mediaByProduct.get(product.id) ?? [],
  }));
}
