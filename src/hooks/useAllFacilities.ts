import { useState, useEffect } from 'react';
import { readFacility, readStaleFacility, writeFacility } from '../utils/facilityCache';
import type { LocationFacility, LocationData, SportCategory } from '../types';

interface LocationCourtGroup {
  location_id: string;
  location_name: string;
  courts: LocationFacility[];
}

interface UseAllFacilitiesReturn {
  results: LocationCourtGroup[];
  loading: boolean;
  progress: number; // 0-100
  loadedCount: number;
  totalCount: number;
  failedCount: number;
  error: string | null;
}

export function useAllFacilities(
  locations: LocationData[],
  date: string,
  enabled: boolean,
  sport: SportCategory,
  refreshKey = 0
): UseAllFacilitiesReturn {
  const [results, setResults] = useState<LocationCourtGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !date || locations.length === 0) {
      setResults([]);
      setProgress(0);
      setLoadedCount(0);
      setFailedCount(0);
      return;
    }

    // Each effect invocation gets its own cancelled flag.
    // Using a ref shared across invocations was broken under React StrictMode:
    // the second invocation would reset the flag, allowing the first (stale)
    // async loop to continue appending results alongside the second one.
    let cancelled = false;
    let failed = 0;

    /*
      Show everything we already have before touching the network, then refresh
      what is not current. Fresh entries are displayed and skipped; stale ones —
      an expired cache entry, or a venue seeded from the published snapshot —
      are displayed AND refetched, so a visitor sees the city immediately
      instead of a multi-minute progress bar, and the numbers correct themselves
      as the live sweep lands.

      Keyed by location_id rather than appended, because a stale venue is
      already on screen when its fresh copy arrives and must be replaced in
      place rather than listed twice.
    */
    const groups = new Map<string, LocationCourtGroup>();
    const pending: LocationData[] = [];
    let freshCount = 0;

    locations.forEach(loc => {
      const fresh = readFacility(sport, date, loc.location_id);
      const courts = fresh ?? readStaleFacility(sport, date, loc.location_id);
      if (courts) {
        groups.set(loc.location_id, {
          location_id: loc.location_id,
          location_name: loc.location_name,
          courts,
        });
      }
      if (fresh) freshCount++;
      else pending.push(loc);
    });

    // Progress counts venues confirmed fresh this run, not venues on screen —
    // otherwise seeding from a snapshot would report 100% before a single
    // request had been made.
    const publish = () => {
      setResults([...groups.values()]);
      setLoadedCount(freshCount);
      setProgress(Math.round((freshCount / locations.length) * 100));
    };

    setError(null);
    setFailedCount(0);
    publish();

    if (pending.length === 0) {
      setLoading(false);
      return;
    }

    const fetchPending = async () => {
      try {
        setLoading(true);

        const batchSize = 10;

        for (let i = 0; i < pending.length; i += batchSize) {
          if (cancelled) break;

          const batch = pending.slice(i, i + batchSize);

          // One location's failure must not reject the batch, but it is tracked
          // rather than swallowed: an unreachable venue looks exactly like a
          // fully booked one otherwise, and a total outage would read as
          // "no courts found" with no error anywhere.
          const batchPromises = batch.map(loc =>
            fetch(
              `https://apihub.dbkl.gov.my/api/public/v1/location/facility?sub_category=${encodeURIComponent(sport)}&location_id=${loc.location_id}&search_date=${date}`
            )
              .then(res => {
                if (!res.ok) throw new Error(`API error: ${res.status}`);
                return res.json();
              })
              .then(data => {
                const courts = (data.success && data.data?.data
                  ? data.data.data
                  : []) as LocationFacility[];
                writeFacility(sport, date, loc.location_id, courts);
                return {
                  failed: false,
                  group: {
                    location_id: loc.location_id,
                    location_name: loc.location_name,
                    courts,
                  },
                };
              })
              .catch(() => ({
                failed: true,
                group: {
                  location_id: loc.location_id,
                  location_name: loc.location_name,
                  courts: [] as LocationFacility[],
                },
              }))
          );

          const batchResults = await Promise.all(batchPromises);

          if (!cancelled) {
            batchResults.forEach(r => {
              // A failed refresh keeps whatever was already on screen: showing
              // a venue's slightly stale slots beats blanking it to nothing.
              if (r.failed && groups.has(r.group.location_id)) return;
              groups.set(r.group.location_id, r.group);
              if (!r.failed) freshCount++;
            });
            failed += batchResults.filter(r => r.failed).length;
            setFailedCount(failed);
            publish();
          }

          if (i + batchSize < pending.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }

        if (!cancelled) {
          setProgress(100);
          // Only a total wipeout is a hard error. If anything was served from
          // cache there is still a usable view, and the partial-failure notice
          // says so rather than replacing it with an error card.
          if (failed === locations.length) {
            setError('Could not reach the DBKL booking service. Check your connection and try again.');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch facilities');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchPending();

    return () => {
      cancelled = true;
    };
  }, [locations, date, enabled, sport, refreshKey]);

  return { results, loading, progress, loadedCount, totalCount: locations.length, failedCount, error };
}
