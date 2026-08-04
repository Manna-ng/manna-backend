-- CreateEnum
CREATE TYPE "MediaStorageProvider" AS ENUM ('FIREBASE_STORAGE');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'FILE');

-- CreateEnum
CREATE TYPE "MediaOwnerType" AS ENUM ('PRODUCT', 'ORDER', 'VENDOR_ORDER', 'CUSTOMER_FEEDBACK', 'USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MediaApprovalStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'DELETED');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "storageProvider" "MediaStorageProvider" NOT NULL DEFAULT 'FIREBASE_STORAGE',
    "bucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "downloadToken" TEXT,
    "publicUrl" TEXT,
    "mediaType" "MediaType" NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
    "contentType" TEXT NOT NULL,
    "originalFilename" TEXT,
    "sizeBytes" INTEGER,
    "ownerType" "MediaOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "productId" TEXT,
    "vendorId" TEXT,
    "orderId" TEXT,
    "vendorOrderId" TEXT,
    "feedbackId" TEXT,
    "uploadedByUserId" TEXT,
    "approvalStatus" "MediaApprovalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "approvedAt" TIMESTAMP(3),
    "approvedByAdminId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOAuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storagePath_key" ON "MediaAsset"("storagePath");

-- CreateIndex
CREATE INDEX "MediaAsset_storageProvider_idx" ON "MediaAsset"("storageProvider");

-- CreateIndex
CREATE INDEX "MediaAsset_mediaType_idx" ON "MediaAsset"("mediaType");

-- CreateIndex
CREATE INDEX "MediaAsset_ownerType_ownerId_idx" ON "MediaAsset"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "MediaAsset_productId_idx" ON "MediaAsset"("productId");

-- CreateIndex
CREATE INDEX "MediaAsset_vendorId_idx" ON "MediaAsset"("vendorId");

-- CreateIndex
CREATE INDEX "MediaAsset_orderId_idx" ON "MediaAsset"("orderId");

-- CreateIndex
CREATE INDEX "MediaAsset_vendorOrderId_idx" ON "MediaAsset"("vendorOrderId");

-- CreateIndex
CREATE INDEX "MediaAsset_feedbackId_idx" ON "MediaAsset"("feedbackId");

-- CreateIndex
CREATE INDEX "MediaAsset_uploadedByUserId_idx" ON "MediaAsset"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "MediaAsset_approvalStatus_idx" ON "MediaAsset"("approvalStatus");

-- CreateIndex
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt");

-- CreateIndex
CREATE INDEX "CustomerOAuthAccount_userId_idx" ON "CustomerOAuthAccount"("userId");

-- CreateIndex
CREATE INDEX "CustomerOAuthAccount_provider_idx" ON "CustomerOAuthAccount"("provider");

-- CreateIndex
CREATE INDEX "CustomerOAuthAccount_email_idx" ON "CustomerOAuthAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOAuthAccount_provider_providerAccountId_key" ON "CustomerOAuthAccount"("provider", "providerAccountId");

-- AddForeignKey
ALTER TABLE "CustomerOAuthAccount" ADD CONSTRAINT "CustomerOAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
