-- CreateEnum
CREATE TYPE "AuthOtpPurpose" AS ENUM ('SIGNUP', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "AuthOtpChallenge" (
    "id" TEXT NOT NULL,
    "purpose" "AuthOtpPurpose" NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "pendingName" TEXT,
    "pendingPhone" TEXT,
    "pendingPasswordHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "sendWindowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resendAvailableAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthOtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthOtpChallenge_email_idx" ON "AuthOtpChallenge"("email");

-- CreateIndex
CREATE INDEX "AuthOtpChallenge_pendingPhone_idx" ON "AuthOtpChallenge"("pendingPhone");

-- CreateIndex
CREATE INDEX "AuthOtpChallenge_expiresAt_idx" ON "AuthOtpChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthOtpChallenge_consumedAt_idx" ON "AuthOtpChallenge"("consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthOtpChallenge_purpose_email_key" ON "AuthOtpChallenge"("purpose", "email");
