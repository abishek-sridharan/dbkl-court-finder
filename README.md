# DBKL Court Finder

A modern, real-time web application for discovering available sports courts across 72+ DBKL (Dewan Bandaraya Kuala Lumpur) facilities. Search by sport, location, date, and time — with distance-based sorting, consecutive slot filtering, and direct booking links.

## Features

### Multi-Sport Support

Browse availability for 11 sport categories:

- Badminton, Futsal, Football, Basketball, Volleyball, Tennis, Squash, Pickleball, Table Tennis, Sepak Takraw, Archery

### Smart Filtering

- **Consecutive Slots**: Filter courts by minimum consecutive available hours (1–12) within a configurable time window
- **Time Range**: Narrow results to a specific window (e.g. 6 PM – 10 PM) — consecutive slot count auto-syncs to match the range
- **Minimum Courts**: Require a minimum number of courts available at a venue before it shows up
- **Location Search**: Type-ahead search across all location names in the dropdown
- **Near Me**: Toggle to show only venues within 10 km of your current position (uses browser geolocation)

### Timeline View

- Visual grid of hourly slots (8 AM – 12 AM) for every court at each venue
- Color-coded: green = available, grey = booked
- Sticky venue column for easy reference while scrolling horizontally
- Venues sorted by distance from your location (nearest first)
- Stats bar showing total venues found, courts matching, and distance to nearest

### Booking Integration

- Hovering or tapping an available slot shows a tooltip with pricing (Malaysian Ringgit) and a direct link to the DBKL booking page

### Theme Support

- Light and dark mode with a toggle button
- Respects system preference on first visit (`prefers-color-scheme`)
- Theme persists across sessions via `localStorage`
- Anti-FOUC script in `index.html` applies the theme before first paint

### Responsive Design

- Adapts layout for mobile, tablet, and desktop using Tailwind breakpoints and a custom `useMediaQuery` hook
- Touch-friendly slot cells with `active:scale-95` feedback
- Date navigation with previous/next day buttons and formatted display

## Tech Stack

| Layer      | Technology                                                    |
| ---------- | ------------------------------------------------------------- |
| Framework  | React 19 + TypeScript                                         |
| Build Tool | Vite 7                                                        |
| Styling    | Tailwind CSS 4                                                |
| Fonts      | Outfit (headings), Inter (body) via Google Fonts              |
| APIs       | DBKL Public API, OpenStreetMap Nominatim (geocoding fallback) |
| Testing    | Vitest                                                        |
| CI         | GitHub Actions — lint, test, type-check and build on every PR  |

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/abisheks87/dbklIdentifyingCourts.git
cd dbklIdentifyingCourts

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173/`.

### Available Scripts

```bash
npm run dev        # Development server with HMR
npm run typecheck  # TypeScript check only (tsc --build, no emit)
npm test           # Run the test suite once (Vitest)
npm run test:watch # Re-run tests on change
npm run build      # Type-check, then production build to dist/
npm run preview    # Preview the production build locally
npm run lint       # Run ESLint checks
```

## Project Structure

```
src/
├── App.tsx                  # Root component — all filter state lives here
├── types.ts                 # Shared types (LocationFacility, LocationData, SportCategory)
├── components/
│   ├── FilterBar.tsx        # Sport, date, location, time range, and filter controls
│   ├── TimelineView.tsx     # Court grid grouped by location, sorted by distance
│   ├── CourtRow.tsx         # Single court's hourly slot row
│   ├── SlotCell.tsx         # Individual time slot cell with tooltip and booking link
│   └── ThemeToggle.tsx      # Light/dark mode toggle button
├── hooks/
│   ├── useLocations.ts      # Fetches 72+ DBKL locations (cached for session)
│   ├── useFacility.ts       # Fetches court slots for a single location
│   ├── useAllFacilities.ts  # Batch-fetches all locations (10 at a time, 200ms delay)
│   ├── useLocationDetails.ts # Fetches lat/lng and parliament info per location (localStorage-cached)
│   ├── useUserLocation.ts   # Browser geolocation (runs once at mount)
│   ├── useTheme.ts          # Dark/light mode state synced to localStorage and DOM
│   └── useMediaQuery.ts     # Reactive CSS media query hook
├── utils/
│   ├── consecutiveSlots.ts  # TIME_ORDER (8 AM → 12 AM), per-hour availability and filtering
│   ├── facilityCache.ts     # Session cache of court availability, shared by both fetch hooks
│   ├── date.ts              # Local-timezone YYYY-MM-DD helpers (never toISOString)
│   ├── distance.ts          # Haversine formula (2× road factor), isValidMalaysiaCoord()
│   └── geocoding.ts         # Nominatim integration for coordinate lookup by name
└── index.css                # Tailwind imports and global styles
```

## Architecture

### State Management

All filter state (`sport`, `date`, `locationId`, `nearMeOnly`, `minConsecutiveSlots`, `minCourtsNeeded`, `timeRangeStart`, `timeRangeEnd`) is managed with `useState` in `App.tsx` and passed down as props. Filtering and sorting logic lives in `useMemo` hooks.

### Data Flow

1. **Locations load** — `useLocations` fetches all DBKL locations filtered by the selected sport category
2. **Batch fetch** — `useAllFacilities` fetches court data for all locations in batches of 10 with a 200ms inter-batch delay, reporting progress
3. **Geolocation** — `useUserLocation` gets the user's position; `useLocationDetails` fetches each venue's coordinates, falling back to Nominatim via `geocodeByName()` when DBKL's coordinates fail validation
4. **Filter & sort** — `App.tsx` filters results by consecutive slots, time range, minimum courts, proximity, and selected location — then sorts by distance
5. **Render** — `TimelineView` displays the filtered venues with `CourtRow` and `SlotCell` components

### Caching Strategy

| Data                            | Cache location                            | Lifetime                                     |
| ------------------------------- | ----------------------------------------- | -------------------------------------------- |
| Location list                   | Module-level variable                     | Session (no re-fetch)                        |
| Court availability              | Module-level `Map` (`facilityCache.ts`)   | 10 minutes, or until Refresh clears it       |
| Location coordinates + geocodes | `localStorage` (`dbkl_location_details_v3`) | 30 days; 24 hours for a failed lookup        |

Court availability is shared by `useFacility` and `useAllFacilities`, so the two never fetch the same venue twice — switching between a single venue and all locations, or back to a date visited minutes ago, costs no requests at all. It is deliberately not persisted: stale bookings surviving across sessions would be worse than a re-fetch. The refresh button clears this cache before re-fetching.

## API Integration

The app consumes four DBKL public endpoints (no authentication required) and one external geocoding service:

### DBKL APIs

| Endpoint                                                                                              | Purpose                                           |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `GET /api/public/v1/location/getCategoryByLocation`                                                   | Fetch all locations and their sport categories    |
| `GET /api/public/v1/location/facility?sub_category={sport}&location_id={id}&search_date={YYYY-MM-DD}` | Court availability for a location on a given date |
| `GET /api/public/v1/location?id={id}`                                                                 | Location coordinates (latitude/longitude)         |
| `GET /api/public/v1/parliment?id={id}`                                                                | Parliament/constituency name for a location       |

Base URL: `https://apihub.dbkl.gov.my`

### Nominatim Geocoding (Fallback)

- **Endpoint**: `https://nominatim.openstreetmap.org/search`
- **Purpose**: Look up coordinates when DBKL returns invalid or missing lat/lng
- **Rate limit**: ~1 request/second (per Nominatim usage policy)

## Usage

1. **Select a sport** from the dropdown (defaults to Badminton)
2. **Pick a date** using the date picker or the previous/next day buttons
3. **Optionally filter by location** — type to search, or toggle "Near Me" to show only nearby venues
4. **Set time preferences** — choose a time range and/or minimum consecutive slots
5. **Set minimum courts** if you need multiple courts at the same venue
6. **Browse results** — venues are sorted by distance; scroll the timeline to see hourly availability
7. **Book** — hover or tap a green slot to see pricing and get a link to the DBKL booking page

## Performance

- **Batch loading**: Fetches 10 locations at a time with progress indicator to avoid overwhelming the API
- **Session caching**: Location list fetched once per session; coordinates cached in `localStorage`
- **No backend**: Entirely client-side — all data comes directly from DBKL's public API
- **Optimized re-renders**: Filtering and sorting use `useMemo`; callbacks use `useCallback`

## Browser Support

- Chrome / Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome for Android)

## CORS Note

The app calls DBKL APIs directly from the browser. If you encounter CORS errors in development, uncomment the proxy configuration in `vite.config.ts` to relay requests through the Vite dev server.

## License

This project is open source and available for personal and commercial use.

## Acknowledgments

- [DBKL](https://www.dbkl.gov.my/) for providing public API access to facility data
- [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/) for geocoding services
- [Tailwind CSS](https://tailwindcss.com/) for utility-first styling
- [React](https://react.dev/) for the component framework
- [Vite](https://vite.dev/) for the build tooling
