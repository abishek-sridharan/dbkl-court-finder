import { useState, useEffect, useRef } from 'react';
import type { LocationFacility, SportCategory } from '../types';

interface UseFacilityReturn {
  courts: LocationFacility[];
  loading: boolean;
  error: string | null;
}

export function useFacility(
  locationId: string | null,
  date: string | null,
  sport: SportCategory,
  refreshKey = 0
): UseFacilityReturn {
  const [courts, setCourts] = useState<LocationFacility[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!locationId || !date) {
      setCourts([]);
      lastTargetRef.current = null;
      return;
    }

    // Drop the previous venue's rows as soon as the target changes, so its
    // availability is never on screen under a different venue's name. A refresh
    // of the same target keeps its rows rather than flashing the loading state.
    const target = `${locationId}|${date}|${sport}`;
    if (lastTargetRef.current !== target) {
      lastTargetRef.current = target;
      setCourts([]);
    }

    // Each effect invocation gets its own cancelled flag so a slow response for
    // a previous venue can never overwrite the current one's courts.
    let cancelled = false;

    const fetchFacility = async () => {
      try {
        setLoading(true);
        // Clear the previous error up front so a retry visibly returns to the
        // loading state instead of leaving the error card sitting there.
        setError(null);
        const response = await fetch(
          `https://apihub.dbkl.gov.my/api/public/v1/location/facility?sub_category=${encodeURIComponent(sport)}&location_id=${locationId}&search_date=${date}`
        );
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        const data = await response.json();
        if (cancelled) return;

        // An empty or unsuccessful payload means this venue has nothing to show —
        // keeping the previous courts would misattribute them to this venue.
        setCourts(data.success && data.data?.data ? data.data.data : []);
      } catch (err) {
        if (!cancelled) {
          setCourts([]);
          setError(err instanceof Error ? err.message : 'Failed to fetch facility data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchFacility();

    return () => {
      cancelled = true;
    };
  }, [locationId, date, sport, refreshKey]);

  return { courts, loading, error };
}
