import { NextResponse, type NextRequest } from "next/server";
import { requireVendorRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import { jsonError } from "@/lib/vendors/http";
import {
  acceptVendorAgreement,
  computeVendorOnboardingSummary,
  parseVendorAgreementPayload,
} from "@/lib/vendors/vendorOnboardingService";

export async function POST(req: NextRequest) {
  const authResult = await requireVendorRouteAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json().catch(() => ({}));
    const input = parseVendorAgreementPayload(body);
    const vendor = await acceptVendorAgreement(authResult.auth.userId, input);

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
