import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifyAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const DeliverySchema = z.object({
  address1: z.string().trim().min(3).max(180),
  address2: z.string().trim().max(180).nullable().optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  deliveryNote: z.string().trim().max(500).nullable().optional(),
});

const UpdateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  delivery: DeliverySchema,
});

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

function normalizePhone(value: string) {
  const input = value.trim();
  if (!input) return "";

  if (input.startsWith("+")) {
    const digits = input.slice(1).replace(/\D/g, "");
    return digits.length >= 7 ? `+${digits}` : "";
  }

  const digits = input.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("234") && digits.length >= 13) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+234${digits.slice(1)}`;
  if (digits.length === 10) return `+234${digits}`;

  return digits.length >= 7 ? `+${digits}` : "";
}

async function requireCustomerId() {
  const cookieStore = await cookies();
  const token = cookieStore.get("manna_token")?.value;
  if (!token) return null;

  const decoded = verifyAuthToken(token);
  if (!decoded?.userId || decoded.role !== "CUSTOMER") return null;
  return decoded.userId;
}

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  deliveryProfile: {
    select: {
      address1: true,
      address2: true,
      city: true,
      state: true,
      latitude: true,
      longitude: true,
      deliveryNote: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

export async function GET() {
  try {
    const userId = await requireCustomerId();
    if (!userId) return unauthorized();

    const user = await prisma.user.findFirst({
      where: { id: userId, role: "CUSTOMER" },
      select: profileSelect,
    });

    if (!user) return unauthorized();

    return NextResponse.json({
      user,
      deliveryProfileComplete: Boolean(
        user.phone &&
          user.deliveryProfile?.address1 &&
          user.deliveryProfile.city &&
          user.deliveryProfile.state &&
          Number.isFinite(user.deliveryProfile.latitude) &&
          Number.isFinite(user.deliveryProfile.longitude)
      ),
    });
  } catch (error) {
    console.error("ME_PROFILE_GET_ERROR", error);
    return NextResponse.json({ message: "Unable to load your profile" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireCustomerId();
    if (!userId) return unauthorized();

    const parsed = UpdateProfileSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues[0]?.message ?? "Invalid profile details" },
        { status: 400 }
      );
    }

    const phone = normalizePhone(parsed.data.phone);
    if (!phone) {
      return NextResponse.json({ message: "Enter a valid phone number" }, { status: 400 });
    }

    const duplicatePhone = await prisma.user.findFirst({
      where: { phone, id: { not: userId } },
      select: { id: true },
    });

    if (duplicatePhone) {
      return NextResponse.json(
        { message: "This phone number is already linked to another Manna account" },
        { status: 409 }
      );
    }

    const user = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { name: parsed.data.name, phone },
      });

      await tx.customerDeliveryProfile.upsert({
        where: { userId },
        create: {
          userId,
          address1: parsed.data.delivery.address1,
          address2: parsed.data.delivery.address2 || null,
          city: parsed.data.delivery.city,
          state: parsed.data.delivery.state,
          latitude: parsed.data.delivery.latitude,
          longitude: parsed.data.delivery.longitude,
          deliveryNote: parsed.data.delivery.deliveryNote || null,
        },
        update: {
          address1: parsed.data.delivery.address1,
          address2: parsed.data.delivery.address2 || null,
          city: parsed.data.delivery.city,
          state: parsed.data.delivery.state,
          latitude: parsed.data.delivery.latitude,
          longitude: parsed.data.delivery.longitude,
          deliveryNote: parsed.data.delivery.deliveryNote || null,
        },
      });

      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: profileSelect });
    });

    return NextResponse.json({
      message: "Profile updated",
      user,
      deliveryProfileComplete: true,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { message: "This phone number is already linked to another Manna account" },
        { status: 409 }
      );
    }

    console.error("ME_PROFILE_PATCH_ERROR", error);
    return NextResponse.json({ message: "Unable to update your profile" }, { status: 500 });
  }
}
