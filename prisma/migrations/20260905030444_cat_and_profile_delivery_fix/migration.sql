/*
  Warnings:

  - You are about to drop the `CustomerDeliveryProfile` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CustomerDeliveryProfile" DROP CONSTRAINT "CustomerDeliveryProfile_userId_fkey";

-- DropTable
DROP TABLE "CustomerDeliveryProfile";
