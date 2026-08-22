/**
 * Local-timezone date helpers.
 *
 * The DBKL API takes YYYY-MM-DD dates that mean the local calendar day, so every
 * date in this app must be formatted from local getters. `toISOString()` returns
 * a UTC date and is wrong by one day for the first 8 hours of every Malaysian
 * morning (UTC+8) — never use it to build or compare these strings.
 */

/** Format a Date as YYYY-MM-DD in the local timezone. */
export function toLocalIso(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Today's local calendar date as YYYY-MM-DD. */
export function todayLocalIso(): string {
  return toLocalIso(new Date());
}

/** Shift a Date by whole days, staying on local calendar days. */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}
