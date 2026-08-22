import type { LocationFacility, SportCategory } from '../types';

/**
 * Session cache for court availability, shared by useFacility and
 * useAllFacilities so the two never fetch the same venue twice.
 *
 * Without it every filter change re-fetches all 59+ locations from scratch:
 * tapping Tomorrow and back fires ~120 requests for data that was on screen
 * seconds earlier, and selecting a single venue re-fetches what the
 * all-locations sweep just loaded. DBKL's API throttles concurrent requests
 * hard — a full sweep takes minutes, not seconds — so avoiding a request is
 * worth far more here than on a typical API.
 *
 * Lives in module state, not localStorage: availability changes as people book,
 * and stale bookings shown across sessions would be worse than a refetch.
 */

interface CacheEntry {
  courts: LocationFacility[];
  fetchedAt: number;
}

/**
 * How long a cached venue is served without refetching.
 *
 * Generous on purpose: a full sweep of every location takes minutes against
 * this API, so a short window would expire the venues fetched first before the
 * sweep even finished, and switching dates and back would refetch everything —
 * exactly the case this cache exists to fix. The cost is that a slot booked by
 * someone else can linger as free for a few minutes; the Book link goes to
 * DBKL, which is authoritative, and the refresh button clears the cache
 * outright for anyone who wants certainty.
 */
const FRESH_MS = 10 * 60 * 1000;

const cache = new Map<string, CacheEntry>();

function cacheKey(sport: SportCategory, date: string, locationId: string): string {
  return `${sport}|${date}|${locationId}`;
}

/** Cached courts for one venue, or null when absent or older than FRESH_MS. */
export function readFacility(
  sport: SportCategory,
  date: string,
  locationId: string
): LocationFacility[] | null {
  const entry = cache.get(cacheKey(sport, date, locationId));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > FRESH_MS) return null;
  return entry.courts;
}

export function writeFacility(
  sport: SportCategory,
  date: string,
  locationId: string,
  courts: LocationFacility[]
): void {
  cache.set(cacheKey(sport, date, locationId), { courts, fetchedAt: Date.now() });
}

/** Drop everything, so the next render refetches. Wired to the refresh button. */
export function clearFacilityCache(): void {
  cache.clear();
}
