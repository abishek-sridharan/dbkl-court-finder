import type { LocationFacility, SportCategory } from '../types';
import type { LocationFacilityTime } from './consecutiveSlots';

/**
 * A pre-swept copy of DBKL availability, published by scripts/snapshot.mjs on a
 * schedule and read here so the first paint is not a multi-minute progress bar.
 *
 * DBKL throttles hard enough that a full sweep takes roughly a minute even from
 * CI, and every visitor was paying that. The snapshot is a starting point, never
 * the last word: whatever it seeds is refetched live in the background, so stale
 * entries correct themselves rather than misleading anyone.
 */

/** Must match SNAPSHOT_VERSION in scripts/snapshot.mjs. */
const SNAPSHOT_VERSION = 1;

/** Older than this and it is not worth seeding — the live sweep is close enough. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const SNAPSHOT_URL =
  'https://raw.githubusercontent.com/abishek-sridharan/dbkl-court-finder/data/snapshot/badminton.json';

/** [start_time_id, end_time_id, start_time_value, end_time_value, available, price] */
type SlotTuple = [string, string, string, string, number, string];

interface SnapshotCourt {
  i: string;
  v: string;
  t: SlotTuple[];
}

interface SnapshotVenue {
  id: string;
  n: string;
  c: SnapshotCourt[];
}

interface SnapshotFile {
  version: number;
  sport: string;
  generatedAt: string;
  dates: string[];
  byDate: Record<string, SnapshotVenue[]>;
}

export interface LoadedSnapshot {
  sport: SportCategory;
  generatedAt: number;
  /** date (YYYY-MM-DD) → location_id → that venue's courts */
  byDate: Map<string, Map<string, LocationFacility[]>>;
}

function expandSlot(tuple: SlotTuple, courtId: string): LocationFacilityTime {
  const [startId, endId, startValue, endValue, available, price] = tuple;
  return {
    id: `${courtId}-${startId}-${endId}`,
    location_facility_id: courtId,
    start_time_id: startId,
    end_time_id: endId,
    start_time_value: startValue,
    end_time_value: endValue,
    price,
    is_active: '1',
    slot_available: available === 1,
  };
}

function expandVenue(venue: SnapshotVenue, sport: SportCategory): LocationFacility[] {
  return venue.c.map((court) => ({
    id: court.i,
    location_id: venue.id,
    venue_name: court.v,
    location_name: venue.n,
    sub_category_name: sport,
    location_facility_times: court.t.map((tuple) => expandSlot(tuple, court.i)),
  }));
}

/** Narrow an unknown payload before trusting any of it. */
function isSnapshotFile(value: unknown): value is SnapshotFile {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Partial<SnapshotFile>;
  return (
    f.version === SNAPSHOT_VERSION &&
    typeof f.sport === 'string' &&
    typeof f.generatedAt === 'string' &&
    Array.isArray(f.dates) &&
    typeof f.byDate === 'object' &&
    f.byDate !== null
  );
}

export function parseSnapshot(raw: unknown, now = Date.now()): LoadedSnapshot | null {
  if (!isSnapshotFile(raw)) return null;

  const generatedAt = Date.parse(raw.generatedAt);
  if (!Number.isFinite(generatedAt)) return null;
  if (now - generatedAt > MAX_AGE_MS) return null;

  const sport = raw.sport as SportCategory;
  const byDate = new Map<string, Map<string, LocationFacility[]>>();

  for (const [date, venues] of Object.entries(raw.byDate)) {
    if (!Array.isArray(venues)) continue;
    const forDate = new Map<string, LocationFacility[]>();
    for (const venue of venues) {
      if (!venue?.id || !Array.isArray(venue.c)) continue;
      forDate.set(venue.id, expandVenue(venue, sport));
    }
    byDate.set(date, forDate);
  }

  return { sport, generatedAt, byDate };
}

/**
 * Never throws and never blocks the app: a missing, stale or malformed snapshot
 * just means the live sweep behaves exactly as it did before this existed.
 */
export async function fetchSnapshot(signal?: AbortSignal): Promise<LoadedSnapshot | null> {
  try {
    const res = await fetch(SNAPSHOT_URL, { signal });
    if (!res.ok) return null;
    return parseSnapshot(await res.json());
  } catch {
    return null;
  }
}
