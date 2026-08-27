import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
/** What the user asked for, which is not always a colour: "system" defers. */
export type ThemePreference = Theme | 'system';

interface UseThemeReturn {
  /** The theme actually applied right now. */
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** light → dark → system → light */
  cycle: () => void;
}

const STORAGE_KEY = 'theme';
const CYCLE: ThemePreference[] = ['light', 'dark', 'system'];

/*
  Stored values are 'light', 'dark' or 'system'. A missing key also means
  system, so anyone who never touched the toggle keeps following their OS, and
  anyone who set light or dark before this existed keeps that choice.
*/
function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage unavailable — fall through to system.
  }
  return 'system';
}

function readSystemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');

  // Keep the browser's own chrome in step with the page. index.html carries a
  // single theme-color tag rather than a prefers-color-scheme pair, because
  // those follow the OS and would contradict the page whenever the user
  // overrides it. Reading --color-bg-base back after the class change keeps the
  // tint tied to the actual background instead of a second copy of the hex
  // values that could drift from it.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const background = getComputedStyle(root).getPropertyValue('--color-bg-base').trim();
  if (background) meta.setAttribute('content', background);
}

export function useTheme(): UseThemeReturn {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemTheme, setSystemTheme] = useState<Theme>(readSystemTheme);

  const theme: Theme = preference === 'system' ? systemTheme : preference;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /*
    Track the OS setting continuously and let `preference` decide whether it is
    used. The previous version instead ignored the event whenever anything was
    stored, which made an explicit choice permanent — there was no value that
    meant "go back to following the system".
  */
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be disabled; the choice still applies for this session.
    }
    setPreferenceState(next);
  }, []);

  const cycle = useCallback(() => {
    setPreference(CYCLE[(CYCLE.indexOf(preference) + 1) % CYCLE.length]);
  }, [preference, setPreference]);

  return { theme, preference, setPreference, cycle };
}
