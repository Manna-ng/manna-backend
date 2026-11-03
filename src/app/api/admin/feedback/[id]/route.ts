import {
  NextResponse,
  type NextRequest,
} from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireAdmin,
} from "@/lib/auth/requireAdmin";
import {
  isJsonObject,
  optionalString,
} from "@/lib/marketplace/json";

const FEEDBACK_STATUSES =
  new Set([
    "NEW",
    "REVIEWING",
    "RESOLVED",
    "ESCALATED",
  ]);

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

  const feedback =
    await prisma.customerFeedback.findUnique({
      where: { id },
    });

  if (!feedback) {
    return NextResponse.json(
      {
        message:
          "Feedback not found",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    data: feedback,
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

  const updates:
    Record<string, unknown> = {};

  if (
    body.status !==
    undefined
  ) {
    const status =
      String(
        body.status
      ).trim();

    if (
      !FEEDBACK_STATUSES.has(
        status
      )
    ) {
      return NextResponse.json(
        {
          message:
            "Invalid feedback status",
        },
        { status: 400 }
      );
    }

    updates.status =
      status;

    if (
      status === "RESOLVED"
    ) {
      updates.resolvedAt =
        new Date();
      updates.resolvedBy =
        admin.adminId;
    } else {
      updates.resolvedAt =
        null;
      updates.resolvedBy =
        null;
    }
  }

  if (
    body.adminNote !==
    undefined
  ) {
    updates.adminNote =
      optionalString(
        body.adminNote
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
          "No supported feedback updates were provided",
      },
      { status: 400 }
    );
  }

  const exists =
    await prisma.customerFeedback.findUnique({
      where: { id },
      select: {
        id: true,
      },
    });

  if (!exists) {
    return NextResponse.json(
      {
        message:
          "Feedback not found",
      },
      { status: 404 }
    );
  }

  const feedback =
    await prisma.customerFeedback.update({
      where: { id },
      data:
        updates as never,
    });

  return NextResponse.json({
    data: feedback,
  });
}
