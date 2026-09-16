import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type B2BLeadRequest = {
  businessName?: unknown;
  contactName?: unknown;
  contactPerson?: unknown;
  email?: unknown;
  phone?: unknown;
  businessType?: unknown;

  // Current frontend uses "volume".
  volume?: unknown;

  // Also support the cleaner API name.
  orderFrequency?: unknown;

  notes?: unknown;
  message?: unknown;

  // Honeypot.
  website?: unknown;
};

function cleanString(
  value: unknown,
  maxLength: number
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

export async function POST(req: NextRequest) {
  let body: B2BLeadRequest;

  try {
    body = (await req.json()) as B2BLeadRequest;
  } catch {
    return NextResponse.json(
      {
        message: "Invalid request body",
      },
      {
        status: 400,
      }
    );
  }

  /**
   * Honeypot.
   *
   * Real visitors never see/fill this field.
   * Silently accept bot submissions without storing them.
   */
  if (
    typeof body.website === "string" &&
    body.website.trim()
  ) {
    return NextResponse.json(
      {
        submitted: true,
        message:
          "Thanks. Your request has been received.",
      },
      {
        status: 201,
      }
    );
  }

  const businessName = cleanString(
    body.businessName,
    150
  );

  const contactPerson =
    cleanString(body.contactPerson, 150) ??
    cleanString(body.contactName, 150);

  const email = cleanString(body.email, 254)
    ?.toLowerCase();

  const phone = cleanString(body.phone, 40);

  const businessType = cleanString(
    body.businessType,
    100
  );

  const orderFrequency =
    cleanString(body.orderFrequency, 100) ??
    cleanString(body.volume, 100);

  const message =
    cleanString(body.message, 3000) ??
    cleanString(body.notes, 3000);

  if (!businessName) {
    return NextResponse.json(
      {
        message: "Business name is required",
      },
      {
        status: 400,
      }
    );
  }

  if (!contactPerson) {
    return NextResponse.json(
      {
        message: "Contact person is required",
      },
      {
        status: 400,
      }
    );
  }

  if (!phone) {
    return NextResponse.json(
      {
        message: "Phone number is required",
      },
      {
        status: 400,
      }
    );
  }

  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      {
        message:
          "Enter a valid business email address",
      },
      {
        status: 400,
      }
    );
  }

  if (!businessType) {
    return NextResponse.json(
      {
        message: "Business type is required",
      },
      {
        status: 400,
      }
    );
  }

  try {
    /**
     * Prevent accidental double-clicks/repeated submissions
     * from creating multiple identical leads immediately.
     */
    const duplicateWindow = new Date(
      Date.now() - 10 * 60 * 1000
    );

    const existingLead =
      await prisma.b2BLead.findFirst({
        where: {
          createdAt: {
            gte: duplicateWindow,
          },

          OR: [
            {
              email,
            },
            {
              phone,
            },
          ],
        },

        orderBy: {
          createdAt: "desc",
        },

        select: {
          id: true,
        },
      });

    if (existingLead) {
      return NextResponse.json({
        submitted: true,
        leadId: existingLead.id,
        message:
          "Thanks. Your request has already been received and our team will get back to you.",
      });
    }

    const lead = await prisma.b2BLead.create({
      data: {
        businessName,
        contactPerson,
        email,
        phone,
        businessType,
        orderFrequency,
        message,
      },
      select: {
        id: true,
      },
    });

    return NextResponse.json(
      {
        submitted: true,
        leadId: lead.id,
        message:
          "Thanks. Your business request has been received and our team will get back to you.",
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    console.error("CREATE_B2B_LEAD_ERROR", error);

    return NextResponse.json(
      {
        message:
          "We couldn’t submit your request right now. Please try again.",
      },
      {
        status: 500,
      }
    );
  }
}