import {
  NextResponse,
  type NextRequest,
} from "next/server";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";
import {
  isProductApprovalStatus,
} from "@/lib/marketplace/constants";
import {
  isJsonObject,
  optionalString,
} from "@/lib/marketplace/json";

type VendorProductContext = {
  id: string;
  marketClusterId: string;
};

export async function GET(
  req: NextRequest
) {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const approvalStatus =
    req.nextUrl.searchParams.get(
      "approvalStatus"
    );
  const vendorId =
    req.nextUrl.searchParams.get(
      "vendorId"
    );
  const query =
    req.nextUrl.searchParams.get(
      "q"
    )?.trim();

  const where:
    Record<string, unknown> = {};

  if (approvalStatus) {
    if (
      !isProductApprovalStatus(
        approvalStatus
      )
    ) {
      return NextResponse.json(
        {
          message:
            "Invalid product approval status",
        },
        { status: 400 }
      );
    }

    where.approvalStatus =
      approvalStatus;
  }

  if (vendorId) {
    where.vendorId = vendorId;
  }

  if (query) {
    where.OR = [
      {
        name: {
          contains: query,
          mode: "insensitive",
        },
      },
      {
        category: {
          contains: query,
          mode: "insensitive",
        },
      },
      {
        vendor: {
          is: {
            displayName: {
              contains: query,
              mode: "insensitive",
            },
          },
        },
      },
    ];
  }

  const products =
    await prisma.product.findMany({
      where:
        where as never,
      orderBy: [
        {
          createdAt: "desc",
        },
      ],
      include: {
        variants: true,
        vendor: {
          select: {
            id: true,
            displayName: true,
            slug: true,
            status: true,
          },
        },
        marketCluster: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

  return NextResponse.json({
    products,
  });
}

export async function POST(
  req: NextRequest
) {
  try {
    const admin =
      await requireAdmin();

    if (!admin.ok) {
      return admin.response;
    }

    const body: unknown =
      await req.json();

    if (!isJsonObject(body)) {
      return NextResponse.json(
        {
          message:
            "Request body must be a JSON object",
        },
        { status: 400 }
      );
    }

    const name =
      optionalString(body.name);
    const category =
      optionalString(
        body.category
      );
    const vendorId =
      optionalString(
        body.vendorId
      );
    let marketClusterId =
      optionalString(
        body.marketClusterId
      );
    const approvalStatus =
      optionalString(
        body.approvalStatus
      ) ?? "APPROVED";

    if (!name || !category) {
      return NextResponse.json(
        {
          message:
            "name and category are required",
        },
        { status: 400 }
      );
    }

    if (
      !isProductApprovalStatus(
        approvalStatus
      )
    ) {
      return NextResponse.json(
        {
          message:
            "Invalid product approval status",
        },
        { status: 400 }
      );
    }

    if (vendorId) {
      const vendor =
        (await prisma.vendor.findUnique({
          where: {
            id: vendorId,
          },
          select: {
            id: true,
            marketClusterId:
              true,
          },
        })) as
          | VendorProductContext
          | null;

      if (!vendor) {
        return NextResponse.json(
          {
            message:
              "Vendor not found",
          },
          { status: 404 }
        );
      }

      marketClusterId =
        vendor.marketClusterId;
    }

    if (marketClusterId) {
      const cluster =
        await prisma.marketCluster.findUnique({
          where: {
            id: marketClusterId,
          },
          select: {
            id: true,
          },
        });

      if (!cluster) {
        return NextResponse.json(
          {
            message:
              "Market cluster not found",
          },
          { status: 404 }
        );
      }
    }

    const finalSlug =
      optionalString(body.slug)
        ? slugify(
            String(body.slug)
          )
        : slugify(name);

    const exists =
      await prisma.product.findUnique({
        where: {
          slug: finalSlug,
        },
        select: {
          id: true,
        },
      });

    if (exists) {
      return NextResponse.json(
        {
          message:
            "slug already exists, choose a different one",
        },
        { status: 409 }
      );
    }

    const product =
      await prisma.product.create({
        data: {
          name,
          slug: finalSlug,
          description:
            optionalString(
              body.description
            ),
          category,
          subCategory:
            optionalString(
              body.subCategory
            ),
          imageUrl:
            optionalString(
              body.imageUrl
            ),
          isActive:
            approvalStatus ===
            "APPROVED"
              ? Boolean(
                  body.isActive ??
                    true
                )
              : false,
          isFeatured:
            Boolean(
              body.isFeatured ??
                false
            ),
          vendorId,
          marketClusterId,
          approvalStatus,
          rejectedReason:
            approvalStatus ===
              "REJECTED"
              ? optionalString(
                  body.rejectedReason
                )
              : null,
        } as never,
        include: {
          variants: true,
          vendor: {
            select: {
              id: true,
              displayName: true,
              slug: true,
            },
          },
          marketCluster:
            true,
        },
      });

    return NextResponse.json(
      {
        product,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error(
      "ADMIN_CREATE_PRODUCT_ERROR",
      error
    );

    return NextResponse.json(
      {
        message:
          "Something went wrong",
      },
      { status: 500 }
    );
  }
}
