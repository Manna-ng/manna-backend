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
        requiredStepsComplete: false,
        nextRequiredStep: "BUSINESS_PROFILE",
        locationReady: false,
        deliveryReady: false,
        visibilityReady: false,
        steps: {
          businessProfile: false,
          bankAccount: false,
          pickupLocation: false,
          vendorAgreement: false,
          submittedForReview: false,
          adminApproved: false,
        },
        missingSteps: ["BUSINESS_PROFILE", "BANK_ACCOUNT", "VENDOR_AGREEMENT"],
      },
    });
  }

  return NextResponse.json({ vendor, onboarding: computeVendorOnboardingSummary(vendor) });
}
