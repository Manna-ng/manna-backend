import {
  NextResponse,
} from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      code:
        "LEGACY_ADMIN_STATUS_DISABLED",
      message:
        "Direct order-status mutation is disabled. Fulfilment state must come from vendor/Kwik operational routes; paid cancellation requires the refund/dispute workflow.",
    },
    { status: 409 }
  );
}
