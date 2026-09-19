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
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number | null;
    capturedAt?: Date | null;
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
    pickupLocations?: Array<{
      id: string;
      verificationStatus: string;
      isDefault: boolean;
      isActive: boolean;
      latitude?: number | null;
      longitude?: number | null;
      accuracy?: number | null;
      capturedAt?: Date | null;
    }>;
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

    const latitude = body.latitude === null || body.latitude === undefined || body.latitude === "" ? null : Number(body.latitude);
    const longitude = body.longitude === null || body.longitude === undefined || body.longitude === "" ? null : Number(body.longitude);
    const accuracy = body.accuracy === null || body.accuracy === undefined || body.accuracy === "" ? null : Number(body.accuracy);

    if ((latitude === null) !== (longitude === null)) throw new Error("Pickup latitude and longitude must be supplied together");
    if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) throw new Error("Valid pickup latitude is required");
    if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new Error("Valid pickup longitude is required");
    if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) throw new Error("Valid location accuracy is required");

    let capturedAt: Date | null = null;
    if (body.capturedAt !== null && body.capturedAt !== undefined && body.capturedAt !== "") {
      const parsed = new Date(String(body.capturedAt));
      if (Number.isNaN(parsed.getTime())) throw new Error("Valid location captured time is required");
      capturedAt = parsed;
    }
    if (latitude !== null && longitude !== null && !capturedAt) capturedAt = new Date();

    return {
      label: optionalString(body.label) ?? "Main pickup location",
      address: requireString(body.address, "Pickup address"),
      latitude,
      longitude,
      accuracy,
      capturedAt,
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

  function hasBusinessProfile(vendor: VendorWithRelations): boolean {
    return Boolean(vendor.displayName && vendor.marketClusterId && (vendor.legalName || vendor.businessRegistrationNumber) && (vendor.email || vendor.phone));
  }

  function hasBankAccount(vendor: VendorWithRelations): boolean {
    return Boolean(vendor.bankAccounts?.length);
  }

  function hasAcceptedAgreement(vendor: VendorWithRelations): boolean {
    return Boolean(vendor.agreements?.some((item) => item.status === "ACCEPTED" && item.acceptedAt));
  }

  function hasPrecisePickupLocation(vendor: VendorWithRelations): boolean {
    return Boolean(vendor.pickupLocations?.some((item) => item.isActive && typeof item.latitude === "number" && Number.isFinite(item.latitude) && typeof item.longitude === "number" && Number.isFinite(item.longitude) && item.capturedAt));
  }

  function assertBusinessComplete(vendor: VendorWithRelations) {
    if (!hasBusinessProfile(vendor)) throw new Error("Complete the business step before continuing");
  }

  function assertBankComplete(vendor: VendorWithRelations) {
    assertBusinessComplete(vendor);
    if (!hasBankAccount(vendor)) throw new Error("Complete the bank step before continuing");
  }

  export function computeVendorOnboardingSummary(vendor: VendorWithRelations) {
    const verification = vendor.verification;
    const rawBusiness = hasBusinessProfile(vendor);
    const rawBank = hasBankAccount(vendor);
    const rawAgreement = hasAcceptedAgreement(vendor);
    const businessProfile = rawBusiness;
    const bankAccount = businessProfile && rawBank;
    const vendorAgreement = bankAccount && rawAgreement;
    const verificationSubmitted = vendorAgreement && (verification?.status === "SUBMITTED" || verification?.status === "APPROVED");
    const adminApproved = verificationSubmitted && vendor.status === "APPROVED";
    const locationReady = hasPrecisePickupLocation(vendor);

    const missingSteps: string[] = [];
    if (!businessProfile) missingSteps.push("BUSINESS_PROFILE");
    if (!bankAccount) missingSteps.push("BANK_ACCOUNT");
    if (!vendorAgreement) missingSteps.push("VENDOR_AGREEMENT");

    const nextRequiredStep = !businessProfile ? "BUSINESS_PROFILE" : !bankAccount ? "BANK_ACCOUNT" : !vendorAgreement ? "VENDOR_AGREEMENT" : !verificationSubmitted ? "MANNA_REVIEW" : adminApproved ? "COMPLETE" : "MANNA_REVIEW";

    return {
      vendorId: vendor.id, status: vendor.status, isActive: vendor.isActive, isVisible: vendor.isVisible,
      canAccessVendorDashboard: vendor.status === "APPROVED" && vendor.isActive,
      canListProducts: vendor.status === "APPROVED" && vendor.isActive,
      canSubmitForReview: vendorAgreement && !verificationSubmitted,
      requiredStepsComplete: vendorAgreement,
      verificationStatus: verification?.status ?? "PENDING", nextRequiredStep, locationReady,
      deliveryReady: vendor.status === "APPROVED" && vendor.isActive && locationReady,
      visibilityReady: vendor.status === "APPROVED" && vendor.isActive && locationReady,
      steps: { businessProfile, bankAccount, pickupLocation: locationReady, vendorAgreement, submittedForReview: verificationSubmitted, adminApproved },
      missingSteps, reviewedAt: verification?.reviewedAt ?? null, reviewedByAdminId: verification?.reviewedByAdminId ?? null, rejectionReason: verification?.rejectionReason ?? null,
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
    assertBusinessComplete(vendor as VendorWithRelations);

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

    const existing = await prisma.vendorPickupLocation.findFirst({ where: { vendorId: vendor.id, isDefault: true } });
    const data = {
      label: input.label ?? "Main pickup location", address: input.address, latitude: input.latitude ?? null, longitude: input.longitude ?? null,
      accuracy: input.accuracy ?? null, capturedAt: input.capturedAt ?? null, contactName: input.contactName, phone: input.phone,
      marketClusterId: vendor.marketClusterId, verificationStatus: "SUBMITTED" as const, isActive: true,
    };
    if (existing) await prisma.vendorPickupLocation.update({ where: { id: existing.id }, data });
    else await prisma.vendorPickupLocation.create({ data: { vendorId: vendor.id, ...data, isDefault: true } });

    const refreshed = await getVendorForUser(userId);
    if (refreshed && refreshed.status === "APPROVED" && refreshed.isActive) {
      const locationReady = hasPrecisePickupLocation(refreshed as VendorWithRelations);
      if (refreshed.isVisible !== locationReady) await prisma.vendor.update({ where: { id: refreshed.id }, data: { isVisible: locationReady } });
    }
    return getVendorForUser(userId);
  }

  export async function acceptVendorAgreement(userId: string, input: VendorAgreementInput) {
    const vendor = await getVendorForUser(userId);
    if (!vendor) throw new Error("Vendor application has not been started");
    assertBankComplete(vendor as VendorWithRelations);

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
    if (!summary.requiredStepsComplete) {
      throw new Error(`Vendor onboarding is incomplete: ${summary.missingSteps.join(", ")}`);
    }
    if (!summary.steps.submittedForReview) {
      throw new Error("Vendor application must be submitted for Manna review before approval");
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.vendor.update({
        where: { id: vendorId },
        data: {
          status: "APPROVED",
          isActive: true,
          isVisible: hasPrecisePickupLocation(vendor as VendorWithRelations),
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
