import { NextResponse, type NextRequest } from "next/server";
import { requireAdminRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import { jsonError } from "@/lib/vendors/http";
import {
  approveVendorApplication,
  computeVendorOnboardingSummary,
} from "@/lib/vendors/vendorOnboardingService";

type ApprovalPayload = {
  notes?: string;
};

function parseBody(value: unknown): ApprovalPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const body = value as Record<string, unknown>;
  return {
    notes: typeof body.notes === "string" ? body.notes : undefined,
  };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminRouteAuth();
  if (!authResult.ok) return authResult.response;

  try {
    const { id } = await ctx.params;
    const body = parseBody(await req.json().catch(() => ({})));
    const application = await approveVendorApplication(id, authResult.auth.adminId, body.notes);

    if (!application) {
      return NextResponse.json({ error: "Vendor application not found" }, { status: 404 });
    }

    return NextResponse.json({
      application,
      onboarding: computeVendorOnboardingSummary(application),
    });
  } catch (error) {
    return jsonError(error);
  }
}
