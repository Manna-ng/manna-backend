import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { isJsonObject, optionalString } from "@/lib/marketplace/json";
import {
  listVendorProductsWithMedia,
  loadVendorProductWithMedia,
  requireApprovedVendorSession,
} from "@/lib/vendors/vendorProductManagement";

async function uniqueSlug(name: string) {
  const base = slugify(name) || "product";
  let candidate = base;
  let suffix = 1;

  while (await prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

export async function GET() {
  try {
    const session = await requireApprovedVendorSession();
    if (session.ok === false) {
      return NextResponse.json(
        { message: session.message, onboardingStatus: session.onboardingStatus },
        { status: session.status }
      );
    }

    const products = await listVendorProductsWithMedia(session.vendor.id);
    return NextResponse.json({ products });
  } catch (error) {
    console.error("VENDOR_PRODUCTS_LIST_ERROR", error);
    return NextResponse.json({ message: "Unable to load vendor products" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireApprovedVendorSession();
    if (session.ok === false) {
      return NextResponse.json(
        { message: session.message, onboardingStatus: session.onboardingStatus },
        { status: session.status }
      );
    }

    const body: unknown = await req.json();
    if (!isJsonObject(body)) {
      return NextResponse.json({ message: "Request body must be a JSON object" }, { status: 400 });
    }

    const name = optionalString(body.name);
    const category = optionalString(body.category);
    if (!name || !category) {
      return NextResponse.json({ message: "name and category are required" }, { status: 400 });
    }

    const created = await prisma.product.create({
      data: {
        name,
        slug: await uniqueSlug(name),
        description: optionalString(body.description),
        category,
        subCategory: optionalString(body.subCategory),
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
        isFeatured: false,
        vendorId: session.vendor.id,
        marketClusterId: session.vendor.marketClusterId,
        approvalStatus: "PENDING_REVIEW",
      } as never,
    });

    const product = await loadVendorProductWithMedia(created.id);
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    console.error("VENDOR_PRODUCT_CREATE_ERROR", error);
    return NextResponse.json({ message: "Unable to create product" }, { status: 500 });
  }
}
