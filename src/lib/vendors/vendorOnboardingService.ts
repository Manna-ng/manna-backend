  import { prisma } from "@/lib/prisma";
import type { VendorStatus } from "@prisma/client";

  export type VendorApplicationInput = {
    displayName: string;
    legalName?: string;
    description?: string;
    email?: string;
    phone?: string;
    supportPhone?: string;
    businessRegistrationNumber?: string;
    marketClusterId: string;
  };

  export type VendorBusinessInput = {
    legalName?: string;
    description?: string;
    email?: string;
    phone?: string;
    supportPhone?: string;
    businessRegistrationNumber?: string;
    identityStatus?: string;
    businessStatus?: string;
    contactStatus?: string;
    productReviewStatus?: string;
    metadata?: Record<string, unknown>;
  };

  export type VendorBankInput = {
    bankName: string;
    bankCode?: string;
    accountNumber: string;
    accountName: string;
  };

  export type VendorPickupInput = {
    label?: string;
    address: string;
    latitude: number;
    longitude: number;
    contactName?: string;
    phone?: string;
  };

  export type VendorAgreementInput = {
    title?: string;
    version?: string;
    documentUrl?: string;
    acceptedIp?: string;
  };

  type JsonObject = Record<string, unknown>;

  type VendorWithRelations = {
    id: string;
    displayName: string;
    legalName: string | null;
    email: string | null;
    phone: string | null;
    supportPhone: string | null;
    businessRegistrationNumber: string | null;
    status: string;
    isActive: boolean;
    isVisible: boolean;
    marketClusterId: string;
    approvedAt: Date | null;
    rejectedAt: Date | null;
    suspendedAt: Date | null;
    adminNotes: string | null;
    verification?: {
      id: string;
      status: string;
      identityStatus: string;
      businessStatus: string;
      contactStatus: string;
      bankStatus: string;
      productReviewStatus: string;
      submittedAt: Date | null;
      reviewedAt: Date | null;
      reviewedByAdminId: string | null;
      rejectionReason: string | null;
      metadata: unknown;
    } | null;
    bankAccounts?: Array<{ id: string; verificationStatus: string; isDefault: boolean }>;
    pickupLocations?: Array<{ id: string; verificationStatus: string; isDefault: boolean; isActive: boolean }>;
    agreements?: Array<{ id: string; status: string; acceptedAt: Date | null }>;
  };

  const VENDOR_VERIFICATION_STATUSES = [
  "PENDING",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
] as const;

type VendorVerificationStatusValue =
  (typeof VENDOR_VERIFICATION_STATUSES)[number];

function optionalVendorVerificationStatus(
  value: unknown
): VendorVerificationStatusValue | undefined {
  if (typeof value !== "string") return undefined;

  return VENDOR_VERIFICATION_STATUSES.includes(
    value as VendorVerificationStatusValue
  )
    ? (value as VendorVerificationStatusValue)
    : undefined;
}

  function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${field} is required`);
    }
    return value.trim();
  }

  function optionalString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  function optionalJsonObject(value: unknown): JsonObject | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as JsonObject;
  }

  function slugify(value: string): string {
    const slug = value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

    return slug || `vendor-${Date.now()}`;
  }

  async function uniqueVendorSlug(displayName: string): Promise<string> {
    const base = slugify(displayName);
    let candidate = base;
    let suffix = 1;

    while (await prisma.vendor.findUnique({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }

    return candidate;
  }

  export function parseVendorApplicationPayload(payload: unknown): VendorApplicationInput {
    const body = optionalJsonObject(payload);
    if (!body) throw new Error("Invalid request body");

    return {
      displayName: requireString(body.displayName, "Business/store display name"),
      legalName: optionalString(body.legalName),
      description: optionalString(body.description),
      email: optionalString(body.email),
      phone: optionalString(body.phone),
      supportPhone: optionalString(body.supportPhone),
      businessRegistrationNumber: optionalString(body.businessRegistrationNumber),
      marketClusterId: requireString(body.marketClusterId, "Market cluster"),
    };
  }

  export function parseVendorBusinessPayload(payload: unknown): VendorBusinessInput {
    const body = optionalJsonObject(payload);
    if (!body) throw new Error("Invalid request body");

    return {
      legalName: optionalString(body.legalName),
      description: optionalString(body.description),
      email: optionalString(body.email),
      phone: optionalString(body.phone),
      supportPhone: optionalString(body.supportPhone),
      businessRegistrationNumber: optionalString(body.businessRegistrationNumber),
      identityStatus: optionalVendorVerificationStatus(body.identityStatus),
businessStatus: optionalVendorVerificationStatus(body.businessStatus),
contactStatus: optionalVendorVerificationStatus(body.contactStatus),
productReviewStatus: optionalVendorVerificationStatus(body.productReviewStatus),
      metadata: optionalJsonObject(body.metadata),
    };
  }

  export function parseVendorBankPayload(payload: unknown): VendorBankInput {
    const body = optionalJsonObject(payload);
    if (!body) throw new Error("Invalid request body");

    return {
      bankName: requireString(body.bankName, "Bank name"),
      bankCode: optionalString(body.bankCode),
      accountNumber: requireString(body.accountNumber, "Account number"),
      accountName: requireString(body.accountName, "Account name"),
    };
  }

  export function parseVendorPickupPayload(payload: unknown): VendorPickupInput {
    const body = optionalJsonObject(payload);
    if (!body) throw new Error("Invalid request body");

    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("Valid pickup latitude and longitude are required");
    }

    return {
      label: optionalString(body.label) ?? "Main pickup location",
      address: requireString(body.address, "Pickup address"),
      latitude,
      longitude,
      contactName: optionalString(body.contactName),
      phone: optionalString(body.phone),
    };
  }

  export function parseVendorAgreementPayload(payload: unknown): VendorAgreementInput {
    const body = optionalJsonObject(payload) ?? {};

    return {
      title: optionalString(body.title) ?? "Manna Vendor Agreement",
      version: optionalString(body.version) ?? "v1",
      documentUrl: optionalString(body.documentUrl),
      acceptedIp: optionalString(body.acceptedIp),
    };
  }

  export function computeVendorOnboardingSummary(vendor: VendorWithRelations) {
    const verification = vendor.verification;
    const hasBusinessProfile = Boolean(
      vendor.displayName &&
        vendor.marketClusterId &&
        (vendor.legalName || vendor.businessRegistrationNumber) &&
        (vendor.email || vendor.phone)
    );
    const hasBankAccount = Boolean(vendor.bankAccounts?.length);
    const hasPickupLocation = Boolean(vendor.pickupLocations?.some((item) => item.isActive));
    const hasAcceptedAgreement = Boolean(
      vendor.agreements?.some((item) => item.status === "ACCEPTED" && item.acceptedAt)
    );
    const verificationSubmitted = verification?.status === "SUBMITTED" || verification?.status === "APPROVED";

    const missingSteps: string[] = [];
    if (!hasBusinessProfile) missingSteps.push("BUSINESS_PROFILE");
    if (!hasBankAccount) missingSteps.push("BANK_ACCOUNT");
    if (!hasPickupLocation) missingSteps.push("PICKUP_LOCATION");
    if (!hasAcceptedAgreement) missingSteps.push("VENDOR_AGREEMENT");

    return {
      vendorId: vendor.id,
      status: vendor.status,
      isActive: vendor.isActive,
      isVisible: vendor.isVisible,
      canAccessVendorDashboard: vendor.status === "APPROVED" && vendor.isActive,
      canListProducts: vendor.status === "APPROVED" && vendor.isActive,
      canSubmitForReview: missingSteps.length === 0,
      verificationStatus: verification?.status ?? "PENDING",
      steps: {
        businessProfile: hasBusinessProfile,
        bankAccount: hasBankAccount,
        pickupLocation: hasPickupLocation,
        vendorAgreement: hasAcceptedAgreement,
        submittedForReview: verificationSubmitted,
        adminApproved: vendor.status === "APPROVED",
      },
      missingSteps,
      reviewedAt: verification?.reviewedAt ?? null,
      reviewedByAdminId: verification?.reviewedByAdminId ?? null,
      rejectionReason: verification?.rejectionReason ?? null,
    };
  }

  export async function getVendorForUser(userId: string) {
    const membership = await prisma.vendorUser.findFirst({
      where: { userId, isActive: true },
      include: {
        vendor: {
          include: {
            verification: true,
            bankAccounts: true,
            pickupLocations: true,
            agreements: true,
          },
        },
      },
    });

    return membership?.vendor ?? null;
  }

  export async function startVendorApplication(userId: string, input: VendorApplicationInput) {
    const existingVendor = await getVendorForUser(userId);

    if (existingVendor) {
      const vendor = await prisma.vendor.update({
        where: { id: existingVendor.id },
        data: {
          displayName: input.displayName,
          legalName: input.legalName,
          description: input.description,
          email: input.email,
          phone: input.phone,
          supportPhone: input.supportPhone,
          businessRegistrationNumber: input.businessRegistrationNumber,
          marketClusterId: input.marketClusterId,
          status: existingVendor.status === "REJECTED" ? "DRAFT" : existingVendor.status,
        },
        include: {
          verification: true,
          bankAccounts: true,
          pickupLocations: true,
          agreements: true,
        },
      });

      await ensureVendorVerification(vendor.id);
      return vendor;
    }

    const marketCluster = await prisma.marketCluster.findFirst({
      where: { id: input.marketClusterId, isActive: true },
      select: { id: true },
    });

    if (!marketCluster) {
      throw new Error("Selected market cluster is not available");
    }

    const slug = await uniqueVendorSlug(input.displayName);

    const vendor = await prisma.$transaction(async (tx) => {
      const createdVendor = await tx.vendor.create({
        data: {
          displayName: input.displayName,
          slug,
          legalName: input.legalName,
          description: input.description,
          email: input.email,
          phone: input.phone,
          supportPhone: input.supportPhone,
          businessRegistrationNumber: input.businessRegistrationNumber,
          marketClusterId: input.marketClusterId,
          status: "DRAFT",
          isActive: false,
          isVisible: false,
        },
      });

      await tx.vendorUser.create({
        data: {
          vendorId: createdVendor.id,
          userId,
          role: "OWNER",
          isActive: true,
        },
      });

      await tx.vendorVerification.create({
        data: {
          vendorId: createdVendor.id,
          status: "PENDING",
          identityStatus: "PENDING",
          businessStatus: "PENDING",
          contactStatus: "PENDING",
          bankStatus: "PENDING",
          productReviewStatus: "PENDING",
        },
      });

      return createdVendor;
    });

    return prisma.vendor.findUnique({
      where: { id: vendor.id },
      include: {
        verification: true,
        bankAccounts: true,
        pickupLocations: true,
        agreements: true,
      },
    });
  }

  export async function ensureVendorVerification(vendorId: string) {
    const existing = await prisma.vendorVerification.findUnique({ where: { vendorId } });
    if (existing) return existing;

    return prisma.vendorVerification.create({
      data: {
        vendorId,
        status: "PENDING",
        identityStatus: "PENDING",
        businessStatus: "PENDING",
        contactStatus: "PENDING",
        bankStatus: "PENDING",
        productReviewStatus: "PENDING",
      },
    });
  }

  export async function updateVendorBusinessProfile(userId: string, input: VendorBusinessInput) {
    const vendor = await getVendorForUser(userId);
    if (!vendor) throw new Error("Vendor application has not been started");

    const updated = await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        legalName: input.legalName,
        description: input.description,
        email: input.email,
        phone: input.phone,
        supportPhone: input.supportPhone,
        businessRegistrationNumber: input.businessRegistrationNumber,
        status: vendor.status === "REJECTED" ? "DRAFT" : vendor.status,
      },
    });

    await ensureVendorVerification(updated.id);

    // No-op update placeholder removed. Keep existing verification record as created by ensureVendorVerification.
    // If you need to update specific fields here, set them explicitly, e.g. { identityStatus: 'PENDING' }

    return getVendorForUser(userId);
  }

  export async function upsertVendorBankAccount(userId: string, input: VendorBankInput) {
    const vendor = await getVendorForUser(userId);
    if (!vendor) throw new Error("Vendor application has not been started");

    const existing = await prisma.vendorBankAccount.findFirst({
      where: { vendorId: vendor.id, isDefault: true },
    });

    if (existing) {
      await prisma.vendorBankAccount.update({
        where: { id: existing.id },
        data: {
          bankName: input.bankName,
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          accountName: input.accountName,
          verificationStatus: "SUBMITTED",
        },
      });
    } else {
      await prisma.vendorBankAccount.create({
        data: {
          vendorId: vendor.id,
          bankName: input.bankName,
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          accountName: input.accountName,
          isDefault: true,
          verificationStatus: "SUBMITTED",
        },
      });
    }

    await ensureVendorVerification(vendor.id);
    await prisma.vendorVerification.update({
      where: { vendorId: vendor.id },
      data: { bankStatus: "SUBMITTED" },
    });

    return getVendorForUser(userId);
  }

  export async function upsertVendorPickupLocation(userId: string, input: VendorPickupInput) {
    const vendor = await getVendorForUser(userId);
    if (!vendor) throw new Error("Vendor application has not been started");

    const existing = await prisma.vendorPickupLocation.findFirst({
      where: { vendorId: vendor.id, isDefault: true },
    });

    if (existing) {
      await prisma.vendorPickupLocation.update({
        where: { id: existing.id },
        data: {
          label: input.label ?? "Main pickup location",
          address: input.address,
          latitude: input.latitude,
          longitude: input.longitude,
          contactName: input.contactName,
          phone: input.phone,
          marketClusterId: vendor.marketClusterId,
          verificationStatus: "SUBMITTED",
          isActive: true,
        },
      });
    } else {
      await prisma.vendorPickupLocation.create({
        data: {
          vendorId: vendor.id,
          marketClusterId: vendor.marketClusterId,
          label: input.label ?? "Main pickup location",
          address: input.address,
          latitude: input.latitude,
          longitude: input.longitude,
          contactName: input.contactName,
          phone: input.phone,
          isDefault: true,
          isActive: true,
          verificationStatus: "SUBMITTED",
        },
      });
    }

    return getVendorForUser(userId);
  }

  export async function acceptVendorAgreement(userId: string, input: VendorAgreementInput) {
    const vendor = await getVendorForUser(userId);
    if (!vendor) throw new Error("Vendor application has not been started");

    const title = input.title ?? "Manna Vendor Agreement";
    const version = input.version ?? "v1";

    const existing = await prisma.vendorAgreement.findFirst({
      where: { vendorId: vendor.id, title, version },
    });

    if (existing) {
      await prisma.vendorAgreement.update({
        where: { id: existing.id },
        data: {
          documentUrl: input.documentUrl,
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedByUserId: userId,
          acceptedIp: input.acceptedIp,
        },
      });
    } else {
      await prisma.vendorAgreement.create({
        data: {
          vendorId: vendor.id,
          title,
          version,
          documentUrl: input.documentUrl,
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedByUserId: userId,
          acceptedIp: input.acceptedIp,
        },
      });
    }

    return getVendorForUser(userId);
  }

  export async function submitVendorForReview(userId: string) {
    const vendor = await getVendorForUser(userId);
    if (!vendor) throw new Error("Vendor application has not been started");

    const summary = computeVendorOnboardingSummary(vendor as VendorWithRelations);
    if (!summary.canSubmitForReview) {
      return { submitted: false, summary };
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.vendor.update({
        where: { id: vendor.id },
        data: {
          status: "UNDER_REVIEW",
          isActive: false,
          isVisible: false,
          rejectedAt: null,
        },
      });

      await tx.vendorVerification.update({
        where: { vendorId: vendor.id },
        data: {
          status: "SUBMITTED",
          submittedAt: new Date(),
          rejectionReason: null,
        },
      });

      return tx.vendor.findUnique({
        where: { id: vendor.id },
        include: {
          verification: true,
          bankAccounts: true,
          pickupLocations: true,
          agreements: true,
        },
      });
    });

    return {
      submitted: true,
      summary: computeVendorOnboardingSummary(updated as VendorWithRelations),
    };
  }

  export async function listVendorApplications(status?: string) {
    return prisma.vendor.findMany({
      where: status ? { status: status as VendorStatus } : {},
      include: {
        verification: true,
        bankAccounts: true,
        pickupLocations: true,
        agreements: true,
        marketCluster: {
          select: { id: true, name: true, city: true, state: true },
        },
        users: {
          select: { id: true, userId: true, role: true, isActive: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  export async function getVendorApplicationForAdmin(vendorId: string) {
    return prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        verification: true,
        bankAccounts: true,
        pickupLocations: true,
        agreements: true,
        marketCluster: {
          select: { id: true, name: true, city: true, state: true },
        },
        users: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true, role: true },
            },
          },
        },
      },
    });
  }

  export async function approveVendorApplication(vendorId: string, adminId: string, notes?: string) {
    const vendor = await getVendorApplicationForAdmin(vendorId);
    if (!vendor) throw new Error("Vendor application not found");

    const summary = computeVendorOnboardingSummary(vendor as VendorWithRelations);
    if (!summary.canSubmitForReview && vendor.status !== "UNDER_REVIEW") {
      throw new Error(`Vendor onboarding is incomplete: ${summary.missingSteps.join(", ")}`);
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.vendor.update({
        where: { id: vendorId },
        data: {
          status: "APPROVED",
          isActive: true,
          isVisible: true,
          approvedAt: now,
          rejectedAt: null,
          suspendedAt: null,
          adminNotes: notes,
        },
      });

      await tx.vendorVerification.update({
        where: { vendorId },
        data: {
          status: "APPROVED",
          identityStatus: "APPROVED",
          businessStatus: "APPROVED",
          contactStatus: "APPROVED",
          bankStatus: "APPROVED",
          productReviewStatus: "APPROVED",
          reviewedAt: now,
          reviewedByAdminId: adminId,
          rejectionReason: null,
        },
      });

      await tx.vendorBankAccount.updateMany({
        where: { vendorId },
        data: { verificationStatus: "APPROVED" },
      });

      await tx.vendorPickupLocation.updateMany({
        where: { vendorId },
        data: { verificationStatus: "APPROVED", verifiedAt: now },
      });
    });

    return getVendorApplicationForAdmin(vendorId);
  }

  export async function rejectVendorApplication(
    vendorId: string,
    adminId: string,
    reason: string,
    notes?: string
  ) {
    const vendor = await getVendorApplicationForAdmin(vendorId);
    if (!vendor) throw new Error("Vendor application not found");

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.vendor.update({
        where: { id: vendorId },
        data: {
          status: "REJECTED",
          isActive: false,
          isVisible: false,
          approvedAt: null,
          rejectedAt: now,
          adminNotes: notes,
        },
      });

      await tx.vendorVerification.update({
        where: { vendorId },
        data: {
          status: "REJECTED",
          reviewedAt: now,
          reviewedByAdminId: adminId,
          rejectionReason: reason,
        },
      });
    });

    return getVendorApplicationForAdmin(vendorId);
  }
