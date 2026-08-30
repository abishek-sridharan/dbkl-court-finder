import { SPORT_OPTIONS } from '../types';
import type { SportCategory } from '../types';
import { HOUR_COUNT, timeIndex, TIME_ORDER } from './consecutiveSlots';

/**
 * The filter state that lives in the URL, so any view can be bookmarked, shared,
 * or reached with the browser's back button. Everything here is also App state;
 * this module is only the lossless, validated bridge to and from the query
 * string.
 */
export interface FilterState {
  sport: SportCategory;
  date: string;
  locationId: string;
  nearMeOnly: boolean;
  minConsecutiveSlots: number;
  minCourtsNeeded: number;
  timeRangeStart: string | null;
  timeRangeEnd: string | null;
}

// Short, stable query keys. Renaming one breaks old links, so treat them as a
// contract.
const KEY = {
  sport: 'sport',
  date: 'date',
  locationId: 'loc',
  nearMeOnly: 'near',
  minConsecutiveSlots: 'hrs',
  minCourtsNeeded: 'courts',
  timeRangeStart: 'from',
  timeRangeEnd: 'to',
} as const;

const MAX_COURTS = 20;
const MAX_DATE_AHEAD_DAYS = 21;

const isSport = (v: string): v is SportCategory =>
  SPORT_OPTIONS.some(o => o.value === v);

/** A bookable hour label, or null. Anything unrecognised drops to null. */
function parseTime(v: string | null): string | null {
  if (!v) return null;
  const idx = TIME_ORDER.indexOf(v);
  return idx >= 0 && idx < HOUR_COUNT ? v : null;
}

function parseInts(v: string | null, min: number, max: number, fallback: number): number {
  const n = v == null ? NaN : parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(min, n), max);
}

/** YYYY-MM-DD within [today, today+21d]; anything else falls back to today. */
function parseDate(v: string | null, today: string): string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return today;
  const max = addDaysIso(today, MAX_DATE_AHEAD_DAYS);
  if (v < today || v > max) return today;
  return v;
}

// Local-date arithmetic on the YYYY-MM-DD string, without a Date round-trip that
// could reintroduce a timezone slip.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}

export function defaultFilterState(today: string): FilterState {
  return {
    sport: 'BADMINTON',
    date: today,
    locationId: '',
    nearMeOnly: false,
    minConsecutiveSlots: 2,
    minCourtsNeeded: 1,
    timeRangeStart: null,
    timeRangeEnd: null,
  };
}

/**
 * Read a validated FilterState from a query string. Every field falls back to
 * its default rather than throwing, so a hand-edited or stale link degrades to
 * a sensible view instead of a broken one. `today` is passed in to keep this
 * pure and testable.
 */
export function parseFilterState(search: string, today: string): FilterState {
  const p = new URLSearchParams(search);
  const base = defaultFilterState(today);

  const sport = p.get(KEY.sport);
  const start = parseTime(p.get(KEY.timeRangeStart));
  let end = parseTime(p.get(KEY.timeRangeEnd));
  // An end at or before the start is not a window; drop it and keep the start.
  if (start && end && timeIndex(end) <= timeIndex(start)) end = null;

  return {
    sport: sport && isSport(sport) ? sport : base.sport,
    date: parseDate(p.get(KEY.date), today),
    locationId: p.get(KEY.locationId) ?? base.locationId,
    nearMeOnly: p.get(KEY.nearMeOnly) === '1',
    minConsecutiveSlots: parseInts(p.get(KEY.minConsecutiveSlots), 1, HOUR_COUNT, base.minConsecutiveSlots),
    minCourtsNeeded: parseInts(p.get(KEY.minCourtsNeeded), 1, MAX_COURTS, base.minCourtsNeeded),
    timeRangeStart: start,
    // A lone end with no start is meaningless; the picker cannot represent it.
    timeRangeEnd: start ? end : null,
  };
}

/**
 * Build a query string from a FilterState, omitting anything still at its
 * default so a fresh, unfiltered view has a clean URL and links stay short.
 * Returns "" when nothing differs from the defaults.
 */
export function buildFilterQuery(state: FilterState, today: string): string {
  const base = defaultFilterState(today);
  const p = new URLSearchParams();

  if (state.sport !== base.sport) p.set(KEY.sport, state.sport);
  if (state.date !== base.date) p.set(KEY.date, state.date);
  if (state.locationId) p.set(KEY.locationId, state.locationId);
  if (state.nearMeOnly) p.set(KEY.nearMeOnly, '1');
  if (state.minConsecutiveSlots !== base.minConsecutiveSlots) {
    p.set(KEY.minConsecutiveSlots, String(state.minConsecutiveSlots));
  }
  if (state.minCourtsNeeded !== base.minCourtsNeeded) {
    p.set(KEY.minCourtsNeeded, String(state.minCourtsNeeded));
  }
  if (state.timeRangeStart) p.set(KEY.timeRangeStart, state.timeRangeStart);
  if (state.timeRangeStart && state.timeRangeEnd) p.set(KEY.timeRangeEnd, state.timeRangeEnd);

  return p.toString();
}
