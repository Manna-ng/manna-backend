-- MANNA_VENDOR_PICKUP_OPTIONAL_PRECISE_LOCATION_V1
-- Location is optional during vendor onboarding; precise coordinates become a later readiness requirement.
ALTER TABLE "VendorPickupLocation" ALTER COLUMN "latitude" DROP NOT NULL;
ALTER TABLE "VendorPickupLocation" ALTER COLUMN "longitude" DROP NOT NULL;
ALTER TABLE "VendorPickupLocation" ADD COLUMN IF NOT EXISTS "accuracy" DOUBLE PRECISION;
ALTER TABLE "VendorPickupLocation" ADD COLUMN IF NOT EXISTS "capturedAt" TIMESTAMP(3);