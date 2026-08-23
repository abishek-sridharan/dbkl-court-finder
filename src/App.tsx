import { useState, useMemo, useCallback } from 'react';
import './App.css';
import { FilterBar } from './components/FilterBar';
import { TimelineView } from './components/TimelineView';
import { ThemeToggle } from './components/ThemeToggle';
import { useLocations } from './hooks/useLocations';
import { useFacility } from './hooks/useFacility';
import { useAllFacilities } from './hooks/useAllFacilities';
import { useUserLocation } from './hooks/useUserLocation';
import { useLocationDetails } from './hooks/useLocationDetails';
import { useMediaQuery } from './hooks/useMediaQuery';
import { haversineKm, formatDistance, roadDistanceKm } from './utils/distance';
import { todayLocalIso } from './utils/date';
import { clearFacilityCache } from './utils/facilityCache';
import { HOUR_COUNT, timeIndex } from './utils/consecutiveSlots';
import { SPORT_OPTIONS } from './types';
import type { SportCategory } from './types';
import { Analytics } from '@vercel/analytics/react';

const NEAR_ME_MAX_KM = 10;

function App() {
  const isSmUp = useMediaQuery('(min-width: 640px)');

  const [sport, setSportRaw] = useState<SportCategory>('BADMINTON');
  const [date, setDate] = useState(todayLocalIso);
  const [locationId, setLocationId] = useState('');
  const [nearMeOnly, setNearMeOnly] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset location when sport changes — previous location may not offer the new sport
  const handleSportChange = useCallback((newSport: SportCategory) => {
    setSportRaw(newSport);
    setLocationId('');
  }, []);
  const [minConsecutiveSlots, setMinConsecutiveSlots] = useState(2);
  const [minCourtsNeeded, setMinCourtsNeeded] = useState(1);
  const [timeRangeStart, setTimeRangeStart] = useState<string | null>(null);
  const [timeRangeEnd, setTimeRangeEnd] = useState<string | null>(null);

  /*
    The time range moves as one value, not two.

    Both endpoints often change in a single tap — picking an earlier end swaps
    them, clearing resets both — and when they were separate setters each one
    read the other from the render it was created in. So "Clear" never reset the
    minimum-hours filter (each setter still saw the other endpoint as set), and
    selecting the endpoints in reverse order skipped the sync entirely. Taking
    both values at once removes the stale read, and with it that whole class of
    bug.
  */
  const handleTimeRangeChange = useCallback(
    (start: string | null, end: string | null) => {
      setTimeRangeStart(start);
      setTimeRangeEnd(end);

      if (start && end) {
        // A closed window states the intent outright: play the whole span.
        const span = timeIndex(end) - timeIndex(start);
        if (span > 0) setMinConsecutiveSlots(Math.min(span, HOUR_COUNT));
      } else if (!start && !end) {
        setMinConsecutiveSlots(1);
      }
      // A lone start leaves the minimum alone — there is no span to read from
      // it, and silently rewriting the user's number would be worse than
      // leaving it.
    },
    [],
  );

  // Refresh must drop the cache first, or the refetch would just serve the same
  // cached courts back and the button would appear to do nothing.
  const handleRefresh = useCallback(() => {
    clearFacilityCache();
    setRefreshKey(k => k + 1);
  }, []);

  const { locations, loading: locationsLoading, error: locationsError } = useLocations(sport);

  const isAllLocations = locationId === '';
  const singleFacility = useFacility(isAllLocations ? null : locationId, date, sport, refreshKey);
  const allFacilities = useAllFacilities(locations, date, isAllLocations, sport, refreshKey);

  const activeCourts = useMemo(() => {
    if (isAllLocations) {
      return allFacilities.results.flatMap(group =>
        group.courts.map(court => ({
          ...court,
          location_name: group.location_name,
          location_id: group.location_id,
        }))
      );
    }
    return singleFacility.courts;
  }, [isAllLocations, singleFacility.courts, allFacilities.results]);

  // Count the venue-list fetch as loading too. Without it the all-locations hook
  // has nothing to work with yet and reports "not loading", so the "no courts
  // found" empty state flashes before the list has even arrived.
  const courtsLoading =
    locationsLoading || (isAllLocations ? allFacilities.loading : singleFacility.loading);
  // A failed venue list leaves every other request with nothing to ask for, so
  // it has to surface — otherwise it reads as "no courts match your filters".
  const courtsError =
    locationsError ?? (isAllLocations ? allFacilities.error : singleFacility.error);
  const loadedCount = isAllLocations ? allFacilities.loadedCount : 0;
  const totalCount = isAllLocations ? allFacilities.totalCount : 0;
  const failedCount = isAllLocations ? allFacilities.failedCount : 0;

  // Geolocation
  const userLocation = useUserLocation();

  // Fetch real lat/lng + parliment info from DBKL location detail API
  const locationIds = useMemo(() => locations.map(l => l.location_id), [locations]);
  const locationDetails = useLocationDetails(locationIds);

  // Rich distance map keyed by location_id
  const distances = useMemo(() => {
    const distMap = new Map<
      string,
      { formatted: string; km: number; roadKm: number; lat: number; lng: number }
    >();
    if (!userLocation.coords) return distMap;
    locationDetails.forEach((detail, locId) => {
      if (Number.isFinite(detail.lat) && Number.isFinite(detail.lng)) {
        const km = haversineKm(
          userLocation.coords!.lat,
          userLocation.coords!.lng,
          detail.lat,
          detail.lng
        );
        distMap.set(locId, {
          formatted: formatDistance(km),
          km,
          roadKm: roadDistanceKm(km),
          lat: detail.lat,
          lng: detail.lng,
        });
      }
    });
    return distMap;
  }, [userLocation.coords, locationDetails]);

  // Near-me filtering: keep venues whose *displayed* distance is within
  // NEAR_ME_MAX_KM. Comparing the raw straight-line value instead let a venue
  // badged ~19 km count as nearby, since the badge is road-corrected.
  const nearMeLocationIds = useMemo(() => {
    if (!nearMeOnly || distances.size === 0) return null;
    const ids = new Set<string>();
    distances.forEach((d, locId) => {
      if (d.roadKm <= NEAR_ME_MAX_KM) ids.add(locId);
    });
    return ids;
  }, [nearMeOnly, distances]);

  const filteredCourts = useMemo(() => {
    if (!nearMeLocationIds) return activeCourts;
    return activeCourts.filter(c => nearMeLocationIds.has(c.location_id));
  }, [activeCourts, nearMeLocationIds]);

  // Scroll to top helper for FAB
  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div
      className="min-h-screen transition-colors duration-200"
      style={{ background: 'var(--color-bg-gradient)' }}
    >
      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700/60 backdrop-blur-sm sticky top-0 z-20 shadow-lg dark:shadow-2xl transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-3 py-3 sm:px-4 sm:py-4 flex items-center gap-2 sm:gap-4">
          {/* Shuttlecock icon */}
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 dark:bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-emerald-600 dark:fill-emerald-400" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C9.8 2 8 3.8 8 6s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm7.07 4.93l-1.41-1.41c-.78-.78-2.05-.78-2.83 0L13 13.34V22h2v-7.83l1.66-1.66 1.41 1.41L20 12.09l-1.93 1.84z"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>
                Court Finder
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 dark:bg-emerald-500/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-xs font-bold tracking-wider">
                DBKL
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse"></span>
              <p className="text-slate-600 dark:text-slate-400 text-xs">Live {SPORT_OPTIONS.find(s => s.value === sport)?.label?.toLowerCase() ?? 'sports'} court availability</p>
            </div>
          </div>
          {userLocation.coords && (
            <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-500">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-emerald-600 dark:fill-emerald-500">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
              <span>Location active</span>
            </div>
          )}
          {/* Refresh button */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={courtsLoading}
            className="w-11 h-11 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 hover:border-emerald-500/60 active:scale-95 transition-all duration-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            aria-label="Refresh data"
            title="Refresh court availability"
          >
            <svg viewBox="0 0 24 24" className={`w-4 h-4 fill-current ${courtsLoading ? 'animate-spin' : ''}`}>
              <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 py-4 sm:px-4 sm:py-6">
        {/* Filter Bar */}
        <FilterBar
          sport={sport}
          onSportChange={handleSportChange}
          date={date}
          onDateChange={setDate}
          locationId={locationId}
          onLocationChange={setLocationId}
          locations={locations}
          minConsecutiveSlots={minConsecutiveSlots}
          onMinSlotsChange={setMinConsecutiveSlots}
          minCourtsNeeded={minCourtsNeeded}
          onMinCourtsChange={setMinCourtsNeeded}
          timeRangeStart={timeRangeStart}
          timeRangeEnd={timeRangeEnd}
          onTimeRangeChange={handleTimeRangeChange}
          locationLoading={locationsLoading}
          distances={distances.size > 0 ? distances : undefined}
          locationDetails={locationDetails}
          nearMeOnly={nearMeOnly}
          onNearMeChange={setNearMeOnly}
        />

        {/* Location permission hint */}
        {!userLocation.coords && !userLocation.loading && (
          <div className="flex items-center gap-3 bg-white/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 mb-5 text-sm">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-slate-500 dark:fill-slate-400 flex-shrink-0">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
            <span className="text-slate-600 dark:text-slate-400">
              {/* Say why it is unavailable when we know — "allow location
                  access" is unhelpful advice to someone who already denied it,
                  or whose browser has no geolocation at all. */}
              {userLocation.error
                ? `${userLocation.error} — courts are listed alphabetically instead of by distance.`
                : 'Allow location access to sort courts by distance from you.'}
            </span>
          </div>
        )}

        {/* Timeline View */}
        <TimelineView
          courts={filteredCourts}
          date={date}
          sport={sport}
          minConsecutiveSlots={minConsecutiveSlots}
          minCourtsNeeded={minCourtsNeeded}
          timeRangeStart={timeRangeStart}
          timeRangeEnd={timeRangeEnd}
          loading={courtsLoading}
          error={courtsError}
          distances={distances.size > 0 ? distances : undefined}
          locationDetails={locationDetails}
          loadedCount={loadedCount}
          totalCount={totalCount}
          failedCount={failedCount}
          onRetry={handleRefresh}
        />
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-700/50 mt-10">
        <div className="max-w-7xl mx-auto px-4 py-5 text-center text-slate-500 dark:text-slate-500 text-xs">
          Data powered by DBKL API · {new Date().toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </footer>

      {/* Mobile FAB — scroll to top / filters */}
      {!isSmUp && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-5 right-5 z-30 w-12 h-12 rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 flex items-center justify-center active:scale-90 transition-all hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2"
          aria-label="Scroll to top"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
            <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
          </svg>
        </button>
      )}
      <Analytics />
    </div>
  );
}

export default App;
