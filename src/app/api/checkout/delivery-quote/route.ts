import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/auth";
import { quoteKwikMarketplaceDelivery } from "@/lib/kwik/quoteService";
import {
  KwikVehicleSelectionError,
  selectKwikVehicleForWeight,
} from "@/lib/kwik/vehicleService";
import type { VendorPickupInput } from "@/lib/kwik/payloadBuilder";
import { prisma } from "@/lib/prisma";
import { optimizePickupOrder } from "@/lib/delivery/routeOptimizer";

type PickupLocationForQuote = {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  contactName: string | null;
  phone: string | null;
};

type CartForQuote = {
  id: string;
  marketClusterId: string | null;

  marketCluster: {
    id: string;
    name: string;
    slug: string;
  } | null;

  items: Array<{
    quantity: number;

    product: {
      id: string;
      name: string;
      marketClusterId: string | null;

      vendor: {
        id: string;
        displayName: string;
        email: string | null;
        phone: string | null;
        pickupLocations: PickupLocationForQuote[];
      } | null;
    };

    productVariant: {
      id: string;
      name: string;
      unitWeightKg: number | null;
      priceNgn: number;
    } | null;
  }>;
};

function unauthorized() {
  return NextResponse.json(
    {
      message: "Unauthorized",
    },
    {
      status: 401,
    }
  );
}

function buildPickups(
  cart: CartForQuote
): VendorPickupInput[] {
  const pickups =
    new Map<
      string,
      VendorPickupInput
    >();

  for (const item of cart.items) {
    const vendor =
      item.product.vendor;

    if (!vendor) {
      throw new Error(
        `Product ${item.product.name} is not attached to an approved vendor`
      );
    }

    const pickupLocation =
      vendor.pickupLocations[0];

    if (!pickupLocation) {
      throw new Error(
        `${vendor.displayName} does not have an active pickup location`
      );
    }

    const pickupPhone =
      pickupLocation.phone ??
      vendor.phone;

    /**
     * Don't send a fake phone number
     * to Kwik.
     *
     * Every vendor participating in
     * delivery must have a real pickup
     * contact number.
     */
    if (!pickupPhone) {
      throw new Error(
        `${vendor.displayName} does not have a pickup contact phone number`
      );
    }

    if (
      !Number.isFinite(
        pickupLocation.latitude
      ) ||
      !Number.isFinite(
        pickupLocation.longitude
      )
    ) {
      throw new Error(
        `${vendor.displayName} has an invalid pickup location`
      );
    }

    if (!pickups.has(vendor.id)) {
      pickups.set(
        vendor.id,
        {
          vendorId:
            vendor.id,

          vendorName:
            vendor.displayName,

          address:
            pickupLocation.address,

          latitude:
            pickupLocation.latitude,

          longitude:
            pickupLocation.longitude,

          phone:
            pickupPhone,

          email:
            vendor.email ??
            undefined,
        }
      );
    }
  }

  return Array.from(
    pickups.values()
  );
}

function calculateTotalWeightKg(
  cart: CartForQuote
): number {
  let totalWeightKg = 0;

  for (const item of cart.items) {
    const variant = item.productVariant;
    const unitWeightKg = variant?.unitWeightKg;

    if (
      !variant ||
      typeof unitWeightKg !== "number" ||
      !Number.isFinite(unitWeightKg) ||
      unitWeightKg <= 0
    ) {
      throw new Error(
        `PRODUCT_WEIGHT_REQUIRED:${item.product.name}`
      );
    }

    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(
        `INVALID_CART_QUANTITY:${item.product.name}`
      );
    }

    totalWeightKg +=
      unitWeightKg *
      item.quantity;
  }

  return (
    Math.round(
      totalWeightKg * 1000
    ) / 1000
  );
}
export async function POST() {
  try {
    const cookieStore =
      await cookies();

    const token =
      cookieStore.get(
        "manna_token"
      )?.value;

    if (!token) {
      return unauthorized();
    }

    const decoded =
      verifyAuthToken(token);

    if (
      !decoded?.userId ||
      decoded.role !==
        "CUSTOMER"
    ) {
      return unauthorized();
    }

    const [customer, cart] =
      await Promise.all([
        prisma.user.findFirst({
          where: {
            id: decoded.userId,
            role: "CUSTOMER",
          },

          select: {
            id: true,
            name: true,
            phone: true,
            email: true,

            deliveryProfile: {
              select: {
                address1: true,
                address2: true,
                city: true,
                state: true,
                latitude: true,
                longitude: true,
                deliveryNote:
                  true,
              },
            },
          },
        }),

        prisma.cart.findUnique({
          where: {
            userId:
              decoded.userId,
          },

          select: {
            id: true,
            marketClusterId:
              true,

            marketCluster: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },

            items: {
              select: {
                quantity: true,

                product: {
                  select: {
                    id: true,
                    name: true,
                    marketClusterId:
                      true,

                    vendor: {
                      select: {
                        id: true,
                        displayName:
                          true,
                        email: true,
                        phone: true,

                        pickupLocations:
                          {
                            where: {
                              isActive:
                                true,
                            },

                            orderBy:
                              [
                                {
                                  isDefault:
                                    "desc",
                                },
                                {
                                  createdAt:
                                    "asc",
                                },
                              ],

                            take: 1,

                            select:
                              {
                                id: true,
                                address:
                                  true,

                                latitude:
                                  true,

                                longitude:
                                  true,

                                contactName:
                                  true,

                                phone:
                                  true,
                              },
                          },
                      },
                    },
                  },
                },

                productVariant:
                  {
                    select: {
                      id: true,
                      name: true,

                      unitWeightKg:
                        true,

                      priceNgn:
                        true,
                    },
                  },
              },
            },
          },
        }),
      ]);

    if (!customer) {
      return unauthorized();
    }

    /**
     * Capture profile into a local
     * variable before validating it.
     *
     * This gives TypeScript reliable
     * narrowing.
     */
    const delivery =
      customer.deliveryProfile;

    if (
      !customer.phone ||
      !delivery ||
      !delivery.address1?.trim() ||
      !delivery.city?.trim() ||
      !delivery.state?.trim()
    ) {
      return NextResponse.json(
        {
          code:
            "DELIVERY_PROFILE_REQUIRED",

          message:
            "Complete your delivery details in My Manna Account before checkout.",
        },
        {
          status: 409,
        }
      );
    }

    /**
     * Read coordinates into local
     * variables before checking them.
     *
     * After this guard they are
     * definitely `number`, not
     * `number | null`.
     */
    const deliveryLatitude =
      delivery.latitude;

    const deliveryLongitude =
      delivery.longitude;

    if (
      deliveryLatitude ===
        null ||
      deliveryLongitude ===
        null
    ) {
      return NextResponse.json(
        {
          code:
            "DELIVERY_LOCATION_REQUIRED",

          message:
            "Use current location in My Manna Account so Manna can calculate your Kwik delivery.",
        },
        {
          status: 409,
        }
      );
    }

    /**
     * Protect Kwik from malformed
     * coordinates.
     */
    if (
      !Number.isFinite(
        deliveryLatitude
      ) ||
      !Number.isFinite(
        deliveryLongitude
      ) ||
      deliveryLatitude < -90 ||
      deliveryLatitude > 90 ||
      deliveryLongitude <
        -180 ||
      deliveryLongitude > 180
    ) {
      return NextResponse.json(
        {
          code:
            "DELIVERY_LOCATION_INVALID",

          message:
            "Your saved delivery location is invalid. Please use current location again in My Manna Account.",
        },
        {
          status: 409,
        }
      );
    }

    if (
      !cart ||
      cart.items.length === 0
    ) {
      return NextResponse.json(
        {
          message:
            "Cart is empty",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !cart.marketClusterId ||
      !cart.marketCluster
    ) {
      return NextResponse.json(
        {
          message:
            "Cart must be locked to one market cluster before delivery quote",
        },
        {
          status: 400,
        }
      );
    }

    /**
     * Defensively ensure every
     * product belongs to the cart's
     * selected market.
     */
    const invalidClusterItem =
      cart.items.find(
        (item) =>
          item.product
            .marketClusterId !==
          cart.marketClusterId
      );

    if (
      invalidClusterItem
    ) {
      return NextResponse.json(
        {
          message:
            "Cart contains an item outside the selected market cluster",
        },
        {
          status: 409,
        }
      );
    }

    let totalWeightKg: number;

    try {
      totalWeightKg =
        calculateTotalWeightKg(
          cart as CartForQuote
        );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Product delivery weight is invalid";

      if (
        message.startsWith(
          "PRODUCT_WEIGHT_REQUIRED:"
        )
      ) {
        const productName =
          message.slice(
            "PRODUCT_WEIGHT_REQUIRED:".length
          );

        return NextResponse.json(
          {
            code:
              "PRODUCT_WEIGHT_REQUIRED",
            message:
              `${productName} cannot be quoted for delivery until its variant weight is configured.`,
          },
          {
            status: 409,
          }
        );
      }

      if (
        message.startsWith(
          "INVALID_CART_QUANTITY:"
        )
      ) {
        return NextResponse.json(
          {
            code:
              "INVALID_CART_QUANTITY",
            message:
              "Cart contains an invalid quantity.",
          },
          {
            status: 409,
          }
        );
      }

      throw error;
    }

    let selectedVehicle;

    try {
      selectedVehicle =
        await selectKwikVehicleForWeight(
          totalWeightKg
        );
    } catch (error) {
      if (
        error instanceof
        KwikVehicleSelectionError
      ) {
        return NextResponse.json(
          {
            code: error.code,
            message: error.message,
            totalWeightKg,
            maxCapacityKg:
              error.maxCapacityKg,
          },
          {
            status: 409,
          }
        );
      }

      throw error;
    }

    const pickups =
      buildPickups(
        cart as CartForQuote
      );
if (
      pickups.length === 0
    ) {
      return NextResponse.json(
        {
          message:
            "No vendor pickup locations are available for this cart",
        },
        {
          status: 409,
        }
      );
    }

    const optimizedPickups =
      optimizePickupOrder(
        pickups,
        {
          latitude:
            deliveryLatitude,
          longitude:
            deliveryLongitude,
        }
      );

    const deliveryAddress = [
      delivery.address1,
      delivery.address2,
      delivery.city,
      delivery.state,
    ]
      .filter(Boolean)
      .join(", ");

    /**
     * This is the actual Kwik quote.
     *
     * Customer delivery address and
     * coordinates come from their
     * saved Manna delivery profile.
     *
     * Pickup addresses and coordinates
     * come from each vendor's active
     * pickup location.
     */
    const quote =
      await quoteKwikMarketplaceDelivery(
        {
          pickups: optimizedPickups,
          vehicleId:
            selectedVehicle.vehicleId,

          vehicleName:
            selectedVehicle.name,
          delivery: {
            name:
              customer.name,

            phone:
              customer.phone,

            email:
              customer.email ??
              undefined,

            address:
              deliveryAddress,

            latitude:
              deliveryLatitude,

            longitude:
              deliveryLongitude,

            instruction:
              delivery.deliveryNote
                ?.trim() ||
              undefined,
          },

        }
      );

    /**
     * Kwik price is frozen for this
     * Manna checkout for 10 minutes.
     *
     * Checkout must reject/requote
     * after this time rather than
     * using a stale delivery price.
     */
    const quoteExpiresAt =
      new Date(
        Date.now() +
          10 * 60 * 1000
      );

    const deliveryQuote =
      await prisma.deliveryQuote.create(
        {
          data: {
            userId:
              decoded.userId,

            cartId:
              cart.id,

            marketClusterId:
              cart.marketClusterId,

            pickupCount:
              quote.pickupCount,

            deliveryCount:
              quote.deliveryCount,

            currency: "NGN",

            kwikPerTaskCostNgn:
              quote.kwikPerTaskCostNgn,

            kwikTotalServiceChargeNgn:
              quote.kwikTotalServiceChargeNgn,

            kwikPayableAmountNgn:
              quote.kwikPayableAmountNgn,

            kwikNetPayableAmountNgn:
              quote.kwikNetPayableAmountNgn,

            kwikDeliveryChargeNgn:
              quote.kwikDeliveryChargeNgn,

            kwikSurgeCostNgn:
              quote.kwikSurgeCostNgn,

            kwikSurgeType:
              quote.kwikSurgeType,

            kwikVehicleId:
              quote.kwikVehicleId,

            kwikVehicleName:
              quote.kwikVehicleName,

            /**
             * This is the delivery
             * amount charged to the
             * Manna customer.
             */
            amountToChargeCustomerNgn:
              quote.amountToChargeCustomerNgn,

            /**
             * Preserve exact Kwik
             * request/response evidence
             * for reconciliation and
             * troubleshooting.
             */
            rawQuoteRequest:
              quote.quotePayload,

            rawQuoteResponse:
              quote.quoteResponse,

            rawBillRequest:
              quote.billPayload,

            rawBillResponse:
              quote.billResponse,

            quoteExpiresAt,

            status:
              "QUOTED",
          } as never,

          select: {
            id: true,

            pickupCount:
              true,

            deliveryCount:
              true,

            amountToChargeCustomerNgn:
              true,

            currency:
              true,

            quoteExpiresAt:
              true,

            kwikVehicleId:
              true,

            kwikVehicleName:
              true,

            marketClusterId:
              true,
          },
        }
      );

    return NextResponse.json(
      {
        message:
          "Delivery quote created",

        quote:
          deliveryQuote,

        marketCluster:
          cart.marketCluster,

        deliveryProfile: {
          address1:
            delivery.address1,

          address2:
            delivery.address2,

          city:
            delivery.city,

          state:
            delivery.state,

          latitude:
            deliveryLatitude,

          longitude:
            deliveryLongitude,
        },

        pickupVendors:
          optimizedPickups.map(
            (pickup) => ({
              vendorId:
                pickup.vendorId,

              vendorName:
                pickup.vendorName,

              address:
                pickup.address,
            })
          ),
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    console.error(
      "KWIK_DELIVERY_QUOTE_ERROR",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong";

    return NextResponse.json(
      {
        message,
      },
      {
        status: 500,
      }
    );
  }
}