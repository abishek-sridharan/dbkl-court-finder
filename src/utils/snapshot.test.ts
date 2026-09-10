import { describe, expect, it } from 'vitest';
import { parseSnapshot } from './snapshot';
import { hasConsecutiveSlotsInRange } from './consecutiveSlots';

/*
  The snapshot is fetched from a URL this app does not control at runtime, so
  every case here is really one question: can a bad payload make the grid lie?
  A malformed or stale snapshot must degrade to "no snapshot", never to wrong
  availability, because a seeded venue is rendered before any live data arrives.
*/

const NOW = Date.parse('2026-09-10T12:00:00Z');

function snapshotFile(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    sport: 'BADMINTON',
    generatedAt: '2026-09-10T11:30:00Z',
    dates: ['2026-09-10'],
    byDate: {
      '2026-09-10': [
        {
          id: '117',
          n: 'TLKB DEWAN SERBAGUNA JELATEK',
          c: [
            {
              i: '501',
              v: 'COURT 1',
              t: [
                ['9', '10', '8:00 AM', '9:00 AM', 1, '10.0'],
                ['10', '11', '9:00 AM', '10:00 AM', 0, '10.0'],
              ],
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe('parseSnapshot', () => {
  it('expands the compact tuples into the shape the app already renders', () => {
    const parsed = parseSnapshot(snapshotFile(), NOW);
    expect(parsed).not.toBeNull();

    const courts = parsed!.byDate.get('2026-09-10')!.get('117')!;
    expect(courts).toHaveLength(1);

    const court = courts[0];
    expect(court.location_id).toBe('117');
    expect(court.location_name).toBe('TLKB DEWAN SERBAGUNA JELATEK');
    expect(court.venue_name).toBe('COURT 1');
    expect(court.sub_category_name).toBe('BADMINTON');

    const [first, second] = court.location_facility_times;
    expect(first.start_time_value).toBe('8:00 AM');
    expect(first.end_time_value).toBe('9:00 AM');
    expect(first.slot_available).toBe(true);
    expect(first.price).toBe('10.0');
    expect(second.slot_available).toBe(false);
  });

  it('produces records the availability filter can read', () => {
    // The point of the round-trip: expanded slots must work with the existing
    // logic untouched, or a seeded venue would filter differently from a
    // freshly fetched one.
    const parsed = parseSnapshot(snapshotFile(), NOW)!;
    const court = parsed.byDate.get('2026-09-10')!.get('117')![0];
    expect(hasConsecutiveSlotsInRange(court.location_facility_times, 1, null, null)).toBe(true);
    expect(hasConsecutiveSlotsInRange(court.location_facility_times, 2, null, null)).toBe(false);
  });

  it('gives each expanded slot a distinct id', () => {
    const parsed = parseSnapshot(snapshotFile(), NOW)!;
    const times = parsed.byDate.get('2026-09-10')!.get('117')![0].location_facility_times;
    expect(new Set(times.map(t => t.id)).size).toBe(times.length);
  });

  describe('rejects anything it cannot trust', () => {
    it('a version it does not recognise', () => {
      expect(parseSnapshot(snapshotFile({ version: 2 }), NOW)).toBeNull();
      expect(parseSnapshot(snapshotFile({ version: undefined }), NOW)).toBeNull();
    });

    it('a snapshot older than the staleness limit', () => {
      const old = snapshotFile({ generatedAt: '2026-09-09T12:00:00Z' }); // 24h
      expect(parseSnapshot(old, NOW)).toBeNull();
    });

    it('an unparseable timestamp', () => {
      expect(parseSnapshot(snapshotFile({ generatedAt: 'never' }), NOW)).toBeNull();
    });

    it('junk in place of a payload', () => {
      expect(parseSnapshot(null, NOW)).toBeNull();
      expect(parseSnapshot('a string', NOW)).toBeNull();
      expect(parseSnapshot(42, NOW)).toBeNull();
      expect(parseSnapshot({}, NOW)).toBeNull();
      expect(parseSnapshot([], NOW)).toBeNull();
    });

    it('a missing byDate map', () => {
      expect(parseSnapshot(snapshotFile({ byDate: null }), NOW)).toBeNull();
    });
  });

  it('accepts a snapshot right up to the staleness limit', () => {
    // 11h59m old — still inside the 12h window.
    const almost = snapshotFile({ generatedAt: new Date(NOW - 11 * 3600_000 - 59 * 60_000).toISOString() });
    expect(parseSnapshot(almost, NOW)).not.toBeNull();
  });

  it('skips malformed venues without discarding the whole snapshot', () => {
    const mixed = snapshotFile({
      byDate: {
        '2026-09-10': [
          { id: '', n: 'no id', c: [] },
          { id: '9', n: 'no courts array' },
          { id: '117', n: 'Good Venue', c: [{ i: '1', v: 'COURT 1', t: [] }] },
        ],
      },
    });
    const parsed = parseSnapshot(mixed, NOW);
    const forDate = parsed!.byDate.get('2026-09-10')!;
    expect(forDate.has('117')).toBe(true);
    expect(forDate.size).toBe(1);
  });

  it('ignores a date whose value is not a list', () => {
    const parsed = parseSnapshot(
      snapshotFile({ byDate: { '2026-09-10': 'nonsense' } }),
      NOW,
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.byDate.size).toBe(0);
  });
});
