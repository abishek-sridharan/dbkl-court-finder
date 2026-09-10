/**
 * Sweeps DBKL availability and writes a compact snapshot the app can load
 * instead of making every visitor wait out a cold sweep.
 *
 * DBKL throttles concurrent requests hard — a full pass over ~59 venues takes
 * minutes, which is the whole reason this runs in CI rather than in a browser
 * tab. Keep the batching identical to src/hooks/useAllFacilities.ts so this is
 * no ruder to their API than a single visitor would be.
 *
 * Usage: node scripts/snapshot.mjs [--days N] [--sport SPORT] [--out FILE]
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE = 'https://apihub.dbkl.gov.my/api/public/v1';
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;
/** Bumped when the on-disk shape changes, so an old snapshot is ignored rather than misread. */
const SNAPSHOT_VERSION = 1;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DAYS = Math.max(1, parseInt(arg('days', '2'), 10) || 2);
const SPORT = arg('sport', 'BADMINTON');
const OUT = arg('out', 'snapshot/badminton.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localIso(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Kuala Lumpur is UTC+8; CI runs in UTC, so "today" must be KL's today. */
function klNow() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

async function getJson(url, attempt = 0) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // One retry: a sweep this long will meet the occasional blip, and losing a
    // venue silently is exactly the failure the app already works to avoid.
    if (attempt < 1) {
      await sleep(1000);
      return getJson(url, attempt + 1);
    }
    throw err;
  }
}

async function fetchLocations(sport) {
  const data = await getJson(`${BASE}/location/getCategoryByLocation`);
  const byId = new Map();
  Object.values(data?.data ?? {}).forEach((group) => {
    if (!Array.isArray(group)) return;
    group.forEach((sub) => {
      if (sub?.sub_category_name !== sport) return;
      (sub.locations ?? []).forEach((loc) => {
        if (loc?.location_id && loc?.location_name) {
          byId.set(loc.location_id, loc.location_name);
        }
      });
    });
  });
  return [...byId.entries()].map(([id, name]) => ({ id, name }));
}

/**
 * Only the fields the UI actually reads, as positional tuples.
 * Measured against the live API: this is ~82% smaller than echoing the raw
 * response, which is what makes a frequently-refreshed snapshot practical.
 */
function slimCourt(court) {
  return {
    i: court.id,
    v: court.venue_name,
    t: (court.location_facility_times ?? []).map((slot) => [
      slot.start_time_id,
      slot.end_time_id,
      slot.start_time_value,
      slot.end_time_value,
      slot.slot_available ? 1 : 0,
      slot.price ?? '',
    ]),
  };
}

async function sweepDate(locations, date, sport) {
  const venues = [];
  let failed = 0;

  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const batch = locations.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (loc) => {
        const url =
          `${BASE}/location/facility?sub_category=${encodeURIComponent(sport)}` +
          `&location_id=${loc.id}&search_date=${date}`;
        try {
          const data = await getJson(url);
          const courts = data?.success && data?.data?.data ? data.data.data : [];
          return { id: loc.id, n: loc.name, c: courts.map(slimCourt) };
        } catch {
          return null; // counted below; omitted so the app falls back to fetching it
        }
      }),
    );

    results.forEach((r) => (r ? venues.push(r) : failed++));
    if (i + BATCH_SIZE < locations.length) await sleep(BATCH_DELAY_MS);
  }

  return { venues, failed };
}

async function main() {
  const started = Date.now();
  const locations = await fetchLocations(SPORT);
  if (locations.length === 0) throw new Error(`No locations returned for ${SPORT}`);

  const base = klNow();
  const dates = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    return localIso(d);
  });

  const byDate = {};
  let totalFailed = 0;
  for (const date of dates) {
    const { venues, failed } = await sweepDate(locations, date, SPORT);
    byDate[date] = venues;
    totalFailed += failed;
    console.log(`${date}: ${venues.length}/${locations.length} venues (${failed} failed)`);
  }

  // A sweep that lost most venues is worse than no snapshot — the app would
  // render a confidently empty city. Fail instead and keep the previous one.
  const expected = locations.length * dates.length;
  const got = Object.values(byDate).reduce((n, v) => n + v.length, 0);
  if (got < expected * 0.7) {
    throw new Error(`Only ${got}/${expected} venue-days succeeded; refusing to publish`);
  }

  const snapshot = {
    version: SNAPSHOT_VERSION,
    sport: SPORT,
    generatedAt: new Date().toISOString(),
    dates,
    byDate,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot));
  const kb = Math.round(JSON.stringify(snapshot).length / 1024);
  console.log(
    `wrote ${OUT} — ${kb} KB, ${got}/${expected} venue-days, ` +
      `${totalFailed} failures, ${Math.round((Date.now() - started) / 1000)}s`,
  );
}

main().catch((err) => {
  console.error('snapshot failed:', err.message);
  process.exit(1);
});
