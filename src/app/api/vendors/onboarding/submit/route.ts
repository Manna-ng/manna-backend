import { NextResponse } from "next/server";
import { requireVendorRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import { jsonError } from "@/lib/vendors/http";
import { submitVendorForReview } from "@/lib/vendors/vendorOnboardingService";

export async function POST() {
  const authResult = await requireVendorRouteAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const result = await submitVendorForReview(authResult.auth.userId);

    if (!result.submitted) {
      return NextResponse.json(result, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
