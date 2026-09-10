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

/*
  Deliberately gentler than the app's own sweep (10 at a time, 200ms apart).
  The app paces for someone staring at a progress bar; this job has twenty
  minutes and nobody waiting, and DBKL throttles progressively — the first CI
  run lost 10 venues on its first date and 26 on its second, getting worse as it
  went. Going slower is both more reliable and better manners.
*/
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
/** One hung request would otherwise stall its whole batch: fetch has no default timeout. */
const REQUEST_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 4;
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

/**
 * Fetch with a timeout and exponential backoff.
 *
 * Backoff matters more than retry count here: DBKL's throttling tightens as a
 * sweep proceeds, so retrying immediately just spends the next rejection.
 * Jitter keeps a batch's five retries from landing in lockstep.
 */
async function getJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`${err.name === 'TimeoutError' ? 'timeout' : err.message} after ${attempt} attempts`);
    }
    const backoff = 1000 * 2 ** (attempt - 1) + Math.random() * 500;
    await sleep(backoff);
    return getJson(url, attempt + 1);
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

async function fetchVenue(loc, date, sport) {
  const url =
    `${BASE}/location/facility?sub_category=${encodeURIComponent(sport)}` +
    `&location_id=${loc.id}&search_date=${date}`;
  const data = await getJson(url);
  const courts = data?.success && data?.data?.data ? data.data.data : [];
  return { id: loc.id, n: loc.name, c: courts.map(slimCourt) };
}

async function sweepPass(targets, date, sport, batchSize, delayMs, reasons) {
  const venues = [];
  const stragglers = [];

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (loc) => {
        try {
          return { ok: true, venue: await fetchVenue(loc, date, sport) };
        } catch (err) {
          // Recorded, not swallowed — a silent failure here is what produced a
          // half-empty snapshot with no way to tell why.
          reasons.set(err.message, (reasons.get(err.message) ?? 0) + 1);
          return { ok: false, loc };
        }
      }),
    );

    results.forEach((r) => (r.ok ? venues.push(r.venue) : stragglers.push(r.loc)));
    if (i + batchSize < targets.length) await sleep(delayMs);
  }

  return { venues, stragglers };
}

async function sweepDate(locations, date, sport) {
  const reasons = new Map();
  const first = await sweepPass(locations, date, sport, BATCH_SIZE, BATCH_DELAY_MS, reasons);
  const venues = first.venues;

  // Second pass over whatever the first lost, slower and one at a time. Most
  // stragglers are throttling rather than genuine absence, and by now the
  // burst that caused it has passed.
  if (first.stragglers.length > 0) {
    console.log(`  retrying ${first.stragglers.length} venue(s) slowly`);
    await sleep(5000);
    const second = await sweepPass(first.stragglers, date, sport, 1, 1500, reasons);
    venues.push(...second.venues);
    if (second.stragglers.length > 0) {
      const summary = [...reasons.entries()].map(([m, n]) => `${n}× ${m}`).join(', ');
      console.log(`  still failing: ${second.stragglers.length} — ${summary}`);
    }
  }

  return { venues, failed: locations.length - venues.length };
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

  /*
    Judged per date, not across the whole run. A sweep that lost most of one
    date is worse than no data for it — the app would render a confidently
    empty city — but that is no reason to discard a date that came back whole.
    Dates below the bar are dropped and simply fall through to the live sweep.
  */
  const MIN_COVERAGE = 0.7;
  const byDate = {};
  const published = [];
  let totalFailed = 0;

  for (const date of dates) {
    const { venues, failed } = await sweepDate(locations, date, SPORT);
    totalFailed += failed;
    const coverage = venues.length / locations.length;
    const verdict = coverage >= MIN_COVERAGE ? 'publishing' : 'DROPPED — too incomplete';
    console.log(
      `${date}: ${venues.length}/${locations.length} venues ` +
        `(${Math.round(coverage * 100)}%, ${failed} failed) — ${verdict}`,
    );
    if (coverage >= MIN_COVERAGE) {
      byDate[date] = venues;
      published.push(date);
    }
  }

  if (published.length === 0) {
    throw new Error('No date reached the coverage threshold; refusing to publish');
  }

  const snapshot = {
    version: SNAPSHOT_VERSION,
    sport: SPORT,
    generatedAt: new Date().toISOString(),
    dates: published,
    byDate,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot));
  const kb = Math.round(JSON.stringify(snapshot).length / 1024);
  const venueDays = Object.values(byDate).reduce((n, v) => n + v.length, 0);
  console.log(
    `wrote ${OUT} — ${kb} KB, ${published.length}/${dates.length} dates, ` +
      `${venueDays} venue-days, ${totalFailed} failures, ` +
      `${Math.round((Date.now() - started) / 1000)}s`,
  );
}

main().catch((err) => {
  console.error('snapshot failed:', err.message);
  process.exit(1);
});
