-- Marketplace ratings for verified product and vendor reviews.
-- Existing CustomerFeedback remains order/service feedback and is intentionally
-- not backfilled into these ratings because one order may contain multiple vendors.

CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

ALTER TABLE "Product"
  ADD COLUMN "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Vendor"
  ADD COLUMN "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProductReview" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE TABLE "VendorReview" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
  "vendorReply" TEXT,
  "vendorRepliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VendorReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "ProductReview_orderItemId_key"
  ON "ProductReview"("orderItemId");

CREATE INDEX "ProductReview_productId_status_idx"
  ON "ProductReview"("productId", "status");
CREATE INDEX "ProductReview_userId_idx"
  ON "ProductReview"("userId");
CREATE INDEX "ProductReview_orderId_idx"
  ON "ProductReview"("orderId");
CREATE INDEX "ProductReview_rating_idx"
  ON "ProductReview"("rating");
CREATE INDEX "ProductReview_createdAt_idx"
  ON "ProductReview"("createdAt");

CREATE UNIQUE INDEX "VendorReview_orderId_vendorId_key"
  ON "VendorReview"("orderId", "vendorId");

CREATE INDEX "VendorReview_vendorId_status_idx"
  ON "VendorReview"("vendorId", "status");
CREATE INDEX "VendorReview_userId_idx"
  ON "VendorReview"("userId");
CREATE INDEX "VendorReview_rating_idx"
  ON "VendorReview"("rating");
CREATE INDEX "VendorReview_createdAt_idx"
  ON "VendorReview"("createdAt");

ALTER TABLE "ProductReview"
  ADD CONSTRAINT "ProductReview_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductReview"
  ADD CONSTRAINT "ProductReview_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductReview"
  ADD CONSTRAINT "ProductReview_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductReview"
  ADD CONSTRAINT "ProductReview_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorReview"
  ADD CONSTRAINT "VendorReview_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorReview"
  ADD CONSTRAINT "VendorReview_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorReview"
  ADD CONSTRAINT "VendorReview_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
