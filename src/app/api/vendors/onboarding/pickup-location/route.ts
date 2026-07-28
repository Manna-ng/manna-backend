import { NextResponse, type NextRequest } from "next/server";
import { requireVendorRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import { jsonError } from "@/lib/vendors/http";
import {
  computeVendorOnboardingSummary,
  parseVendorPickupPayload,
  upsertVendorPickupLocation,
} from "@/lib/vendors/vendorOnboardingService";

export async function PUT(req: NextRequest) {
  const authResult = await requireVendorRouteAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const input = parseVendorPickupPayload(await req.json());
    const vendor = await upsertVendorPickupLocation(authResult.auth.userId, input);

    if (!vendor) {
      return NextResponse.json({ error: "Vendor application not found" }, { status: 404 });
    }

    return NextResponse.json({
      vendor,
      onboarding: computeVendorOnboardingSummary(vendor),
    });
  } catch (error) {
    return jsonError(error);
  }
}
