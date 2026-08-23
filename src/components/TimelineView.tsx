import { useEffect, useState, useMemo } from "react";
import {
  countCourtsWithSharedWindow,
  hasConsecutiveSlotsInRange,
  shortTimeLabel,
  TIME_ORDER,
} from "../utils/consecutiveSlots";
import { CourtRow } from "./CourtRow";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { LocationDetail } from "../hooks/useLocationDetails";
import type { LocationFacility, SportCategory } from "../types";

interface TimelineViewProps {
  courts: LocationFacility[];
  date: string;
  sport: SportCategory;
  minConsecutiveSlots: number;
  minCourtsNeeded: number;
  timeRangeStart: string | null;
  timeRangeEnd: string | null;
  loading: boolean;
  error: string | null;
  distances?: Map<string, { formatted: string; km: number; lat: number; lng: number }>; // keyed by location_id
  locationDetails?: Map<string, LocationDetail>; // keyed by location_id
  loadedCount?: number;
  totalCount?: number;
  failedCount?: number;
  onRetry?: () => void;
}

// Shared ordered list of display labels for the time header.
// Include up to 11PM (index 15) so that a 10PM–12AM two-hour slot can span 2 columns.
const HEADER_TIMES = TIME_ORDER.slice(0, 16); // 8AM–11PM
const VENUE_COLUMN_WIDTH = 160;
const TIME_COLUMN_MIN_WIDTH = 32;

// Deep link to DBKL's booking page for one venue on the selected date.
function buildBookingUrl(
  locationId: string,
  date: string,
  sport: SportCategory,
): string {
  return `https://tempahkl.dbkl.gov.my/facility/detail/book?location_id=${locationId}&start_date=${date}&sub_category=${encodeURIComponent(sport)}&toggle_step=1`;
}

export function TimelineView({
  courts,
  date,
  sport,
  minConsecutiveSlots,
  minCourtsNeeded,
  timeRangeStart,
  timeRangeEnd,
  loading,
  error,
  distances,
  locationDetails,
  loadedCount = 0,
  totalCount = 0,
  failedCount = 0,
  onRetry,
}: TimelineViewProps) {
  const isSmUp = useMediaQuery('(min-width: 640px)');
  const isLandscape = useMediaQuery('(orientation: landscape) and (min-width: 480px)');
  const [showDimmed, setShowDimmed] = useState(false);
  const [collapsedLocations, setCollapsedLocations] = useState<Set<string>>(
    new Set(),
  );

  // Collapsing is a judgement about a venue, so it survives a date change — the
  // same venues are still listed. Switching sport replaces the list entirely,
  // so carrying the old collapse state over would hide venues for no reason the
  // user could see.
  useEffect(() => {
    setCollapsedLocations(new Set());
  }, [sport]);

  const toggleCollapse = (locName: string) => {
    setCollapsedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(locName)) next.delete(locName);
      else next.add(locName);
      return next;
    });
  };

  // Memoised filter checks (must be before any early return)
  const courtsPassingFilter = useMemo(
    () =>
      courts.filter((court) =>
        hasConsecutiveSlotsInRange(
          court.location_facility_times,
          minConsecutiveSlots,
          timeRangeStart,
          timeRangeEnd,
        ),
      ),
    [courts, minConsecutiveSlots, timeRangeStart, timeRangeEnd],
  );

  const passingIds = useMemo(
    () => new Set(courtsPassingFilter.map((c) => c.id)),
    [courtsPassingFilter],
  );

  // Group ALL courts by location_id (unique key) — used for totals and sorting
  const allCourtsByLocId = useMemo(() => {
    const grouped: Record<string, LocationFacility[]> = {};
    courts.forEach((court) => {
      (grouped[court.location_id] ??= []).push(court);
    });
    return grouped;
  }, [courts]);

  // Location IDs with enough courts free for the SAME window to satisfy
  // minCourtsNeeded. Counting courts that each pass the filter separately would
  // qualify a venue whose free windows never overlap — no use to one group.
  const qualifyingLocationIds = useMemo(() => {
    const qualifying = new Set<string>();
    Object.entries(allCourtsByLocId).forEach(([locId, locationCourts]) => {
      const shared = countCourtsWithSharedWindow(
        locationCourts.map((c) => c.location_facility_times),
        minConsecutiveSlots,
        timeRangeStart,
        timeRangeEnd,
      );
      if (shared >= minCourtsNeeded) qualifying.add(locId);
    });
    return qualifying;
  }, [
    allCourtsByLocId,
    minConsecutiveSlots,
    minCourtsNeeded,
    timeRangeStart,
    timeRangeEnd,
  ]);

  // Courts to display: when showDimmed, show all courts regardless; otherwise show only those in qualifying locations
  const displayedCourts = useMemo(() => {
    if (showDimmed) return courts;
    return courtsPassingFilter.filter((c) =>
      qualifyingLocationIds.has(c.location_id),
    );
  }, [showDimmed, courts, courtsPassingFilter, qualifyingLocationIds]);

  // Group DISPLAYED courts by location_id — used for rendering rows
  const courtsByLocId = useMemo(() => {
    const grouped: Record<string, LocationFacility[]> = {};
    displayedCourts.forEach((court) => {
      (grouped[court.location_id] ??= []).push(court);
    });
    return grouped;
  }, [displayedCourts]);

  // Sort location_ids: by distance km (ascending), then alphabetical by display name
  const sortedLocationIds = useMemo(() => {
    return Object.keys(allCourtsByLocId).sort((a, b) => {
      const nameA = allCourtsByLocId[a]?.[0]?.location_name ?? a;
      const nameB = allCourtsByLocId[b]?.[0]?.location_name ?? b;
      const da = distances?.get(a)?.km; // keyed by location_id
      const db = distances?.get(b)?.km;
      if (da != null && db != null) return da - db;
      if (da != null) return -1;
      if (db != null) return 1;
      return nameA.localeCompare(nameB);
    });
  }, [allCourtsByLocId, distances]);

  // Time header: union of all start times actually present, ordered.
  // Also include the 11PM column if any slot ends at 12AM (so 10PM→12AM spans 2 columns).
  // Build a map from start_time_value → start_time_id for CourtRow dedup.
  const { allTimeSlots, timeValueToId } = useMemo(() => {
    const presentSet = new Set<string>();
    const valueToId = new Map<string, string>();
    let needsElevenPm = false;

    courts.forEach((c) =>
      c.location_facility_times.forEach((t) => {
        presentSet.add(t.start_time_value);
        if (t.end_time_value === "12:00 AM") needsElevenPm = true;
        // Prefer the smallest id (1h slot) when multiple slots share the same start_time_value
        if (
          !valueToId.has(t.start_time_value) ||
          parseInt(t.start_time_id, 10) <
            parseInt(valueToId.get(t.start_time_value)!, 10)
        ) {
          valueToId.set(t.start_time_value, t.start_time_id);
        }
      }),
    );

    let slots: string[];
    if (courts.length === 0) {
      slots = HEADER_TIMES;
    } else {
      slots = HEADER_TIMES.filter((t) => {
        if (t === "11:00 PM") return needsElevenPm;
        return presentSet.has(t);
      });
    }
    return { allTimeSlots: slots, timeValueToId: valueToId };
  }, [courts]);

  // Ordered list of start_time_ids matching the header columns, used by CourtRow
  // for dedup. This array gets a new identity on every batch of venues, so
  // CourtRow compares it by content rather than by reference.
  const allTimeSlotIds = useMemo(
    () => allTimeSlots.map((t) => timeValueToId.get(t) ?? ""),
    [allTimeSlots, timeValueToId],
  );
  // Use desktop grid layout when screen is wide enough OR in landscape orientation
  const useDesktopGrid = isSmUp || isLandscape;

  /*
    On a phone in portrait there is no venue column and roughly 325px to share.
    Across the whole day that is about 20px per hour — under the 24px minimum for
    a touch target, so tapping the 8 PM cell regularly opened 7 PM instead.
    Splitting the day in half doubles each cell to around 40px. Every hour still
    shows; the day is stacked rather than squeezed.
  */
  const segments = useMemo(() => {
    if (useDesktopGrid || allTimeSlotIds.length <= 8) {
      return [{ from: 0, to: allTimeSlotIds.length }];
    }
    const mid = Math.ceil(allTimeSlotIds.length / 2);
    return [
      { from: 0, to: mid },
      { from: mid, to: allTimeSlotIds.length },
    ];
  }, [allTimeSlotIds.length, useDesktopGrid]);

  const isSplit = segments.length > 1;

  const columnsTemplate = (count: number) =>
    useDesktopGrid
      ? `${VENUE_COLUMN_WIDTH}px repeat(${count}, minmax(${TIME_COLUMN_MIN_WIDTH}px, 1fr))`
      : `repeat(${count}, 1fr)`;

  const timelineGridTemplate = columnsTemplate(allTimeSlotIds.length);
  const timelineMinWidth = useDesktopGrid
    ? VENUE_COLUMN_WIDTH + allTimeSlotIds.length * TIME_COLUMN_MIN_WIDTH
    : 0;

  // Early returns after all hooks
  if (error) {
    return (
      <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-2xl p-5 text-red-700 dark:text-red-300">
        <p className="font-semibold">Error loading courts</p>
        <p className="text-sm mt-1 text-red-600 dark:text-red-400">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 active:scale-[0.97] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  // Progress while loading. A venue count only means something when the
  // all-locations sweep is running; for a single venue it read "0 / … locations".
  if (loading && courts.length === 0) {
    const isSweep = totalCount > 0;
    const pct = isSweep ? Math.round((loadedCount / totalCount) * 100) : 0;
    return (
      <div
        role="status"
        className="bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-2xl p-8 text-center transition-colors duration-200"
      >
        <p className="text-slate-700 dark:text-slate-300 text-sm font-medium mb-3">
          {isSweep
            ? `Loading courts — ${loadedCount} / ${totalCount} locations`
            : "Loading courts…"}
        </p>
        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
          <div
            className={`shimmer-bar h-full rounded-full transition-all duration-300 ${isSweep ? "" : "w-full"}`}
            style={isSweep ? { width: `${pct}%` } : undefined}
          />
        </div>
        {isSweep && (
          <p className="text-slate-500 dark:text-slate-500 text-xs mt-2">{pct}% complete</p>
        )}
      </div>
    );
  }

  if (courts.length === 0 && !loading) {
    return (
      <div className="space-y-4">
        {failedCount > 0 && (
          <FailedVenuesNotice failedCount={failedCount} onRetry={onRetry} />
        )}
        <div className="bg-white/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-10 text-center transition-colors duration-200">
          <div className="text-5xl mb-3">🏸</div>
          <p className="font-medium text-slate-700 dark:text-slate-400">
            No courts found for the selected filters.
          </p>
          <p className="text-xs mt-1 text-slate-500 dark:text-slate-500">
            Try widening the time window, lowering minimum hours, or picking a different date.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progressive loading bar (still fetching but already have some data) */}
      {loading && courts.length > 0 && (
        <div className="bg-white/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1.5">
            <span>
              Loading {loadedCount} / {totalCount} locations…
            </span>
            <span>
              {totalCount > 0
                ? Math.round((loadedCount / totalCount) * 100)
                : 0}
              %
            </span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
            <div
              className="shimmer-bar h-full rounded-full transition-all duration-300"
              style={{
                width: `${totalCount > 0 ? Math.round((loadedCount / totalCount) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Some venues did not respond — say so rather than passing them off as full */}
      {!loading && failedCount > 0 && (
        <FailedVenuesNotice failedCount={failedCount} onRetry={onRetry} />
      )}

      {/* Stats bar */}
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 bg-white/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 transition-colors duration-200"
      >
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 dark:bg-emerald-400 inline-block"></span>
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
              {qualifyingLocationIds.size}
            </span>
            <span className="text-slate-600 dark:text-slate-400">venues · </span>
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
              {
                courtsPassingFilter.filter((c) =>
                  qualifyingLocationIds.has(c.location_id),
                ).length
              }
            </span>
            <span className="text-slate-600 dark:text-slate-400">courts matching filters</span>
          </span>
          {courts.length > courtsPassingFilter.length && (
            <span className="text-slate-500 dark:text-slate-600 text-xs">
              ({courts.length - courtsPassingFilter.length} others)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-slate-500 dark:text-slate-500">
            Tip: log in to{" "}
            <a
              href="https://tempahkl.dbkl.gov.my"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-600 dark:text-slate-400 underline hover:text-emerald-600 dark:hover:text-emerald-400"
            >
              DBKL
            </a>
            {" "}first so Book links jump straight to the venue.
          </span>
          <button
            type="button"
            onClick={() => setShowDimmed(!showDimmed)}
            aria-pressed={showDimmed}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
              showDimmed
                ? "bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-600 dark:text-white dark:border-slate-500"
                : "bg-transparent text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:border-slate-500 dark:hover:border-slate-400"
            }`}
          >
            {showDimmed ? "Matching only" : "Show all"}
          </button>
        </div>
      </div>

      {/* Timeline grid
          overflow-x-clip avoids creating a scroll container (unlike overflow-x-auto/hidden)
          which would break position:sticky on the time header inside.
          At desktop widths (max-w-7xl = 1280px) the grid min-width (~672px) fits comfortably.
      */}
      <div className={`bg-white/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl transition-colors duration-200 ${useDesktopGrid ? 'overflow-x-clip' : ''}`}>
        {/* Keep the inner width in sync with the shared timeline grid so rows stay aligned. */}
        <div style={timelineMinWidth > 0 ? { minWidth: `${timelineMinWidth}px` } : undefined}>
          {/*
          gridTemplateColumns uses minmax(32px, 1fr) so time columns grow to fill the full
          available width on wide screens and shrink no smaller than 32px on narrow ones.
          The header and every CourtRow use the EXACT same template — perfect alignment guaranteed.
        */}
          {/* One sticky header when the day is drawn in a single run. When it is
              split for phones each half carries its own header instead, beside
              the rows it labels. */}
          {!isSplit && (
            <div
              className="sticky top-[65px] sm:top-[73px] z-20 border-b border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-950/95 px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:shadow-[0_10px_24px_rgba(2,6,23,0.45)] backdrop-blur-sm"
              style={{
                display: "grid",
                gridTemplateColumns: timelineGridTemplate,
              }}
            >
              {useDesktopGrid && (
                <div className="pr-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-500 sticky-left bg-white/95 dark:bg-slate-950/95">
                  Venue
                </div>
              )}
              {allTimeSlots.map((slot) => (
                <HourLabel
                  key={slot}
                  slot={slot}
                  timeRangeStart={timeRangeStart}
                  timeRangeEnd={timeRangeEnd}
                />
              ))}
            </div>
          )}

          {/* Location groups */}
          <div className="divide-y divide-slate-200 dark:divide-slate-700/50 pt-2">
            {sortedLocationIds.map((locId, index) => {
              // displayedCourts for this location_id (may be empty if all filtered out and showDimmed=false)
              const locationCourts = courtsByLocId[locId];
              if (!locationCourts || locationCourts.length === 0) return null;

              const locName = locationCourts[0]?.location_name ?? locId;

              // Total courts for this location (all, not just passing filter)
              const totalCourts =
                allCourtsByLocId[locId]?.length ?? locationCourts.length;
              // How many pass the current filter
              const availCount = (allCourtsByLocId[locId] ?? []).filter((c) =>
                passingIds.has(c.id),
              ).length;
              const isCollapsed = collapsedLocations.has(locId);
              const dist = distances?.get(locId); // keyed by location_id
              const parlimentName = locationDetails?.get(locId)?.parliment_name;
              // One URL per venue, shared by the header button and every slot
              // tooltip, so the two entry points cannot drift apart.
              const bookingUrl = buildBookingUrl(locId, date, sport);

              return (
                <div
                  key={locId}
                  className="animate-fade-in"
                  style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
                >
                  {/* Location header. The collapse control is a button beside
                      the links rather than a button wrapping them: nesting
                      links inside a button is invalid, and it left the Book and
                      directions links unreachable for keyboard users. */}
                  <div className="w-full flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/40 transition-colors">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(locId)}
                      aria-expanded={!isCollapsed}
                      aria-controls={`venue-courts-${locId}`}
                      className="flex min-w-[220px] flex-1 items-start gap-3 text-left rounded-lg -mx-1 px-1 hover:bg-slate-100 dark:hover:bg-slate-900/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    >
                      {/* Collapse indicator */}
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className={`w-3.5 h-3.5 fill-slate-400 dark:fill-slate-500 shrink-0 mt-0.5 transition-transform duration-200 ${
                          isCollapsed ? "-rotate-90" : ""
                        }`}
                      >
                        <path d="M7 10l5 5 5-5z" />
                      </svg>

                      {/* Name + parliament */}
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-tight block">
                          {locName}
                        </span>
                        {parlimentName && (
                          <span className="text-xs text-slate-500 dark:text-slate-500 block leading-tight mt-0.5">
                            {parlimentName}
                          </span>
                        )}
                      </span>
                    </button>

                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                      {/* Distance badge — links to Google Maps directions for this venue */}
                      {dist && (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${dist.lat},${dist.lng}&travelmode=driving`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Estimated road distance · tap for directions"
                          aria-label={`Directions to ${locName}, about ${dist.formatted.replace('~', '')} away`}
                          className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-400/10 border border-emerald-500/30 dark:border-emerald-400/20 rounded-full px-2 py-0.5 shrink-0 hover:bg-emerald-500/20 dark:hover:bg-emerald-400/20 hover:border-emerald-500/50 dark:hover:border-emerald-400/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                        >
                          {dist.formatted}
                        </a>
                      )}

                      {/* Book on DBKL — deep link to the booking page for this venue/date/sport */}
                      <a
                        href={bookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Opens the DBKL booking page for this venue on the selected date. You must be logged in to DBKL first."
                        aria-label={`Book at ${locName} on DBKL`}
                        className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-0.5 shrink-0 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-colors inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                      >
                        Book
                        <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current" aria-hidden="true">
                          <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                        </svg>
                      </a>

                      {/* Court availability count */}
                      <span
                        className={`text-xs font-semibold rounded-full px-2.5 py-0.5 shrink-0 ${
                          availCount > 0
                            ? "bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                            : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-500"
                        }`}
                      >
                        {availCount}/{totalCourts} available
                      </span>
                    </div>
                  </div>

                  {/* Courts, once per segment of the day */}
                  {!isCollapsed && (
                    <div id={`venue-courts-${locId}`} className="px-3 py-1.5 space-y-3">
                      {segments.map((segment) => (
                        <div key={segment.from} className="space-y-0.5">
                          {isSplit && (
                            <div
                              className="pb-0.5"
                              style={{
                                display: "grid",
                                gridTemplateColumns: columnsTemplate(segment.to - segment.from),
                              }}
                            >
                              {allTimeSlots.slice(segment.from, segment.to).map((slot) => (
                                <HourLabel
                                  key={slot}
                                  slot={slot}
                                  timeRangeStart={timeRangeStart}
                                  timeRangeEnd={timeRangeEnd}
                                />
                              ))}
                            </div>
                          )}
                          {locationCourts.map((court) => (
                            <CourtRow
                              key={court.id}
                              venueName={court.venue_name}
                              slots={court.location_facility_times}
                              isDimmed={showDimmed && !passingIds.has(court.id)}
                              timeSlotIds={allTimeSlotIds}
                              fromCol={segment.from}
                              toCol={segment.to}
                              venueColWidth={VENUE_COLUMN_WIDTH}
                              showVenueColumn={useDesktopGrid}
                              bookingUrl={bookingUrl}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* end inner min-width wrapper */}
      </div>

      {/* Legend — compact footnote-style */}
      <div className="flex items-center gap-3 px-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/40 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-sm bg-emerald-500" />
          <span className="text-xs sm:text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Striped, matching the cells — the legend has to show the same cue
              the grid uses, not just the colour underneath it. */}
          <div className="w-3.5 h-3.5 rounded-sm bg-slate-200 dark:bg-slate-700 bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,rgba(71,85,105,0.3)_2px,rgba(71,85,105,0.3)_4px)] dark:bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,rgba(148,163,184,0.28)_2px,rgba(148,163,184,0.28)_4px)]" />
          <span className="text-xs sm:text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">Booked</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-sm bg-slate-100 dark:bg-slate-800 border border-slate-300/70 dark:border-slate-700" />
          <span className="text-xs sm:text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">No session</span>
        </div>
        {(timeRangeStart || timeRangeEnd) && (
          <div className="flex items-center gap-1.5">
            {/* The window is marked on the hour labels, not the cells — so show
                the label treatment rather than a swatch that never appears. */}
            <span className="text-xs sm:text-[11px] font-medium text-orange-600 dark:text-orange-400">7p</span>
            <span className="text-xs sm:text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500">Hours in your window</span>
          </div>
        )}
        {distances && distances.size > 0 && (
          <span className="text-xs sm:text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-500 ml-auto">
            Sorted by distance · nearest first
          </span>
        )}
      </div>
    </div>
  );
}

interface HourLabelProps {
  slot: string;
  timeRangeStart: string | null;
  timeRangeEnd: string | null;
}

// One column heading. Shared by the sticky header and, when the day is split
// for phones, by each half's own heading row, so the two cannot diverge.
function HourLabel({ slot, timeRangeStart, timeRangeEnd }: HourLabelProps) {
  const inWindow =
    (timeRangeStart || timeRangeEnd) &&
    isInTimeRange(slot, timeRangeStart, timeRangeEnd);
  return (
    <div
      className={`text-center text-xs font-medium ${
        timeRangeStart || timeRangeEnd
          ? inWindow
            ? "text-orange-600 dark:text-orange-400"
            : "text-slate-400 dark:text-slate-600"
          : "text-slate-600 dark:text-slate-400"
      }`}
    >
      {/* Always keep the a/p suffix: without it 8, 9, 10 and 11 each appear
          twice in the same header with nothing to tell morning from night. */}
      {shortTimeLabel(slot)}
    </div>
  );
}

interface FailedVenuesNoticeProps {
  failedCount: number;
  onRetry?: () => void;
}

function FailedVenuesNotice({ failedCount, onRetry }: FailedVenuesNoticeProps) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700/60 rounded-xl px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300"
    >
      <span>
        {failedCount} {failedCount === 1 ? "venue" : "venues"} could not be
        loaded — availability may be incomplete.
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 rounded"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// Helper: check if a time slot falls within the selected time range (for header highlighting)
function isInTimeRange(
  time: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start && !end) return false;
  const i = TIME_ORDER.indexOf(time);
  const si = start ? TIME_ORDER.indexOf(start) : 0;
  const ei = end ? TIME_ORDER.indexOf(end) : TIME_ORDER.length - 1;
  return i >= si && i <= ei;
}
