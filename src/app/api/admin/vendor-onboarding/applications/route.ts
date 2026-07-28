import { NextResponse, type NextRequest } from "next/server";
import { requireAdminRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import { listVendorApplications } from "@/lib/vendors/vendorOnboardingService";

export async function GET(req: NextRequest) {
  const authResult = await requireAdminRouteAuth();
  if (!authResult.ok) return authResult.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const applications = await listVendorApplications(status);

  return NextResponse.json({ applications });
}
