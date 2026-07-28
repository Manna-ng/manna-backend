import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAuthToken, verifyAdminAuthToken } from "@/lib/auth";

type AuthPayload = {
  id?: string;
  userId?: string;
  sub?: string;
  role?: string;
};

export type VendorRouteAuth = {
  userId: string;
  role?: string;
};

export type AdminRouteAuth = {
  adminId: string;
  role?: string;
};

function getUserId(payload: AuthPayload | null): string | null {
  if (!payload) return null;
  return payload.userId ?? payload.id ?? payload.sub ?? null;
}

export async function requireVendorRouteAuth(): Promise<
  | { ok: true; auth: VendorRouteAuth }
  | { ok: false; response: NextResponse }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get("manna_token")?.value;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const payload = (await verifyAuthToken(token)) as AuthPayload | null;
  const userId = getUserId(payload);

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, auth: { userId, role: payload?.role } };
}

export async function requireAdminRouteAuth(): Promise<
  | { ok: true; auth: AdminRouteAuth }
  | { ok: false; response: NextResponse }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get("manna_admin_token")?.value;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const payload = (await verifyAdminAuthToken(token)) as AuthPayload | null;
  const adminId = getUserId(payload);

  if (!adminId || payload?.role !== "ADMIN") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, auth: { adminId, role: payload.role } };
}
