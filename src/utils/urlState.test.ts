import { describe, expect, it } from 'vitest';
import {
  buildFilterQuery,
  defaultFilterState,
  parseFilterState,
  type FilterState,
} from './urlState';

const TODAY = '2026-08-25';

describe('parseFilterState', () => {
  it('returns defaults for an empty query', () => {
    expect(parseFilterState('', TODAY)).toEqual(defaultFilterState(TODAY));
  });

  it('reads a full filter set', () => {
    const s = parseFilterState(
      '?sport=FUTSAL&date=2026-08-27&loc=74&near=1&hrs=3&courts=2&from=6:00 PM&to=9:00 PM',
      TODAY,
    );
    expect(s).toEqual({
      sport: 'FUTSAL',
      date: '2026-08-27',
      locationId: '74',
      nearMeOnly: true,
      minConsecutiveSlots: 3,
      minCourtsNeeded: 2,
      timeRangeStart: '6:00 PM',
      timeRangeEnd: '9:00 PM',
    });
  });

  /*
    A shared link is hand-editable and can be months old, so every field has to
    degrade to something usable rather than throwing or rendering a broken view.
  */
  describe('hostile input falls back instead of breaking', () => {
    it('rejects an unknown sport', () => {
      expect(parseFilterState('?sport=QUIDDITCH', TODAY).sport).toBe('BADMINTON');
    });

    it('rejects a past date', () => {
      expect(parseFilterState('?date=2020-01-01', TODAY).date).toBe(TODAY);
    });

    it('rejects a date beyond the bookable window', () => {
      expect(parseFilterState('?date=2027-01-01', TODAY).date).toBe(TODAY);
    });

    it('accepts the last bookable day but not the one after', () => {
      expect(parseFilterState('?date=2026-09-15', TODAY).date).toBe('2026-09-15');
      expect(parseFilterState('?date=2026-09-16', TODAY).date).toBe(TODAY);
    });

    it('rejects a malformed date', () => {
      expect(parseFilterState('?date=tomorrow', TODAY).date).toBe(TODAY);
    });

    it('clamps out-of-range numbers rather than trusting them', () => {
      expect(parseFilterState('?hrs=999', TODAY).minConsecutiveSlots).toBe(16);
      expect(parseFilterState('?hrs=0', TODAY).minConsecutiveSlots).toBe(1);
      expect(parseFilterState('?hrs=-5', TODAY).minConsecutiveSlots).toBe(1);
      expect(parseFilterState('?courts=999', TODAY).minCourtsNeeded).toBe(20);
      expect(parseFilterState('?hrs=abc', TODAY).minConsecutiveSlots).toBe(2);
    });

    it('rejects a time that is not a bookable hour', () => {
      expect(parseFilterState('?from=3:30 PM', TODAY).timeRangeStart).toBeNull();
      expect(parseFilterState('?from=12:00 AM', TODAY).timeRangeStart).toBeNull();
    });

    it('drops an end that does not come after its start', () => {
      const s = parseFilterState('?from=8:00 PM&to=6:00 PM', TODAY);
      expect(s.timeRangeStart).toBe('8:00 PM');
      expect(s.timeRangeEnd).toBeNull();
    });

    it('drops an end with no start, which the picker cannot represent', () => {
      expect(parseFilterState('?to=9:00 PM', TODAY).timeRangeEnd).toBeNull();
    });

    it('treats any near value other than 1 as off', () => {
      expect(parseFilterState('?near=1', TODAY).nearMeOnly).toBe(true);
      expect(parseFilterState('?near=true', TODAY).nearMeOnly).toBe(false);
      expect(parseFilterState('?near=0', TODAY).nearMeOnly).toBe(false);
    });
  });
});

describe('buildFilterQuery', () => {
  it('emits nothing for a default view, so a fresh page has a clean URL', () => {
    expect(buildFilterQuery(defaultFilterState(TODAY), TODAY)).toBe('');
  });

  it('omits fields still at their default', () => {
    const q = buildFilterQuery({ ...defaultFilterState(TODAY), locationId: '74' }, TODAY);
    expect(q).toBe('loc=74');
  });

  it('never emits an end time without its start', () => {
    const q = buildFilterQuery(
      { ...defaultFilterState(TODAY), timeRangeStart: null, timeRangeEnd: '9:00 PM' },
      TODAY,
    );
    expect(q).toBe('');
  });
});

/*
  The property that makes sharing trustworthy: whatever the sender was looking
  at is what the recipient sees. Anything that survives build->parse must be
  identical, for every field and combination.
*/
describe('round trip', () => {
  const cases: FilterState[] = [
    defaultFilterState(TODAY),
    { ...defaultFilterState(TODAY), sport: 'PICKLEBALL' },
    { ...defaultFilterState(TODAY), date: '2026-09-01' },
    { ...defaultFilterState(TODAY), locationId: '117', nearMeOnly: true },
    { ...defaultFilterState(TODAY), minConsecutiveSlots: 4, minCourtsNeeded: 3 },
    { ...defaultFilterState(TODAY), timeRangeStart: '6:00 PM', timeRangeEnd: '10:00 PM', minConsecutiveSlots: 4 },
    { ...defaultFilterState(TODAY), timeRangeStart: '8:00 AM', timeRangeEnd: null },
    {
      sport: 'SQUASH',
      date: '2026-08-30',
      locationId: '43',
      nearMeOnly: true,
      minConsecutiveSlots: 16,
      minCourtsNeeded: 20,
      timeRangeStart: '11:00 AM',
      timeRangeEnd: '10:00 PM',
    },
  ];

  it.each(cases)('survives build → parse: %o', (state) => {
    expect(parseFilterState(buildFilterQuery(state, TODAY), TODAY)).toEqual(state);
  });

  it('is stable across repeated round trips', () => {
    const start = cases[cases.length - 1];
    const once = parseFilterState(buildFilterQuery(start, TODAY), TODAY);
    const twice = parseFilterState(buildFilterQuery(once, TODAY), TODAY);
    expect(twice).toEqual(once);
  });
});
