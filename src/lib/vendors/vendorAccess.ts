import { prisma } from "@/lib/prisma";

export async function requireApprovedVendorForUser(userId: string) {
  const membership = await prisma.vendorUser.findFirst({
    where: { userId, isActive: true },
    include: { vendor: true },
  });

  if (!membership?.vendor) {
    return { ok: false as const, error: "Vendor account not found", status: 404 };
  }

  const vendor = membership.vendor;

  if (vendor.status !== "APPROVED" || !vendor.isActive) {
    return {
      ok: false as const,
      error: "Vendor must be approved before listing products",
      status: 403,
      onboardingStatus: vendor.status,
    };
  }

  return { ok: true as const, vendor, membership };
}
