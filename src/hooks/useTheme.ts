import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

interface UseThemeReturn {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'theme';

function readInitialTheme(): Theme {
  // The FOUC-prevention script in index.html already set the dark class on <html>
  // before React mounts. Source of truth on first render is the actual class.
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return 'dark';
  }
  return 'light';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');

  // Keep the browser's own chrome in step with the toggle. index.html carries a
  // single theme-color tag rather than a prefers-color-scheme pair, because
  // those follow the OS and would contradict the page once the user overrides
  // the theme. Reading --color-bg-base back after the class change keeps the
  // tint tied to the actual page background instead of a second copy of the
  // hex values that could drift from it.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const background = getComputedStyle(root).getPropertyValue('--color-bg-base').trim();
  if (background) meta.setAttribute('content', background);
}

export function useTheme(): UseThemeReturn {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Apply on every change.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow system preference changes — but only when the user has not set an override.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(STORAGE_KEY)) return; // user has chosen explicitly
      setThemeState(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore — storage may be disabled
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
