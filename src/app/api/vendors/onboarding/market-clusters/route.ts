import { NextResponse } from "next/server";
import { requireVendorRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const authResult = await requireVendorRouteAuth();
  if (!authResult.ok) return authResult.response;

  const clusters = await prisma.marketCluster.findMany({
    where: { isActive: true },
    orderBy: [{ state: "asc" }, { city: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      state: true,
      centerAddress: true,
    },
  });

  return NextResponse.json({ clusters });
}
