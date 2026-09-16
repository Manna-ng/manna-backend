import { NextResponse, type NextRequest } from "next/server";

import { haversineDistanceKm } from "@/lib/marketplace/geo";
import { parseCoordinatesFromSearchParams } from "@/lib/marketplace/marketSelection";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const coordinateInput = parseCoordinatesFromSearchParams(req.nextUrl.searchParams);

    if (coordinateInput.error || !coordinateInput.coordinates) {
      return NextResponse.json(
        { message: coordinateInput.error ?? "lat and lng query parameters are required" },
        { status: 400 }
      );
    }

    const clusters = await prisma.marketCluster.findMany({
      where: { isActive: true },
      orderBy: [{ state: "asc" }, { city: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        state: true,
        centerAddress: true,
        centerLat: true,
        centerLng: true,
        radiusKm: true,
        pickupAddress: true,
        pickupLat: true,
        pickupLng: true,
        _count: {
          select: {
            vendors: {
              where: {
                status: "APPROVED",
                isActive: true,
                isVisible: true,
              },
            },
            products: {
              where: {
                isActive: true,
                approvalStatus: "APPROVED",
                OR: [
                  { vendorId: null },
                  {
                    vendor: {
                      status: "APPROVED",
                      isActive: true,
                      isVisible: true,
                    },
                  },
                ],
              },
            },
          },
        },
      },
    });

    const ranked = clusters
      .map((cluster) => {
        const rawDistanceKm = haversineDistanceKm(coordinateInput.coordinates!, {
          lat: cluster.centerLat,
          lng: cluster.centerLng,
        });

        return {
          ...cluster,
          distanceKm: Number(rawDistanceKm.toFixed(2)),
          isEligible: rawDistanceKm <= cluster.radiusKm,
          vendorCount: cluster._count.vendors,
          productCount: cluster._count.products,
          _count: undefined,
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const nearestMarket = ranked[0] ?? null;
    const nearestEligibleMarket = ranked.find((cluster) => cluster.isEligible) ?? null;

    return NextResponse.json({
      serviceable: Boolean(nearestEligibleMarket),
      nearestMarket,
      nearestEligibleMarket,
      clusters: ranked,
    });
  } catch (error) {
    console.error("GET /market-clusters/eligible error:", error);
    return NextResponse.json({ message: "Unable to resolve market clusters" }, { status: 500 });
  }
}
