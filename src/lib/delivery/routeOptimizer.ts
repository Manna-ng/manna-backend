export type RoutablePoint = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_KM = 6371.0088;
const EXACT_ROUTE_LIMIT = 12;

function assertCoordinate(point: RoutablePoint, label: string) {
  if (
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    throw new Error(`${label} has invalid routing coordinates`);
  }
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineDistanceKm(
  a: RoutablePoint,
  b: RoutablePoint
): number {
  assertCoordinate(a, "Route point");
  assertCoordinate(b, "Route point");

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b.longitude - a.longitude);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_KM *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(haversine)
      )
    )
  );
}

function exactPickupPathIndexes<T extends RoutablePoint>(
  pickups: readonly T[],
  delivery: RoutablePoint
): number[] {
  const count = pickups.length;
  const fullMask = (1 << count) - 1;

  const pickupDistances = Array.from(
    { length: count },
    (_, from) =>
      Array.from(
        { length: count },
        (_, to) =>
          from === to
            ? 0
            : haversineDistanceKm(
                pickups[from],
                pickups[to]
              )
      )
  );

  const deliveryDistances =
    pickups.map((pickup) =>
      haversineDistanceKm(
        pickup,
        delivery
      )
    );

  const stateCount = 1 << count;
  const width = count;

  const costs =
    new Float64Array(
      stateCount * width
    );

  costs.fill(
    Number.POSITIVE_INFINITY
  );

  const previous =
    new Int16Array(
      stateCount * width
    );

  previous.fill(-1);

  const offset = (
    mask: number,
    last: number
  ) =>
    mask * width + last;

  for (
    let pickup = 0;
    pickup < count;
    pickup += 1
  ) {
    costs[
      offset(
        1 << pickup,
        pickup
      )
    ] = 0;
  }

  for (
    let mask = 1;
    mask <= fullMask;
    mask += 1
  ) {
    for (
      let last = 0;
      last < count;
      last += 1
    ) {
      if (
        (mask & (1 << last)) ===
        0
      ) {
        continue;
      }

      const currentCost =
        costs[
          offset(
            mask,
            last
          )
        ];

      if (
        !Number.isFinite(
          currentCost
        )
      ) {
        continue;
      }

      for (
        let next = 0;
        next < count;
        next += 1
      ) {
        if (
          mask &
          (1 << next)
        ) {
          continue;
        }

        const nextMask =
          mask |
          (1 << next);

        const candidate =
          currentCost +
          pickupDistances[last][next];

        const nextOffset =
          offset(
            nextMask,
            next
          );

        if (
          candidate <
          costs[nextOffset]
        ) {
          costs[nextOffset] =
            candidate;

          previous[nextOffset] =
            last;
        }
      }
    }
  }

  let bestLast = -1;
  let bestCost =
    Number.POSITIVE_INFINITY;

  for (
    let last = 0;
    last < count;
    last += 1
  ) {
    const candidate =
      costs[
        offset(
          fullMask,
          last
        )
      ] +
      deliveryDistances[last];

    if (
      candidate <
      bestCost
    ) {
      bestCost =
        candidate;
      bestLast =
        last;
    }
  }

  if (
    bestLast < 0 ||
    !Number.isFinite(bestCost)
  ) {
    throw new Error(
      "Unable to calculate pickup route"
    );
  }

  const reversedIndexes: number[] =
    [];

  let mask = fullMask;
  let last = bestLast;

  while (last >= 0) {
    reversedIndexes.push(last);

    const prior =
      previous[
        offset(
          mask,
          last
        )
      ];

    mask ^=
      1 << last;

    last =
      prior;
  }

  return reversedIndexes.reverse();
}

function heuristicPickupPathIndexes<
  T extends RoutablePoint
>(
  pickups: readonly T[],
  delivery: RoutablePoint
): number[] {
  const remaining =
    new Set<number>(
      pickups.map(
        (_, index) => index
      )
    );

  const reversePath: number[] =
    [];

  let current:
    RoutablePoint =
      delivery;

  while (
    remaining.size > 0
  ) {
    let nearest = -1;
    let nearestDistance =
      Number.POSITIVE_INFINITY;

    for (
      const candidate
      of remaining
    ) {
      const distance =
        haversineDistanceKm(
          pickups[candidate],
          current
        );

      if (
        distance <
          nearestDistance ||
        (
          distance ===
            nearestDistance &&
          candidate < nearest
        )
      ) {
        nearest =
          candidate;
        nearestDistance =
          distance;
      }
    }

    if (nearest < 0) {
      throw new Error(
        "Unable to calculate pickup route"
      );
    }

    reversePath.push(
      nearest
    );

    current =
      pickups[nearest];

    remaining.delete(
      nearest
    );
  }

  return reversePath.reverse();
}

/**
 * Optimizes vendor pickup order for a route that must visit every pickup
 * exactly once and finish at the customer's delivery location.
 *
 * Rider origin is not known at checkout/quote time, so no cost is assigned
 * to reaching the first pickup. This optimizes the part of the route that
 * Manna can control and that is sent to the delivery provider for pricing.
 */
export function optimizePickupOrder<
  T extends RoutablePoint
>(
  pickups: readonly T[],
  delivery: RoutablePoint
): T[] {
  assertCoordinate(
    delivery,
    "Delivery location"
  );

  for (
    let index = 0;
    index < pickups.length;
    index += 1
  ) {
    assertCoordinate(
      pickups[index],
      `Pickup ${index + 1}`
    );
  }

  if (
    pickups.length <= 1
  ) {
    return [...pickups];
  }

  const indexes =
    pickups.length <=
    EXACT_ROUTE_LIMIT
      ? exactPickupPathIndexes(
          pickups,
          delivery
        )
      : heuristicPickupPathIndexes(
          pickups,
          delivery
        );

  return indexes.map(
    (index) =>
      pickups[index]
  );
}