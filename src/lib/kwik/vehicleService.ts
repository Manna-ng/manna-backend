import { getKwikConfig } from "./env";

type JsonRecord = Record<string, unknown>;

export type KwikVehicleOption = {
  vehicleId: number;
  name: string;
  capacityKg: number;
  size: number;
  dimension: string | null;
  baseFareNgn: number | null;
};

export class KwikVehicleSelectionError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SHIPMENT_WEIGHT"
      | "KWIK_VEHICLE_CATALOGUE_EMPTY"
      | "KWIK_VEHICLE_CAPACITY_EXCEEDED",
    message: string,
    public readonly maxCapacityKg: number | null = null
  ) {
    super(message);
    this.name = "KwikVehicleSelectionError";
  }
}

let cachedCatalogue:
  | {
      expiresAt: number;
      vehicles: KwikVehicleOption[];
    }
  | null = null;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) && number > 0 ? number : null;
}

function parseVehicle(value: unknown): KwikVehicleOption | null {
  const record = asRecord(value);
  if (!record) return null;

  const vehicleId = positiveInteger(record.vehicle_id);
  const capacityKg = finiteNumber(record.weight);
  const size = finiteNumber(record.size);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const isDeleted = finiteNumber(record.is_deleted);

  if (
    vehicleId === null ||
    capacityKg === null ||
    capacityKg <= 0 ||
    size === null ||
    !name ||
    isDeleted === 1
  ) {
    return null;
  }

  return {
    vehicleId,
    name,
    capacityKg,
    size,
    dimension:
      typeof record.dimension === "string" && record.dimension.trim()
        ? record.dimension.trim()
        : null,
    baseFareNgn: finiteNumber(record.base_fare),
  };
}

async function fetchVehicleSize(size: number): Promise<KwikVehicleOption[]> {
  const config = getKwikConfig();

  if (!config.baseUrl?.trim() || !config.accessToken?.trim()) {
    throw new Error("KWIK_BASE_URL and KWIK_ACCESS_TOKEN are required for vehicle discovery");
  }

  const url = new URL(`${config.baseUrl.replace(/\/+$/, "")}/getVehicle`);
  url.searchParams.set("access_token", config.accessToken);
  url.searchParams.set("is_vendor", "1");
  url.searchParams.set("size", String(size));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, config.requestTimeoutMs));

  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Kwik vehicle catalogue HTTP ${response.status} for size ${size}`);
  }

  const body: unknown = await response.json();
  const record = asRecord(body);

  if (!record) {
    throw new Error(`Kwik vehicle catalogue returned invalid JSON for size ${size}`);
  }

  const applicationStatus = finiteNumber(record.status);

  // Kwik staging currently returns HTTP 200 + application status 201 when
  // a size class has no configured vehicles. That is an empty class, not success.
  if (applicationStatus !== 200) {
    return [];
  }

  const data = record.data;
  const values = Array.isArray(data) ? data : [data];

  return values
    .map(parseVehicle)
    .filter((vehicle): vehicle is KwikVehicleOption => vehicle !== null);
}

export async function getKwikVehicleCatalogue(
  forceRefresh = false
): Promise<KwikVehicleOption[]> {
  const now = Date.now();

  if (!forceRefresh && cachedCatalogue && cachedCatalogue.expiresAt > now) {
    return cachedCatalogue.vehicles;
  }

  const groups = await Promise.all([0, 1, 2, 3, 4].map(fetchVehicleSize));
  const byId = new Map<number, KwikVehicleOption>();

  for (const vehicle of groups.flat()) {
    byId.set(vehicle.vehicleId, vehicle);
  }

  const vehicles = Array.from(byId.values()).sort(
    (a, b) =>
      a.capacityKg - b.capacityKg ||
      (a.baseFareNgn ?? Number.MAX_SAFE_INTEGER) -
        (b.baseFareNgn ?? Number.MAX_SAFE_INTEGER) ||
      a.vehicleId - b.vehicleId
  );

  if (vehicles.length === 0) {
    throw new KwikVehicleSelectionError(
      "KWIK_VEHICLE_CATALOGUE_EMPTY",
      "Kwik currently has no delivery vehicles available for automatic dispatch."
    );
  }

  cachedCatalogue = {
    expiresAt: now + 5 * 60 * 1000,
    vehicles,
  };

  return vehicles;
}

export async function selectKwikVehicleForWeight(
  totalWeightKg: number
): Promise<KwikVehicleOption> {
  if (!Number.isFinite(totalWeightKg) || totalWeightKg <= 0) {
    throw new KwikVehicleSelectionError(
      "INVALID_SHIPMENT_WEIGHT",
      "Shipment weight must be greater than zero before requesting Kwik delivery."
    );
  }

  const vehicles = await getKwikVehicleCatalogue();
  const selected = vehicles.find((vehicle) => vehicle.capacityKg >= totalWeightKg);

  if (selected) return selected;

  const maxCapacityKg = Math.max(...vehicles.map((vehicle) => vehicle.capacityKg));

  throw new KwikVehicleSelectionError(
    "KWIK_VEHICLE_CAPACITY_EXCEEDED",
    `This order weighs ${totalWeightKg} kg, which exceeds the largest Kwik vehicle currently available to Manna (${maxCapacityKg} kg).`,
    maxCapacityKg
  );
}