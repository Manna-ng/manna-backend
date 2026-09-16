import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("manna_token")?.value;

    if (!token) {
      return NextResponse.json({ totalItems: 0 }, { status: 200 });
    }

    const decoded = verifyAuthToken(token);
    if (!decoded?.userId || decoded.role !== "CUSTOMER") {
      return NextResponse.json({ totalItems: 0 }, { status: 200 });
    }

    const aggregate = await prisma.cartItem.aggregate({
      where: {
        cart: { userId: decoded.userId },
      },
      _sum: { quantity: true },
    });

    const totalItems = Math.max(0, aggregate._sum.quantity ?? 0);

    return NextResponse.json({ totalItems }, { status: 200 });
  } catch (error) {
    console.error("CART_COUNT_ERROR", error);
    // A navigation badge must never take down the customer UI.
    return NextResponse.json({ totalItems: 0 }, { status: 200 });
  }
}
