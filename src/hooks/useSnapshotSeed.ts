import { useEffect, useState } from 'react';
import { fetchSnapshot } from '../utils/snapshot';
import { seedFacility } from '../utils/facilityCache';

interface UseSnapshotSeedReturn {
  /**
   * True once the snapshot attempt has settled, whether it succeeded or not.
   * The sweep waits on this so it can start from seeded data instead of
   * starting empty and restarting when the snapshot lands.
   */
  ready: boolean;
  /** When the snapshot was swept, for telling the user how old it is. */
  generatedAt: number | null;
  error: string | null;
}

/**
 * Loads the published snapshot once at mount and seeds the facility cache with
 * it, so the grid renders immediately rather than after a full live sweep.
 *
 * Entries are seeded with the snapshot's own sweep time, which makes them read
 * as stale — so they are shown at once and still refetched. A missing or
 * unreadable snapshot is not an error the user needs to see: the app simply
 * behaves as it did before this existed.
 */
export function useSnapshotSeed(): UseSnapshotSeedReturn {
  const [ready, setReady] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    fetchSnapshot(controller.signal)
      .then(snapshot => {
        if (cancelled) return;
        if (snapshot) {
          snapshot.byDate.forEach((venues, date) => {
            venues.forEach((courts, locationId) => {
              seedFacility(snapshot.sport, date, locationId, courts, snapshot.generatedAt);
            });
          });
          setGeneratedAt(snapshot.generatedAt);
        } else {
          setError('No usable snapshot');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Snapshot unavailable');
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return { ready, generatedAt, error };
}
