import { NextResponse } from "next/server";
import { requireCustomerUser } from "@/lib/notifications/auth";
import { markAllNotificationsRead } from "@/lib/notifications/notificationService";

export async function POST() {
  try {
    const user = await requireCustomerUser();
    const result = await markAllNotificationsRead({ userId: user.id, role: "CUSTOMER" });
    return NextResponse.json({ message: "Notifications marked as read", data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to mark notifications as read";
    const status = message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ message }, { status });
  }
}
