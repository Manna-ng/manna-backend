import { prisma } from "@/lib/prisma";
import { haversineDistanceKm, type Coordinates } from "@/lib/marketplace/geo";

export type MarketSelectionSource =
  | "EXPLICIT"
  | "CART"
  | "COORDINATES"
  | "PROFILE"
  | "LAST_ORDER"
  | "NONE";

export type MarketSummary = {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string;
  centerAddress: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  pickupAddress: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  distanceKm: number | null;
  isEligible: boolean | null;
};

export type MarketSelection = {
  source: MarketSelectionSource;
  coordinates: Coordinates | null;
  selectedMarket: MarketSummary | null;
  nearestMarket: MarketSummary | null;
  serviceable: boolean | null;
};

const marketSelect = {
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
} as const;

type RawMarket = Awaited<ReturnType<typeof loadActiveMarkets>>[number];

async function loadActiveMarkets() {
  return prisma.marketCluster.findMany({
    where: { isActive: true },
    orderBy: [{ state: "asc" }, { city: "asc" }, { name: "asc" }],
    select: marketSelect,
  });
}

function withDistance(market: RawMarket, coordinates: Coordinates | null): MarketSummary {
  if (!coordinates) {
    return {
      ...market,
      distanceKm: null,
      isEligible: null,
    };
  }

  const rawDistanceKm = haversineDistanceKm(coordinates, {
    lat: market.centerLat,
    lng: market.centerLng,
  });

  return {
    ...market,
    distanceKm: Number(rawDistanceKm.toFixed(2)),
    isEligible: rawDistanceKm <= market.radiusKm,
  };
}

export function parseCoordinatesFromSearchParams(
  searchParams: URLSearchParams
): { coordinates: Coordinates | null; error: string | null } {
  const rawLat = searchParams.get("lat");
  const rawLng = searchParams.get("lng");

  if (rawLat === null && rawLng === null) {
    return { coordinates: null, error: null };
  }

  if (rawLat === null || rawLng === null) {
    return {
      coordinates: null,
      error: "lat and lng must be supplied together",
    };
  }

  const lat = Number(rawLat);
  const lng = Number(rawLng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { coordinates: null, error: "lat and lng must be valid numbers" };
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { coordinates: null, error: "lat or lng is outside the valid range" };
  }

  return {
    coordinates: { lat, lng },
    error: null,
  };
}

export async function resolveMarketSelection(input: {
  coordinates?: Coordinates | null;
  marketClusterId?: string | null;
  source?: Exclude<MarketSelectionSource, "NONE" | "COORDINATES">;
}): Promise<MarketSelection> {
  const coordinates = input.coordinates ?? null;

  if (input.marketClusterId) {
    const market = await prisma.marketCluster.findFirst({
      where: {
        id: input.marketClusterId,
        isActive: true,
      },
      select: marketSelect,
    });

    if (!market) {
      return {
        source: input.source ?? "EXPLICIT",
        coordinates,
        selectedMarket: null,
        nearestMarket: null,
        serviceable: false,
      };
    }

    const selectedMarket = withDistance(market, coordinates);

    return {
      source: input.source ?? "EXPLICIT",
      coordinates,
      selectedMarket,
      nearestMarket: selectedMarket,
      serviceable: selectedMarket.isEligible ?? true,
    };
  }

  if (!coordinates) {
    return {
      source: "NONE",
      coordinates: null,
      selectedMarket: null,
      nearestMarket: null,
      serviceable: null,
    };
  }

  const markets = await loadActiveMarkets();
  const ranked = markets
    .map((market) => withDistance(market, coordinates))
    .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));

  const nearestMarket = ranked[0] ?? null;
  const selectedMarket = ranked.find((market) => market.isEligible) ?? null;

  return {
    source: "COORDINATES",
    coordinates,
    selectedMarket,
    nearestMarket,
    serviceable: Boolean(selectedMarket),
  };
}
