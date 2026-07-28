import { NextResponse } from "next/server";
import { requireVendorRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import { computeVendorOnboardingSummary, getVendorForUser } from "@/lib/vendors/vendorOnboardingService";

export async function GET() {
  const authResult = await requireVendorRouteAuth();
  if (!authResult.ok) return authResult.response;

  const vendor = await getVendorForUser(authResult.auth.userId);

  if (!vendor) {
    return NextResponse.json({
      vendor: null,
      onboarding: {
        status: "NOT_STARTED",
        canAccessVendorDashboard: false,
        canListProducts: false,
        canSubmitForReview: false,
        missingSteps: ["INITIAL_APPLICATION"],
      },
    });
  }

  return NextResponse.json({
    vendor,
    onboarding: computeVendorOnboardingSummary(vendor),
  });
}
