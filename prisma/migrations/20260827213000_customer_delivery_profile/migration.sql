CREATE TABLE "CustomerDeliveryProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "deliveryNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDeliveryProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerDeliveryProfile_userId_key"
ON "CustomerDeliveryProfile"("userId");

CREATE INDEX "CustomerDeliveryProfile_city_state_idx"
ON "CustomerDeliveryProfile"("city", "state");

ALTER TABLE "CustomerDeliveryProfile"
ADD CONSTRAINT "CustomerDeliveryProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
