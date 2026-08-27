import { describe, expect, it } from 'vitest';
import {
  countCourtsWithSharedWindow,
  dedupeSlotsByStart,
  hasConsecutiveSlots,
  hasConsecutiveSlotsInRange,
  HOUR_COUNT,
  shortTimeLabel,
  slotSpan,
  timeIndex,
  TIME_ORDER,
  type LocationFacilityTime,
} from './consecutiveSlots';

/*
  These cases are drawn from what DBKL's API actually returns, not from what a
  booking API might reasonably be expected to return. The awkward ones — a venue
  selling its evening only as 2-hour blocks while marking every 1-hour record
  inside them booked, ids that wrap at midnight, an end time of "1:00 AM" — are
  all real shapes observed live, and each of them broke this module at some
  point. They are here so they cannot break it again silently.
*/

/** Build a slot record. Ids follow DBKL's scheme, which wraps at midnight. */
function slot(
  start: string,
  end: string,
  available: boolean,
  overrides: Partial<LocationFacilityTime> = {},
): LocationFacilityTime {
  const startId = TIME_ORDER.indexOf(start) + 9;
  const endId = ((TIME_ORDER.indexOf(end) + 9 - 1) % 24) + 1;
  return {
    id: `${start}|${end}|${available}`,
    location_facility_id: '1',
    start_time_id: String(startId),
    end_time_id: String(endId),
    start_time_value: start,
    end_time_value: end,
    price: '8.0',
    is_active: '1',
    slot_available: available,
    ...overrides,
  };
}

/** A full day of one-hour records, free at the hours named. */
function dayWithFreeHours(...freeStarts: string[]): LocationFacilityTime[] {
  return TIME_ORDER.slice(0, HOUR_COUNT).map((start, i) =>
    slot(start, TIME_ORDER[i + 1], freeStarts.includes(start)),
  );
}

describe('TIME_ORDER and HOUR_COUNT', () => {
  it('covers 8 AM to midnight with the last entry as an end time only', () => {
    expect(TIME_ORDER[0]).toBe('8:00 AM');
    expect(TIME_ORDER[TIME_ORDER.length - 1]).toBe('12:00 AM');
    expect(HOUR_COUNT).toBe(TIME_ORDER.length - 1);
    expect(HOUR_COUNT).toBe(16);
  });

  it('returns a sentinel past the end for unrecognised times', () => {
    expect(timeIndex('8:00 AM')).toBe(0);
    expect(timeIndex('12:00 AM')).toBe(HOUR_COUNT);
    expect(timeIndex('1:00 AM')).toBeGreaterThan(HOUR_COUNT);
    expect(timeIndex('nonsense')).toBeGreaterThan(HOUR_COUNT);
  });
});

describe('shortTimeLabel', () => {
  it('keeps a meridiem letter so no two columns share a label', () => {
    const labels = TIME_ORDER.slice(0, HOUR_COUNT).map(shortTimeLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('formats morning and evening distinctly', () => {
    expect(shortTimeLabel('8:00 AM')).toBe('8a');
    expect(shortTimeLabel('8:00 PM')).toBe('8p');
    expect(shortTimeLabel('12:00 PM')).toBe('12p');
  });

  it('passes through anything it does not recognise', () => {
    expect(shortTimeLabel('half past four')).toBe('half past four');
  });
});

describe('slotSpan', () => {
  it('measures a one-hour record as one column', () => {
    expect(slotSpan(slot('6:00 PM', '7:00 PM', true))).toBe(1);
  });

  it('measures a two-hour record as two columns', () => {
    expect(slotSpan(slot('6:00 PM', '8:00 PM', true))).toBe(2);
  });

  it('handles the midnight record whose ids run backwards', () => {
    // 10 PM is id 23 and 12 AM is id 1, so id arithmetic gives -22.
    const midnight = slot('10:00 PM', '12:00 AM', true);
    expect(Number(midnight.end_time_id) - Number(midnight.start_time_id)).toBeLessThan(0);
    expect(slotSpan(midnight)).toBe(2);
  });

  it('clamps an end time outside TIME_ORDER to a single column', () => {
    // One venue really does publish "12:00 PM -> 1:00 AM". Left unclamped this
    // swallowed the rest of the row.
    expect(slotSpan(slot('12:00 PM', '1:00 AM', false, { end_time_id: '2' }))).toBe(1);
  });

  it('never returns less than one column, whatever the record says', () => {
    /*
      buildHourAvailability advances its cursor by this value. A span of zero or
      less would leave it stuck or moving backwards, which hangs the tab rather
      than merely showing something wrong — so the floor is a contract, not a
      nicety.
    */
    const nonsense: LocationFacilityTime[] = [
      slot('6:00 PM', '6:00 PM', true),
      slot('6:00 PM', '9:00 AM', true),
      slot('12:00 AM', '8:00 AM', true),
      slot('nope', 'also nope', true),
      slot('10:00 PM', '1:00 AM', true, { end_time_id: '2' }),
    ];
    for (const record of nonsense) {
      expect(slotSpan(record)).toBeGreaterThanOrEqual(1);
    }
  });

  it('terminates on records that would send the cursor backwards', () => {
    // Guards the loop itself rather than slotSpan's return value.
    const backwards = slot('10:00 PM', '12:00 AM', true, {
      start_time_id: '23',
      end_time_id: '1',
    });
    expect(hasConsecutiveSlotsInRange([backwards], 2, null, null)).toBe(true);
  });
});

describe('dedupeSlotsByStart', () => {
  it('keeps the shorter record when both say the same thing', () => {
    const oneHour = slot('6:00 PM', '7:00 PM', true);
    const twoHour = slot('6:00 PM', '8:00 PM', true);
    const kept = dedupeSlotsByStart([twoHour, oneHour]).get(oneHour.start_time_id);
    expect(kept).toBe(oneHour);
  });

  it('prefers the bookable record over a shorter unavailable one', () => {
    /*
      Several venues sell the evening only in 2-hour blocks and mark every
      1-hour record inside them booked, at a higher price. Preferring the
      shorter record there paints a court that is free all evening as full.
    */
    const oneHourBooked = slot('6:00 PM', '7:00 PM', false, { price: '30.0' });
    const twoHourFree = slot('6:00 PM', '8:00 PM', true, { price: '16.0' });
    const kept = dedupeSlotsByStart([oneHourBooked, twoHourFree]).get(oneHourBooked.start_time_id);
    expect(kept).toBe(twoHourFree);
  });

  it('does not depend on the order records arrive in', () => {
    const booked = slot('6:00 PM', '7:00 PM', false);
    const free = slot('6:00 PM', '8:00 PM', true);
    const forwards = dedupeSlotsByStart([booked, free]).get(booked.start_time_id);
    const backwards = dedupeSlotsByStart([free, booked]).get(booked.start_time_id);
    expect(forwards).toBe(free);
    expect(backwards).toBe(free);
  });

  it('keeps one entry per start time', () => {
    const records = [
      slot('6:00 PM', '7:00 PM', false),
      slot('6:00 PM', '8:00 PM', true),
      slot('7:00 PM', '8:00 PM', true),
    ];
    expect(dedupeSlotsByStart(records).size).toBe(2);
  });
});

describe('hasConsecutiveSlotsInRange', () => {
  it('counts hours, not array entries: one 2-hour record satisfies a 2-hour filter', () => {
    // The original bug. A single record counted as a run of one, so a court
    // whose only free block was 6-8 PM was hidden from the default filter.
    expect(hasConsecutiveSlotsInRange([slot('6:00 PM', '8:00 PM', true)], 2, null, null)).toBe(true);
  });

  it('does not treat a gap between records as consecutive', () => {
    // Adjacent in the array, hours apart in the day.
    const times = [slot('8:00 AM', '9:00 AM', true), slot('10:00 PM', '11:00 PM', true)];
    expect(hasConsecutiveSlotsInRange(times, 2, null, null)).toBe(false);
    expect(hasConsecutiveSlotsInRange(times, 1, null, null)).toBe(true);
  });

  it('is not derailed by a booked multi-hour record overlapping free hours', () => {
    const times = [
      slot('6:00 PM', '7:00 PM', true),
      slot('6:00 PM', '8:00 PM', false),
      slot('7:00 PM', '8:00 PM', true),
    ];
    expect(hasConsecutiveSlotsInRange(times, 2, null, null)).toBe(true);
  });

  it('reads a venue that only sells 2-hour evening blocks as free', () => {
    const times = [
      slot('6:00 PM', '7:00 PM', false, { price: '30.0' }),
      slot('6:00 PM', '8:00 PM', true, { price: '16.0' }),
      slot('7:00 PM', '8:00 PM', false, { price: '30.0' }),
    ];
    expect(hasConsecutiveSlotsInRange(times, 2, null, null)).toBe(true);
  });

  it('spans midnight', () => {
    expect(hasConsecutiveSlotsInRange([slot('10:00 PM', '12:00 AM', true)], 2, null, null)).toBe(true);
  });

  it('ignores a record whose end time is outside the day', () => {
    const malformed = slot('12:00 PM', '1:00 AM', true, { end_time_id: '2' });
    // Clamped to one hour, so it cannot satisfy a two-hour requirement.
    expect(hasConsecutiveSlotsInRange([malformed], 1, null, null)).toBe(true);
    expect(hasConsecutiveSlotsInRange([malformed], 2, null, null)).toBe(false);
  });

  it('returns false when everything is booked', () => {
    expect(hasConsecutiveSlotsInRange(dayWithFreeHours(), 1, null, null)).toBe(false);
  });

  it('returns false for an empty record list', () => {
    expect(hasConsecutiveSlotsInRange([], 1, null, null)).toBe(false);
  });

  describe('time window', () => {
    const times = dayWithFreeHours('6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM');

    it('finds a run inside the window', () => {
      expect(hasConsecutiveSlotsInRange(times, 2, '6:00 PM', '8:00 PM')).toBe(true);
    });

    it('treats the end of the window as exclusive', () => {
      // 8 PM to 9 PM asks for the single 8-9 hour, which is free.
      expect(hasConsecutiveSlotsInRange(times, 1, '8:00 PM', '9:00 PM')).toBe(true);
      // 10 PM to 11 PM asks for an hour that is not.
      expect(hasConsecutiveSlotsInRange(times, 1, '10:00 PM', '11:00 PM')).toBe(false);
    });

    it('ignores free hours outside the window', () => {
      expect(hasConsecutiveSlotsInRange(times, 1, '8:00 AM', '12:00 PM')).toBe(false);
    });

    it('cannot be satisfied when the run is wider than the window', () => {
      expect(hasConsecutiveSlotsInRange(times, 4, '6:00 PM', '8:00 PM')).toBe(false);
    });

    it('treats an open-ended window as running to the end of the day', () => {
      expect(hasConsecutiveSlotsInRange(times, 2, '6:00 PM', null)).toBe(true);
    });
  });

  it('hasConsecutiveSlots matches the unbounded range', () => {
    const times = dayWithFreeHours('6:00 PM', '7:00 PM');
    expect(hasConsecutiveSlots(times, 2)).toBe(hasConsecutiveSlotsInRange(times, 2, null, null));
    expect(hasConsecutiveSlots(times, 3)).toBe(hasConsecutiveSlotsInRange(times, 3, null, null));
  });
});

describe('countCourtsWithSharedWindow', () => {
  const evening = dayWithFreeHours('6:00 PM', '7:00 PM');
  const lateNight = dayWithFreeHours('9:00 PM', '10:00 PM');

  it('counts courts free at the same time, not courts free at any time', () => {
    // Two courts, two hours each, but never together — useless to one group.
    expect(countCourtsWithSharedWindow([evening, lateNight], 2, null, null)).toBe(1);
  });

  it('counts both when the windows overlap', () => {
    expect(countCourtsWithSharedWindow([evening, dayWithFreeHours('6:00 PM', '7:00 PM')], 2, null, null)).toBe(2);
  });

  it('returns zero when the requirement is wider than the window', () => {
    expect(countCourtsWithSharedWindow([evening], 4, '6:00 PM', '8:00 PM')).toBe(0);
  });

  it('returns zero for no courts', () => {
    expect(countCourtsWithSharedWindow([], 1, null, null)).toBe(0);
  });

  /*
    The venue list and the court rows are derived from these two functions
    separately, so they have to agree: a venue qualifies for one court exactly
    when at least one of its courts passes the per-court filter. If they drift,
    venues appear with no rows under them, or rows appear under no venue.
  */
  it('agrees with hasConsecutiveSlotsInRange when one court is enough', () => {
    const courts = [evening, lateNight, dayWithFreeHours(), dayWithFreeHours('8:00 AM')];
    for (const minSlots of [1, 2, 3]) {
      for (const [start, end] of [
        [null, null],
        ['6:00 PM', '10:00 PM'],
        ['8:00 AM', '12:00 PM'],
      ] as [string | null, string | null][]) {
        const anyCourtPasses = courts.some((c) =>
          hasConsecutiveSlotsInRange(c, minSlots, start, end),
        );
        const shared = countCourtsWithSharedWindow(courts, minSlots, start, end) >= 1;
        expect(shared).toBe(anyCourtPasses);
      }
    }
  });
});
