import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeRole,
  requireAdminUser,
  requireCustomerUser,
  requireVendorContext,
} from "@/lib/notifications/auth";
import {
  registerPushDeviceToken,
  revokePushDeviceToken,
} from "@/lib/notifications/notificationService";
import type {
  NotificationRole,
  PushPlatform,
} from "@/lib/notifications/types";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPushPlatform(value: unknown): value is PushPlatform {
  return value === "WEB" || value === "ANDROID" || value === "IOS";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function resolveNotificationIdentity(
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
    const vendorContext = await requireVendorContext(vendorId);
    return {
      userId: vendorContext.user.id,
      role: "VENDOR",
      vendorId: vendorContext.vendorId,
    };
  }

  const customer = await requireCustomerUser();
  return {
    userId: customer.id,
    role: "CUSTOMER",
    vendorId: null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!isJsonObject(body)) {
      return NextResponse.json(
        { message: "Invalid request body" },
        { status: 400 }
      );
    }

    const token = readString(body.token);
    const platform = isPushPlatform(body.platform)
      ? body.platform
      : null;
    const requestedRole = normalizeRole(body.role);
    const vendorIdFromBody = readString(body.vendorId);

    if (!token || !platform) {
      return NextResponse.json(
        { message: "token and platform are required" },
        { status: 400 }
      );
    }

    const identity = await resolveNotificationIdentity(
      requestedRole,
      vendorIdFromBody
    );

    await registerPushDeviceToken({
      userId: identity.userId,
      role: identity.role,
      vendorId: identity.vendorId,
      token,
      platform,
      deviceId: readString(body.deviceId),
      appVersion: readString(body.appVersion),
      userAgent: req.headers.get("user-agent"),
    });

    return NextResponse.json({
      message: "Device token registered",
      role: identity.role,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to register device token";

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

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!isJsonObject(body)) {
      return NextResponse.json(
        { message: "Invalid request body" },
        { status: 400 }
      );
    }

    const token = readString(body.token);
    const requestedRole = normalizeRole(body.role);
    const vendorIdFromBody = readString(body.vendorId);

    if (!token) {
      return NextResponse.json(
        { message: "token is required" },
        { status: 400 }
      );
    }

    const identity = await resolveNotificationIdentity(
      requestedRole,
      vendorIdFromBody
    );

    await revokePushDeviceToken(
      token,
      identity.userId
    );

    return NextResponse.json({
      message: "Device token revoked",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to revoke device token";

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