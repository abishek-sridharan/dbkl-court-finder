# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Development server at localhost:5173
npm run build      # Production build to dist/
npm run preview    # Preview production build
npm run lint       # ESLint checks
```

No test framework is configured in this project.

## Architecture

This is a React 19 + TypeScript SPA built with Vite 7 and Tailwind CSS 4. It fetches real-time badminton court availability from DBKL's public API.

**State lives in `App.tsx`** — all filter state (date, locationId, consecutive slots, time range, min courts) is managed there and passed down as props.

**Data fetching is done entirely through custom hooks** in `src/hooks/`:
- `useLocations` — fetches the full list of 72+ DBKL locations (cached for session)
- `useFacility` — fetches court slots for a single location
- `useAllFacilities` — batch-fetches all locations (10 at a time, 200ms delay) with progress tracking
- `useLocationDetails` — fetches lat/lng and parliament info per location (localStorage-cached)
- `useUserLocation` — browser geolocation, runs once at mount
- `useGeocode` — Nominatim fallback when DBKL coordinates are invalid

**External APIs:**
- `https://apihub.dbkl.gov.my/api/public/v1/location/getCategoryByLocation` — location list
- `https://apihub.dbkl.gov.my/api/public/v1/location/facility?sub_category=BADMINTON&location_id={id}&search_date={YYYY-MM-DD}` — court availability
- `https://apihub.dbkl.gov.my/api/public/v1/location?id={id}` — location coordinates
- `https://apihub.dbkl.gov.my/api/public/v1/parliment?id={id}` — parliament/constituency name
- `https://nominatim.openstreetmap.org/search` — geocoding fallback (rate-limited to ~1 req/sec)

**Component hierarchy:**
```
App.tsx (state)
├── FilterBar.tsx — date, location dropdown, consecutive slots, time range controls
└── TimelineView.tsx — court grid grouped by location, sorted by distance
    └── CourtRow.tsx → SlotCell.tsx (per time slot, color-coded availability)
```

**Key utilities in `src/utils/`:**
- `consecutiveSlots.ts` — `TIME_ORDER` array (8 AM → 12 AM, 16 bookable hours) plus all availability logic. `hasConsecutiveSlotsInRange()` filters one court, `countCourtsWithSharedWindow()` counts courts free in the *same* window (what "min courts needed" means), and `slotSpan()` gives a record's width in hour columns. Never derive a span from `start_time_id`/`end_time_id` — those wrap at midnight (10 PM = 23, 12 AM = 1) — and never trust `end_time_value` blindly, since at least one venue emits "12:00 PM → 1:00 AM"

  The API returns *overlapping* records for one start time (a 1-hour "6–7 PM" alongside a 2-hour "6–8 PM"), and they contradict each other: some venues sell the evening only as 2-hour blocks, marking the block available and every 1-hour record inside it booked. `dedupeSlotsByStart()` resolves this by preferring the **available** record first and the shorter one only as a tiebreak — preferring the shorter record would paint a court that is free all evening as fully booked. Both `CourtRow` and the filters read through this one function, and `buildHourAvailability()` walks hours exactly as `CourtRow` walks columns, so the grid and the filters can never disagree about an hour
- `date.ts` — local-timezone `YYYY-MM-DD` helpers (`toLocalIso`, `todayLocalIso`, `addDays`). Never use `toISOString()` for these dates: it returns UTC and is a day behind for the first 8 hours of every Malaysian morning
- `distance.ts` — Haversine formula with a 2× road correction factor; `isValidMalaysiaCoord()` for coordinate validation
- `geocoding.ts` — Nominatim integration for coordinate lookup by location name

**Caching strategy:**
- Location list is kept in module-level state (no re-fetch)
- Court availability goes through `src/utils/facilityCache.ts`, a module-level `Map` keyed by `sport|date|location_id` with a 10-minute TTL, read and written by **both** `useFacility` and `useAllFacilities` so the two never fetch the same venue twice. Deliberately not persisted — stale bookings across sessions would be worse than a refetch. The refresh button calls `clearFacilityCache()` before bumping `refreshKey`; without that it would re-serve the same cached data and appear to do nothing
- Location coordinates and parliament names are cached in localStorage under `dbkl_location_details_v3` as `{ detail, fetchedAt }` entries — successes expire after 30 days, failed lookups after 24 hours so a transient geocoding failure does not disable a venue's distance permanently

**Performance notes:** DBKL's API throttles concurrent requests hard — individual requests take seconds under the 10-per-batch sweep, and a full 59-location sweep takes minutes, not seconds. That makes avoiding a request far more valuable here than on a typical API, and it is why the TTL above is measured in minutes. `CourtRow` and `SlotCell` are memoised because a sweep produces ~20 state updates and the grid is roughly 4,600 cells; `CourtRow` uses an explicit comparator because `timeSlotIds` is rebuilt on every batch, so any prop added to `CourtRowProps` must be added to that comparator too.

## Conventions

**Components & hooks:**
- Functional components only, named exports (not default) except `App.tsx`
- Custom hooks return `{ data, loading, error }` shaped objects consistently
- All hooks that call APIs use `useEffect` with a local `cancelled` boolean for cleanup (not `AbortController`) — this is intentional for React 19 StrictMode compatibility (see comment in `useAllFacilities.ts`)
- Hooks own their own interfaces inline — there is no shared types file. When adding new hooks, define interfaces in the same file

**Styling:**
- Tailwind CSS utility classes only — no custom CSS classes, no CSS modules
- Dark theme palette: `slate-700/800/900` backgrounds, `emerald-400/500` for positive states, `orange-500` for active filters, `red` for errors
- Card pattern: `bg-slate-800/60 border border-slate-700 rounded-2xl`
- Interactive buttons: `rounded-xl` with `shadow-lg shadow-{color}/30` when active
- Fonts: Outfit (headings via inline style), Inter (body via Tailwind default)

**Data flow:**
- No state management library — all state is `useState` in `App.tsx`, passed as props
- Filtering/sorting logic lives in `useMemo` hooks, not in event handlers
- API base URL is hardcoded (no env vars) — DBKL's public API has no auth
- Batch fetching uses `Promise.all` per batch of 10 with 200ms inter-batch delay to avoid hammering the API

**TypeScript:**
- Use `interface` (not `type`) for object shapes
- Prop interfaces are named `{ComponentName}Props`
- Hook return interfaces are named `Use{HookName}Return`

**Shared types** live in `src/types.ts` — `LocationFacility` and `LocationData` are defined there and imported by hooks and components. `LocationFacilityTime` remains in `src/utils/consecutiveSlots.ts` since it's tightly coupled with the time-ordering logic there.
