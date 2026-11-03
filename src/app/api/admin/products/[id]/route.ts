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
import {
  notifyVendorProductModeration,
} from "@/lib/notifications/eventTriggers";

export async function GET(
  _req: NextRequest,
  ctx: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const admin =
    await requireAdmin();

  if (!admin.ok) {
    return admin.response;
  }

  const { id } =
    await ctx.params;

  const [
    product,
    media,
  ] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
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
        marketCluster: true,
      },
    }),
    prisma.mediaAsset.findMany({
      where: {
        productId: id,
        approvalStatus: {
          not: "DELETED",
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
  ]);

  if (!product) {
    return NextResponse.json(
      {
        message:
          "Product not found",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    product: {
      ...product,
      media,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const admin =
      await requireAdmin();

    if (!admin.ok) {
      return admin.response;
    }

    const { id } =
      await ctx.params;

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

    const existing =
      await prisma.product.findUnique({
        where: { id },
        select: {
          id: true,
          slug: true,
          vendorId: true,
          approvalStatus: true,
          isActive: true,
        },
      });

    if (!existing) {
      return NextResponse.json(
        {
          message:
            "Product not found",
        },
        { status: 404 }
      );
    }

    const updates:
      Record<string, unknown> = {};

    const stringFields = [
      "name",
      "description",
      "category",
      "subCategory",
      "imageUrl",
    ] as const;

    for (
      const field
      of stringFields
    ) {
      if (
        body[field] !==
        undefined
      ) {
        updates[field] =
          optionalString(
            body[field]
          );
      }
    }

    if (
      body.name !== undefined &&
      !updates.name
    ) {
      return NextResponse.json(
        {
          message:
            "name cannot be empty",
        },
        { status: 400 }
      );
    }

    if (
      body.category !==
        undefined &&
      !updates.category
    ) {
      return NextResponse.json(
        {
          message:
            "category cannot be empty",
        },
        { status: 400 }
      );
    }

    if (
      body.slug !== undefined
    ) {
      const slugValue =
        optionalString(
          body.slug
        );

      if (!slugValue) {
        return NextResponse.json(
          {
            message:
              "slug cannot be empty",
          },
          { status: 400 }
        );
      }

      const nextSlug =
        slugify(slugValue);

      const duplicate =
        await prisma.product.findFirst({
          where: {
            slug: nextSlug,
            id: {
              not: id,
            },
          },
          select: {
            id: true,
          },
        });

      if (duplicate) {
        return NextResponse.json(
          {
            message:
              "slug already exists",
          },
          { status: 409 }
        );
      }

      updates.slug =
        nextSlug;
    }

    if (
      body.isFeatured !==
      undefined
    ) {
      updates.isFeatured =
        Boolean(
          body.isFeatured
        );
    }

    let nextApprovalStatus =
      existing.approvalStatus;
    let moderationReason:
      | string
      | null =
        existing.approvalStatus ===
          "REJECTED"
          ? null
          : null;

    if (
      body.approvalStatus !==
      undefined
    ) {
      const candidate =
        String(
          body.approvalStatus
        );

      if (
        !isProductApprovalStatus(
          candidate
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

      nextApprovalStatus =
        candidate;

      moderationReason =
        optionalString(
          body.rejectedReason
        ) ??
        optionalString(
          body.reason
        );

      if (
        candidate ===
          "REJECTED" &&
        !moderationReason
      ) {
        return NextResponse.json(
          {
            message:
              "A rejection reason is required",
          },
          { status: 400 }
        );
      }

      updates.approvalStatus =
        candidate;

      if (
        candidate ===
        "APPROVED"
      ) {
        updates.rejectedReason =
          null;
        updates.isActive =
          body.isActive ===
          undefined
            ? true
            : Boolean(
                body.isActive
              );
      } else {
        updates.isActive =
          false;

        updates.rejectedReason =
          candidate ===
            "REJECTED" ||
          candidate ===
            "SUSPENDED"
            ? moderationReason
            : null;
      }
    } else if (
      body.isActive !==
      undefined
    ) {
      if (
        existing.approvalStatus !==
        "APPROVED"
      ) {
        return NextResponse.json(
          {
            message:
              "Only approved products can be activated",
          },
          { status: 409 }
        );
      }

      updates.isActive =
        Boolean(
          body.isActive
        );
    }

    if (
      Object.keys(
        updates
      ).length === 0
    ) {
      return NextResponse.json(
        {
          message:
            "No supported product updates were provided",
        },
        { status: 400 }
      );
    }

    const product =
      await prisma.product.update({
        where: { id },
        data:
          updates as never,
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
          marketCluster:
            true,
        },
      });

    if (
      body.approvalStatus !==
      undefined &&
      existing.vendorId
    ) {
      await notifyVendorProductModeration(
        id,
        nextApprovalStatus,
        moderationReason
      ).catch(
        () => undefined
      );
    }

    return NextResponse.json({
      product,
    });
  } catch (error) {
    console.error(
      "ADMIN_UPDATE_PRODUCT_ERROR",
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
