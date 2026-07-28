import { NextResponse, type NextRequest } from "next/server";
import { requireVendorRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import { jsonError } from "@/lib/vendors/http";
import {
  computeVendorOnboardingSummary,
  parseVendorApplicationPayload,
  startVendorApplication,
} from "@/lib/vendors/vendorOnboardingService";

export async function POST(req: NextRequest) {
  const authResult = await requireVendorRouteAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const input = parseVendorApplicationPayload(await req.json());
    const vendor = await startVendorApplication(authResult.auth.userId, input);

    if (!vendor) {
      return NextResponse.json({ error: "Vendor application could not be created" }, { status: 500 });
    }

    return NextResponse.json({
      vendor,
      onboarding: computeVendorOnboardingSummary(vendor),
    });
  } catch (error) {
    return jsonError(error);
  }
}
