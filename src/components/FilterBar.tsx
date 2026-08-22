import React, { useCallback, useState, useRef, useEffect } from 'react';
import { HOUR_COUNT, shortTimeLabel, timeIndex, TIME_ORDER } from '../utils/consecutiveSlots';
import { addDays, toLocalIso } from '../utils/date';
import { SPORT_OPTIONS } from '../types';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { SportCategory } from '../types';

// Only show the bookable hours in the picker
const PICKER_SLOTS = TIME_ORDER.slice(0, 15); // 8 AM → 10 PM

const MAX_COURTS_NEEDED = 20;

/** Keep a typed number inside its stated bounds — the max attribute alone is advisory. */
function clampNumberInput(raw: string, max: number): number {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(1, parsed), max);
}

interface LocationEntry {
  location_id: string;
  location_name: string;
}

interface FilterBarProps {
  sport: SportCategory;
  onSportChange: (sport: SportCategory) => void;
  date: string;
  onDateChange: (date: string) => void;
  locationId: string;
  onLocationChange: (locationId: string) => void;
  locations: LocationEntry[];
  minConsecutiveSlots: number;
  onMinSlotsChange: (minSlots: number) => void;
  minCourtsNeeded: number;
  onMinCourtsChange: (n: number) => void;
  timeRangeStart: string | null;
  timeRangeEnd: string | null;
  // Both endpoints move together — see the note on handleTimeRangeChange in App.
  onTimeRangeChange: (start: string | null, end: string | null) => void;
  locationLoading: boolean;
  allLocationsProgress: number;
  distances?: Map<string, { formatted: string; km: number }>; // keyed by location_id
  locationDetails?: Map<string, { parliment_name: string; lat: number; lng: number; parliment_id: string; location_id: string }>;
  nearMeOnly: boolean;
  onNearMeChange: (v: boolean) => void;
}

export function FilterBar({
  sport,
  onSportChange,
  date,
  onDateChange,
  locationId,
  onLocationChange,
  locations,
  minConsecutiveSlots,
  onMinSlotsChange,
  minCourtsNeeded,
  onMinCourtsChange,
  timeRangeStart,
  timeRangeEnd,
  onTimeRangeChange,
  locationLoading,
  allLocationsProgress,
  distances,
  locationDetails,
  nearMeOnly,
  onNearMeChange,
}: FilterBarProps) {
  const isSmUp = useMediaQuery('(min-width: 640px)');
  const [isExpanded, setIsExpanded] = useState(true);
  const [locationSearch, setLocationSearch] = useState('');
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const minDate = toLocalIso(today);
  const maxDate = toLocalIso(addDays(today, 21));

  // Date navigation helpers
  const shiftDate = (days: number) => {
    const iso = toLocalIso(addDays(new Date(date + 'T00:00:00'), days));
    if (iso >= minDate && iso <= maxDate) onDateChange(iso);
  };

  // Format date for summary display
  const formatDateShort = (d: string) => {
    if (d === minDate) return 'Today';
    if (d === toLocalIso(addDays(today, 1))) return 'Tomorrow';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-MY', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  // Sort locations: by distance (keyed by location_id) if available, else alphabetically
  const sortedLocations = React.useMemo(() => {
    if (!distances || distances.size === 0) {
      return [...locations].sort((a, b) => a.location_name.localeCompare(b.location_name));
    }
    return [...locations].sort((a, b) => {
      const da = distances.get(a.location_id)?.km;
      const db = distances.get(b.location_id)?.km;
      if (da != null && db != null) return da - db;
      if (da != null) return -1;
      if (db != null) return 1;
      return a.location_name.localeCompare(b.location_name);
    });
  }, [locations, distances]);

  // Filtered locations for search dropdown
  const filteredLocations = React.useMemo(() => {
    if (!locationSearch.trim()) return sortedLocations;
    const q = locationSearch.toLowerCase();
    return sortedLocations.filter(loc => {
      const name = loc.location_name.toLowerCase();
      const parl = locationDetails?.get(loc.location_id)?.parliment_name?.toLowerCase() ?? '';
      return name.includes(q) || parl.includes(q);
    });
  }, [sortedLocations, locationSearch, locationDetails]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLocationDropdown(false);
      }
    };
    if (showLocationDropdown) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [showLocationDropdown]);

  /*
    Clickable time-range picker. Each tap resolves to one complete (start, end)
    pair which is handed over in a single call, so the two endpoints can never
    be read half-updated.
  */
  const handleTimeClick = useCallback(
    (time: string) => {
      // Nothing selected yet — this tap opens the range.
      if (!timeRangeStart && !timeRangeEnd) {
        onTimeRangeChange(time, null);
        return;
      }

      if (timeRangeStart && !timeRangeEnd) {
        // Tapping the start again clears the range.
        if (time === timeRangeStart) {
          onTimeRangeChange(null, null);
          return;
        }
        // Tapping earlier than the start means the user picked the endpoints
        // the other way round; take it as the range they described.
        if (timeIndex(time) < timeIndex(timeRangeStart)) {
          onTimeRangeChange(time, timeRangeStart);
        } else {
          onTimeRangeChange(timeRangeStart, time);
        }
        return;
      }

      if (timeRangeStart && timeRangeEnd) {
        // Tapping either endpoint of a closed range drops that endpoint.
        if (time === timeRangeStart) {
          onTimeRangeChange(timeRangeEnd, null);
          return;
        }
        if (time === timeRangeEnd) {
          onTimeRangeChange(timeRangeStart, null);
          return;
        }
        // Anything else starts a fresh range.
        onTimeRangeChange(time, null);
      }
    },
    [timeRangeStart, timeRangeEnd, onTimeRangeChange],
  );

  const startIdx = timeRangeStart ? TIME_ORDER.indexOf(timeRangeStart) : -1;
  const endIdx = timeRangeEnd ? TIME_ORDER.indexOf(timeRangeEnd) : -1;

  const isInRange = (time: string) => {
    const i = TIME_ORDER.indexOf(time);
    if (startIdx === -1) return false;
    if (endIdx === -1) return i === startIdx;
    return i >= startIdx && i <= endIdx;
  };

  const isEndpoint = (time: string) => time === timeRangeStart || time === timeRangeEnd;

  const rangeLabel = timeRangeStart
    ? timeRangeEnd
      ? `${timeRangeStart} — ${timeRangeEnd}`
      : `From ${timeRangeStart}`
    : 'Any time';

  const selectedLocationName = locationId
    ? locations.find(l => l.location_id === locationId)?.location_name ?? 'Selected'
    : 'All locations';

  const sportLabel = SPORT_OPTIONS.find(s => s.value === sport)?.label ?? sport;

  // Build compact summary chips
  const summaryParts: string[] = [
    formatDateShort(date),
    sportLabel,
    `${minConsecutiveSlots}h`,
    rangeLabel !== 'Any time' ? rangeLabel : '',
    locationId ? selectedLocationName : '',
    minCourtsNeeded > 1 ? `${minCourtsNeeded}+ courts` : '',
    nearMeOnly ? 'Nearby' : '',
  ].filter(Boolean);

  return (
    <div className="bg-white/90 dark:bg-slate-800 shadow-lg dark:shadow-xl rounded-2xl p-3 sm:p-5 mb-6 border border-slate-200 dark:border-slate-700 backdrop-blur-sm transition-colors duration-200">
      {/* Collapsible header — on mobile, shows summary when collapsed */}
      {!isSmUp && (
        <button
          onClick={() => setIsExpanded(prev => !prev)}
          className="w-full flex items-center justify-between gap-2 mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded-lg"
        >
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-emerald-600 dark:fill-emerald-400 shrink-0">
              <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
            </svg>
            {isExpanded ? (
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Filters</span>
            ) : (
              <div className="flex flex-wrap gap-1.5 min-w-0">
                {summaryParts.map((part, i) => (
                  <span key={i} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-medium rounded-full truncate max-w-[140px]">
                    {part}
                  </span>
                ))}
              </div>
            )}
          </div>
          <svg
            viewBox="0 0 24 24"
            className={`w-5 h-5 fill-slate-400 dark:fill-slate-500 shrink-0 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`}
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
      )}

      {/* Filter content — always visible on desktop, collapsible on mobile */}
      {(isSmUp || isExpanded) && (
        <>
          {/* Sport selector */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Sport
            </label>
            <div className="flex flex-wrap gap-2">
              {SPORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onSportChange(opt.value)}
                  className={`px-3 py-2 min-h-[44px] sm:min-h-0 rounded-xl text-sm font-bold transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                    sport === opt.value
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 dark:shadow-emerald-500/30'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Row 1: Date · Location */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Date with prev/next arrows */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Date
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => shiftDate(-1)}
                  disabled={date <= minDate}
                  className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 flex items-center justify-center shrink-0 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-30 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  aria-label="Previous day"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-slate-600 dark:fill-slate-300"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                </button>
                <input
                  type="date"
                  value={date}
                  min={minDate}
                  max={maxDate}
                  onChange={e => onDateChange(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white text-base sm:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 transition-colors"
                />
                <button
                  onClick={() => shiftDate(1)}
                  disabled={date >= maxDate}
                  className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 flex items-center justify-center shrink-0 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-30 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  aria-label="Next day"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-slate-600 dark:fill-slate-300"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>
                </button>
              </div>
            </div>

            {/* Location — searchable dropdown */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Location
              </label>
              <div className="relative" ref={dropdownRef}>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      ref={locationInputRef}
                      type="text"
                      value={showLocationDropdown ? locationSearch : (locationId ? selectedLocationName : '')}
                      placeholder={locationLoading ? `Loading… ${allLocationsProgress}%` : 'Search locations…'}
                      disabled={locationLoading}
                      onChange={e => { setLocationSearch(e.target.value); setShowLocationDropdown(true); }}
                      onFocus={() => { setLocationSearch(''); setShowLocationDropdown(true); }}
                      className="w-full px-3 py-2.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white text-base sm:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50 transition-colors pr-8"
                    />
                    {locationId && !showLocationDropdown && (
                      <button
                        onClick={() => { onLocationChange(''); setLocationSearch(''); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        aria-label="Clear location"
                      >
                        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                      </button>
                    )}
                  </div>
                  {/* Near me button */}
                  {distances && distances.size > 0 && (
                    <button
                      onClick={() => onNearMeChange(!nearMeOnly)}
                      className={`shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-lg border flex items-center justify-center transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                        nearMeOnly
                          ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                          : 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                      title={nearMeOnly ? 'Showing nearby only · tap to show all' : 'Show nearby venues only'}
                      aria-label="Near me filter"
                    >
                      <svg viewBox="0 0 24 24" className={`w-4 h-4 fill-current ${nearMeOnly ? '' : 'text-slate-600 dark:text-slate-300'}`}>
                        <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0013 3.06V1h-2v2.06A8.994 8.994 0 003.06 11H1v2h2.06A8.994 8.994 0 0011 20.94V23h2v-2.06A8.994 8.994 0 0020.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
                      </svg>
                    </button>
                  )}
                </div>

                {/* Dropdown results */}
                {showLocationDropdown && (
                  <div className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl">
                    <button
                      onClick={() => { onLocationChange(''); setShowLocationDropdown(false); setLocationSearch(''); }}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 ${
                        !locationId ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      All Locations
                    </button>
                    {filteredLocations.map(loc => {
                      const dist = distances?.get(loc.location_id);
                      const parl = locationDetails?.get(loc.location_id)?.parliment_name;
                      return (
                        <button
                          key={loc.location_id}
                          onClick={() => { onLocationChange(loc.location_id); setShowLocationDropdown(false); setLocationSearch(''); }}
                          className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 border-t border-slate-100 dark:border-slate-700/50 ${
                            locationId === loc.location_id ? 'text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50/50 dark:bg-emerald-900/20' : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <span>{loc.location_name}</span>
                          {(parl || dist) && (
                            <span className="block text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                              {[parl, dist?.formatted].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {filteredLocations.length === 0 && (
                      <div className="px-3 py-4 text-sm text-slate-500 dark:text-slate-500 text-center">
                        No locations match "{locationSearch}"
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 2: Min Consecutive Slots · Min Courts Needed */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            {/* Min Consecutive Slots */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Min Consecutive Hours
              </label>
              <div className="flex items-center gap-2">
                <div className="flex gap-2 flex-1">
                  {[1, 2, 3, 4].map(n => (
                    <button
                      key={n}
                      onClick={() => onMinSlotsChange(n)}
                      className={`flex-1 py-2.5 min-h-[44px] sm:min-h-0 rounded-xl text-sm font-bold transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                        minConsecutiveSlots === n
                          ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {n}h
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  max={HOUR_COUNT}
                  value={minConsecutiveSlots}
                  onChange={e => onMinSlotsChange(clampNumberInput(e.target.value, HOUR_COUNT))}
                  className="w-16 px-2 py-2.5 min-h-[44px] sm:min-h-0 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white text-base sm:text-sm text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 transition-colors"
                />
              </div>
            </div>

            {/* Min Courts Needed */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Min Courts Needed
              </label>
              <div className="flex items-center gap-2">
                <div className="flex gap-2 flex-1">
                  {[1, 2, 3, 4, 5, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => onMinCourtsChange(n)}
                      className={`flex-1 py-2.5 min-h-[44px] sm:min-h-0 rounded-xl text-sm font-bold transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                        minCourtsNeeded === n
                          ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  max={MAX_COURTS_NEEDED}
                  value={minCourtsNeeded}
                  onChange={e => onMinCourtsChange(clampNumberInput(e.target.value, MAX_COURTS_NEEDED))}
                  className="w-16 px-2 py-2.5 min-h-[44px] sm:min-h-0 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white text-base sm:text-sm text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 transition-colors"
                />
              </div>
              <p className="text-sm sm:text-xs text-slate-500 dark:text-slate-500 mt-1.5">
                Venues with at least this many courts available simultaneously
              </p>
            </div>
          </div>

          {/* Row 3: Time range picker */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Time Window
              </label>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{rangeLabel}</span>
              {(timeRangeStart || timeRangeEnd) && (
                <button
                  onClick={() => onTimeRangeChange(null, null)}
                  className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors ml-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-1.5">
              {PICKER_SLOTS.map(time => {
                const inRange = isInRange(time);
                const endpoint = isEndpoint(time);
                return (
                  <button
                    key={time}
                    onClick={() => handleTimeClick(time)}
                    className={`px-2.5 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-sm sm:text-xs font-semibold transition-all select-none active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                      endpoint
                        ? 'bg-orange-500 text-white shadow-md shadow-orange-500/40 scale-105'
                        : inRange
                        ? 'bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/60 dark:text-orange-200 dark:border-orange-700'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {shortTimeLabel(time)}
                  </button>
                );
              })}
            </div>
            <p className="text-sm sm:text-xs text-slate-500 dark:text-slate-500 mt-2">
              Tap a time to set start · tap another to set end · tap endpoint to adjust
            </p>
          </div>
        </>
      )}
    </div>
  );
}
