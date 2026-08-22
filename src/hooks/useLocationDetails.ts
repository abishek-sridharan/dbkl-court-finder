import { useState, useEffect } from 'react';
import { isValidMalaysiaCoord } from '../utils/distance';
import { geocodeByName } from '../utils/geocoding';

export interface LocationDetail {
  location_id: string;
  lat: number;
  lng: number;
  parliment_id: string;
  parliment_name: string;
  location_name?: string; // For geocoding fallback
}

const CACHE_KEY = 'dbkl_location_details_v3';
// Keys written by earlier versions — removed on load so they stop taking up quota.
const STALE_CACHE_KEYS = ['dbkl_location_details_v2', 'geocode_cache'];

// A venue's coordinates barely change; a failed lookup is usually transient
// (offline, a rate-limited geocoder) and must not disable that venue's distance
// forever, so failures expire far sooner than successes.
const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const FAILURE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  detail: LocationDetail;
  fetchedAt: number;
}

function isUsableDetail(detail: LocationDetail): boolean {
  return Number.isFinite(detail.lat) && Number.isFinite(detail.lng);
}

function isExpired(entry: CacheEntry, now: number): boolean {
  const ttl = isUsableDetail(entry.detail) ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
  return now - entry.fetchedAt > ttl;
}

function loadCache(): Map<string, CacheEntry> {
  try {
    STALE_CACHE_KEYS.forEach(key => localStorage.removeItem(key));

    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return new Map();

    const parsed = JSON.parse(raw) as [string, CacheEntry][];
    if (!Array.isArray(parsed)) return new Map();

    return new Map(
      parsed
        .filter(entry => Array.isArray(entry) && entry[1]?.detail)
        .map(([id, entry]) => [
          id,
          {
            fetchedAt: entry.fetchedAt ?? 0,
            // JSON turns NaN into null on the way out; restore the sentinel so
            // the failure checks above keep working after a reload.
            detail: {
              ...entry.detail,
              lat: entry.detail.lat ?? NaN,
              lng: entry.detail.lng ?? NaN,
            },
          },
        ])
    );
  } catch { /* corrupt cache — ignore */ }
  return new Map();
}

function saveCache(cache: Map<string, CacheEntry>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...cache.entries()]));
  } catch { /* storage full — ignore */ }
}

// Shared in-memory cache for the lifetime of the session (faster than localStorage reads per item)
const memCache = loadCache();

function toDetails(cache: Map<string, CacheEntry>): Map<string, LocationDetail> {
  const details = new Map<string, LocationDetail>();
  cache.forEach((entry, id) => details.set(id, entry.detail));
  return details;
}

// Fetch location detail (lat/lng + parliment_id) then parliment name, with a delay between requests
// If coordinates are bad, try to geocode using venue name as fallback.
async function fetchLocationDetail(locationId: string): Promise<LocationDetail | null> {
  try {
    const locRes = await fetch(`https://apihub.dbkl.gov.my/api/public/v1/location?id=${locationId}`);
    if (!locRes.ok) return null;
    const locData = await locRes.json();
    const loc = locData?.data?.data?.[0];
    if (!loc) return null;

    let lat = parseFloat(loc.latitude);
    let lng = parseFloat(loc.longitude);
    const locationName = String(loc.location_name ?? '');
    const parlimentId = String(loc.parliment_id ?? '');

    // Validate coordinates. If bad, try to geocode using location name.
    if (!isValidMalaysiaCoord(lat, lng)) {
      const geocoded = await geocodeByName(locationName, 'Kuala Lumpur');
      if (geocoded) {
        lat = geocoded.lat;
        lng = geocoded.lng;
      } else {
        // Coordinates are bad and geocoding failed. Skip this location's distance.
        return { location_id: locationId, lat: NaN, lng: NaN, parliment_id: parlimentId, parliment_name: '', location_name: locationName };
      }
    }

    let parlimentName = '';
    if (parlimentId) {
      await new Promise(r => setTimeout(r, 100)); // rate-limit between calls
      const parlRes = await fetch(`https://apihub.dbkl.gov.my/api/public/v1/parliment?id=${parlimentId}`);
      if (parlRes.ok) {
        const parlData = await parlRes.json();
        parlimentName = parlData?.data?.[0]?.name ?? '';
      }
    }

    return { location_id: locationId, lat, lng, parliment_id: parlimentId, parliment_name: parlimentName, location_name: locationName };
  } catch {
    return null;
  }
}

export function useLocationDetails(locationIds: string[]): Map<string, LocationDetail> {
  const [details, setDetails] = useState<Map<string, LocationDetail>>(() => toDetails(memCache));

  useEffect(() => {
    if (locationIds.length === 0) return;

    let cancelled = false;

    const now = Date.now();
    const missingIds = locationIds.filter(id => {
      const entry = memCache.get(id);
      return !entry || isExpired(entry, now);
    });
    if (missingIds.length === 0) return;

    const fetchMissing = async () => {
      // Batch: fetch 5 at a time with 150ms delay between batches to stay under rate limits
      const batchSize = 5;
      for (let i = 0; i < missingIds.length; i += batchSize) {
        if (cancelled) break;
        const batch = missingIds.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(fetchLocationDetail));
        if (cancelled) break;

        let changed = false;
        const fetchedAt = Date.now();
        results.forEach((detail, idx) => {
          if (detail) {
            memCache.set(batch[idx], { detail, fetchedAt });
            changed = true;
          }
        });

        if (changed) {
          saveCache(memCache);
          setDetails(toDetails(memCache));
        }

        if (i + batchSize < missingIds.length) {
          await new Promise(r => setTimeout(r, 150));
        }
      }
    };

    fetchMissing();
    return () => { cancelled = true; };
  }, [locationIds.join(',')]); // stable dependency: join the ids into a string

  return details;
}
