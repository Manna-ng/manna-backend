/*
  Warnings:

  - You are about to drop the column `ratingAverage` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `ratingCount` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `ratingAverage` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the column `ratingCount` on the `Vendor` table. All the data in the column will be lost.
  - You are about to drop the `ProductReview` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VendorReview` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ProductReview" DROP CONSTRAINT "ProductReview_orderId_fkey";

-- DropForeignKey
ALTER TABLE "ProductReview" DROP CONSTRAINT "ProductReview_orderItemId_fkey";

-- DropForeignKey
ALTER TABLE "ProductReview" DROP CONSTRAINT "ProductReview_productId_fkey";

-- DropForeignKey
ALTER TABLE "ProductReview" DROP CONSTRAINT "ProductReview_userId_fkey";

-- DropForeignKey
ALTER TABLE "VendorReview" DROP CONSTRAINT "VendorReview_orderId_fkey";

-- DropForeignKey
ALTER TABLE "VendorReview" DROP CONSTRAINT "VendorReview_userId_fkey";

-- DropForeignKey
ALTER TABLE "VendorReview" DROP CONSTRAINT "VendorReview_vendorId_fkey";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "ratingAverage",
DROP COLUMN "ratingCount";

-- AlterTable
ALTER TABLE "Vendor" DROP COLUMN "ratingAverage",
DROP COLUMN "ratingCount";

-- DropTable
DROP TABLE "ProductReview";

-- DropTable
DROP TABLE "VendorReview";

-- DropEnum
DROP TYPE "ReviewStatus";
