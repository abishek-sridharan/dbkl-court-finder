/**
 * Validate that coordinates are within reasonable bounds for Malaysia.
 * Malaysia's rough bounds: lat 1–7°, lng 99–120°
 */
export function isValidMalaysiaCoord(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // Allow small margin outside strict bounds for edge cases
  return lat >= 0.5 && lat <= 7.5 && lng >= 98 && lng <= 121;
}

/**
 * Calculate distance between two geographic coordinates using Haversine formula
 * @param lat1 Latitude of first point (degrees)
 * @param lng1 Longitude of first point (degrees)
 * @param lat2 Latitude of second point (degrees)
 * @param lng2 Longitude of second point (degrees)
 * @returns Distance in kilometers
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Road circuity factor for KL — straight-line distances are multiplied by this
 * to produce a more realistic road-distance estimate.
 */
const ROAD_CORRECTION_FACTOR = 2;

/**
 * Estimated road distance in km, from a straight-line distance.
 *
 * Anything the user compares against a displayed distance must go through this:
 * filtering on the raw straight-line value while showing the corrected one made
 * "within 10 km" quietly admit venues whose badge read ~20 km.
 */
export function roadDistanceKm(straightLineKm: number): number {
  return straightLineKm * ROAD_CORRECTION_FACTOR;
}

/**
 * Format a straight-line distance for display, applying the road correction so
 * the value is closer to actual driving distance.
 * The "~" prefix signals this is an estimate, not a measured road distance.
 */
export function formatDistance(straightLineKm: number): string {
  const km = roadDistanceKm(straightLineKm);
  if (km < 1) {
    return '~' + Math.round(km * 1000) + ' m';
  }
  return '~' + km.toFixed(1) + ' km';
}
