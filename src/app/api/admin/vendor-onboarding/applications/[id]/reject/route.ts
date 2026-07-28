import { NextResponse, type NextRequest } from "next/server";
import { requireAdminRouteAuth } from "@/lib/vendors/vendorOnboardingAuth";
import { jsonError } from "@/lib/vendors/http";
import {
  computeVendorOnboardingSummary,
  rejectVendorApplication,
} from "@/lib/vendors/vendorOnboardingService";

type RejectionPayload = {
  reason: string;
  notes?: string;
};

function parseBody(value: unknown): RejectionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Rejection reason is required");
  }

  const body = value as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!reason) {
    throw new Error("Rejection reason is required");
  }

  return {
    reason,
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
    const body = parseBody(await req.json());
    const application = await rejectVendorApplication(
      id,
      authResult.auth.adminId,
      body.reason,
      body.notes
    );

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
