const TIME_ORDER = [
  '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM',
  '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM', '10:00 PM', '11:00 PM', '12:00 AM',
];

// Bookable hours, indexed by their start time in TIME_ORDER: hour 0 is 8–9 AM,
// hour 15 is 11 PM–12 AM. The final TIME_ORDER entry is an end time only.
const HOUR_COUNT = TIME_ORDER.length - 1;

export function timeIndex(time: string): number {
  const idx = TIME_ORDER.indexOf(time);
  return idx === -1 ? 999 : idx;
}

export interface LocationFacilityTime {
  id: string;
  location_facility_id: string;
  start_time_id: string;
  end_time_id: string;
  start_time_value: string;
  end_time_value: string;
  price: string;
  is_active: string;
  slot_available: boolean;
}

/**
 * How many hour columns a slot record covers, measured in TIME_ORDER indices.
 * Not derivable from start_time_id/end_time_id: those wrap at midnight
 * (10 PM = 23, 12 AM = 1), so the arithmetic goes negative on the last slot.
 */
export function slotSpan(slot: LocationFacilityTime): number {
  const start = timeIndex(slot.start_time_value);
  const end = timeIndex(slot.end_time_value);
  // timeIndex returns a large sentinel for times outside TIME_ORDER, and the API
  // does emit them (one venue lists "12:00 PM → 1:00 AM"). Treating that as a
  // real span would let a single record swallow the rest of the row.
  if (start >= TIME_ORDER.length || end >= TIME_ORDER.length) return 1;
  return end > start ? end - start : 1;
}

/**
 * Which of two records starting at the same time to show and filter on.
 *
 * Availability decides first. Several venues sell the evening only as 2-hour
 * blocks and list every overlapping 1-hour record as unavailable — TLKB PPR
 * PEKAN KEPONG offers 6–8 PM, 8–10 PM and 10 PM–12 AM at RM16 while each
 * 1-hour record inside them is booked at RM30. Preferring the shorter record
 * there would paint a court that is free all evening as fully booked.
 * Between records that agree, the shorter one wins, for per-hour granularity.
 */
function isPreferredSlot(
  candidate: LocationFacilityTime,
  current: LocationFacilityTime
): boolean {
  if (candidate.slot_available !== current.slot_available) {
    return candidate.slot_available;
  }
  return slotSpan(candidate) < slotSpan(current);
}

/**
 * Keep one record per start time. The API returns overlapping records for the
 * same start — a 1-hour "6–7 PM" alongside a 2-hour "6–8 PM" — so both the grid
 * and the filters read availability through this, giving a court one
 * unambiguous reading that the two can never disagree about.
 */
export function dedupeSlotsByStart(
  times: LocationFacilityTime[]
): Map<string, LocationFacilityTime> {
  const byStart = new Map<string, LocationFacilityTime>();
  for (const slot of times) {
    const existing = byStart.get(slot.start_time_id);
    if (!existing || isPreferredSlot(slot, existing)) {
      byStart.set(slot.start_time_id, slot);
    }
  }
  return byStart;
}

/**
 * Build a per-hour availability map, indexed the same way as TIME_ORDER.
 *
 * Walks the hours exactly as CourtRow walks the grid columns — place the record
 * that starts at this hour, then jump past the hours it spans — so the filters
 * mark an hour free if and only if the grid paints it green.
 */
function buildHourAvailability(times: LocationFacilityTime[]): boolean[] {
  const hours: boolean[] = new Array(HOUR_COUNT).fill(false);

  const byHour = new Map<number, LocationFacilityTime>();
  for (const slot of dedupeSlotsByStart(times).values()) {
    const start = timeIndex(slot.start_time_value);
    if (start >= HOUR_COUNT) continue; // unrecognised or past the last bookable hour
    const existing = byHour.get(start);
    if (!existing || isPreferredSlot(slot, existing)) byHour.set(start, slot);
  }

  let hour = 0;
  while (hour < HOUR_COUNT) {
    const slot = byHour.get(hour);
    if (!slot) {
      hour++;
      continue;
    }
    const span = Math.min(slotSpan(slot), HOUR_COUNT - hour);
    if (slot.slot_available) {
      for (let h = hour; h < hour + span; h++) hours[h] = true;
    }
    hour += span;
  }

  return hours;
}

/**
 * Clamp a time-range filter to a half-open [start, end) span of hour indices.
 * `endTime` is the hour play would finish, so it is not itself a playable hour.
 */
function rangeBounds(
  startTime: string | null,
  endTime: string | null
): { from: number; to: number } {
  const start = startTime ? timeIndex(startTime) : 0;
  const end = endTime ? timeIndex(endTime) : HOUR_COUNT;
  return {
    from: start < HOUR_COUNT ? start : 0,
    to: end < HOUR_COUNT ? end : HOUR_COUNT,
  };
}

export function hasConsecutiveSlots(
  times: LocationFacilityTime[],
  minSlots: number
): boolean {
  return hasConsecutiveSlotsInRange(times, minSlots, null, null);
}

export function hasConsecutiveSlotsInRange(
  times: LocationFacilityTime[],
  minSlots: number,
  startTime: string | null,
  endTime: string | null
): boolean {
  if (minSlots <= 0) return true;

  const hours = buildHourAvailability(times);
  const { from, to } = rangeBounds(startTime, endTime);

  let run = 0;
  for (let hour = from; hour < to; hour++) {
    run = hours[hour] ? run + 1 : 0;
    if (run >= minSlots) return true;
  }
  return false;
}

/**
 * The most courts at one venue that are free for the SAME run of `minSlots`
 * hours inside the range.
 *
 * Counting courts that each pass hasConsecutiveSlotsInRange separately is not
 * the same question: two courts can qualify on windows that never overlap,
 * which is no use to a group that needs both courts at once.
 */
export function countCourtsWithSharedWindow(
  courtTimes: LocationFacilityTime[][],
  minSlots: number,
  startTime: string | null,
  endTime: string | null
): number {
  const slots = Math.max(1, minSlots);
  const availability = courtTimes.map(buildHourAvailability);
  const { from, to } = rangeBounds(startTime, endTime);

  let best = 0;
  for (let windowStart = from; windowStart + slots <= to; windowStart++) {
    let free = 0;
    for (const hours of availability) {
      let coversWindow = true;
      for (let hour = windowStart; hour < windowStart + slots; hour++) {
        if (!hours[hour]) {
          coversWindow = false;
          break;
        }
      }
      if (coversWindow) free++;
    }
    if (free > best) best = free;
  }
  return best;
}

export { TIME_ORDER };
