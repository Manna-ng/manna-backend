-- AlterTable
ALTER TABLE "B2BLead" ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "orderFrequency" TEXT;

-- CreateIndex
CREATE INDEX "B2BLead_email_idx" ON "B2BLead"("email");

-- CreateIndex
CREATE INDEX "B2BLead_createdAt_idx" ON "B2BLead"("createdAt");
