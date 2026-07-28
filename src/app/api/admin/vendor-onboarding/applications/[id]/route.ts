import { NextResponse, type NextRequest } from "next/server";
import { requireAdminRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import {
  computeVendorOnboardingSummary,
  getVendorApplicationForAdmin,
} from "@/lib/vendors/vendorOnboardingService";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminRouteAuth();
  if (!authResult.ok) return authResult.response;

  const { id } = await ctx.params;
  const application = await getVendorApplicationForAdmin(id);

  if (!application) {
    return NextResponse.json({ error: "Vendor application not found" }, { status: 404 });
  }

  return NextResponse.json({
    application,
    onboarding: computeVendorOnboardingSummary(application),
  });
}
