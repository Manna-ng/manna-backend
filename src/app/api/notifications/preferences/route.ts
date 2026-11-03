import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeRole,
  requireAdminUser,
  requireCustomerUser,
  requireVendorContext,
} from "@/lib/notifications/auth";
import {
  getOrCreateNotificationPreferences,
  updateNotificationPreference,
} from "@/lib/notifications/notificationService";
import type {
  NotificationCategory,
  NotificationRole,
} from "@/lib/notifications/types";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean"
    ? value
    : undefined;
}

function isNotificationCategory(
  value: string
): value is NotificationCategory {
  return [
    "ORDER",
    "DELIVERY",
    "PAYMENT",
    "VENDOR",
    "SETTLEMENT",
    "FEEDBACK",
    "SECURITY",
    "SYSTEM",
    "MARKETING",
    "INVENTORY",
  ].includes(value as NotificationCategory);
}
async function resolvePreferenceIdentity(
  role: NotificationRole,
  vendorId: string | null
): Promise<{
  userId: string;
  role: NotificationRole;
  vendorId: string | null;
}> {
  if (role === "ADMIN") {
    const admin = await requireAdminUser();

    return {
      userId: admin.id,
      role: "ADMIN",
      vendorId: null,
    };
  }

  if (role === "VENDOR") {
    const vendorContext =
      await requireVendorContext(vendorId);

    return {
      userId: vendorContext.user.id,
      role: "VENDOR",
      vendorId: vendorContext.vendorId,
    };
  }

  const customer =
    await requireCustomerUser();

  return {
    userId: customer.id,
    role: "CUSTOMER",
    vendorId: null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const role = normalizeRole(
      url.searchParams.get("role")
    );
    const vendorId =
      url.searchParams.get("vendorId");

    const identity =
      await resolvePreferenceIdentity(
        role,
        vendorId
      );

    const preferences =
      await getOrCreateNotificationPreferences({
        userId: identity.userId,
        role: identity.role,
        vendorId: identity.vendorId,
      });

    return NextResponse.json({
      data: preferences,
      role: identity.role,
      vendorId: identity.vendorId,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load preferences";

    const status =
      message.includes("Unauthorized") ||
      message.includes("denied")
        ? 401
        : 500;

    return NextResponse.json(
      { message },
      { status }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!isJsonObject(body)) {
      return NextResponse.json(
        { message: "Invalid request body" },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const role = normalizeRole(
      body.role ??
        url.searchParams.get("role")
    );
    const vendorId =
      readString(body.vendorId) ??
      url.searchParams.get("vendorId");
    const category =
      readString(body.category);

    if (!category || !isNotificationCategory(category)) {
      return NextResponse.json(
        { message: "A valid notification category is required" },
        { status: 400 }
      );
    }

    const identity =
      await resolvePreferenceIdentity(
        role,
        vendorId
      );

    const preference =
      await updateNotificationPreference({
        userId: identity.userId,
        role: identity.role,
        vendorId: identity.vendorId,
        category,
        inAppEnabled:
          readBoolean(body.inAppEnabled),
        pushEnabled:
          readBoolean(body.pushEnabled),
        emailEnabled:
          readBoolean(body.emailEnabled),
        smsEnabled:
          readBoolean(body.smsEnabled),
      });

    return NextResponse.json({
      data: preference,
      role: identity.role,
      vendorId: identity.vendorId,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to update preference";

    const status =
      message.includes("Unauthorized") ||
      message.includes("denied")
        ? 401
        : 500;

    return NextResponse.json(
      { message },
      { status }
    );
  }
}