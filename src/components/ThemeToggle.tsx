import { useTheme } from '../hooks/useTheme';
import type { ThemePreference } from '../hooks/useTheme';

const NEXT: Record<ThemePreference, ThemePreference> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const NAME: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/*
  Three states rather than two. A plain light/dark toggle can only ever set an
  override, so once pressed there is no value left that means "match whatever my
  device is doing" — the only way back was clearing site data.
*/
export function ThemeToggle() {
  const { preference, cycle } = useTheme();
  const next = NEXT[preference];
  const description = `Theme: ${NAME[preference]}. Switch to ${NAME[next].toLowerCase()}.`;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={description}
      title={description}
      className="w-11 h-11 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0
                 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700
                 text-slate-700 dark:text-slate-200
                 hover:bg-white dark:hover:bg-slate-700
                 hover:border-emerald-500/60 dark:hover:border-emerald-500/60
                 active:scale-95
                 transition-all duration-200
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
    >
      {/* The icon shows the current preference, not the next one, so the button
          reports state rather than only advertising an action. */}
      {preference === 'light' && (
        <svg viewBox="0 0 24 24" className="fill-current" width="18" height="18" aria-hidden="true">
          <path d="M12 7a5 5 0 100 10 5 5 0 000-10zm0-5a1 1 0 011 1v2a1 1 0 11-2 0V3a1 1 0 011-1zm0 17a1 1 0 011 1v2a1 1 0 11-2 0v-2a1 1 0 011-1zM3 12a1 1 0 011-1h2a1 1 0 110 2H4a1 1 0 01-1-1zm15 0a1 1 0 011-1h2a1 1 0 110 2h-2a1 1 0 01-1-1zM5.64 5.64a1 1 0 011.41 0l1.42 1.42A1 1 0 117.05 8.46L5.64 7.05a1 1 0 010-1.41zm10.9 10.9a1 1 0 011.41 0l1.42 1.42a1 1 0 11-1.42 1.41l-1.41-1.41a1 1 0 010-1.42zm1.41-10.9a1 1 0 010 1.41l-1.41 1.42a1 1 0 01-1.42-1.42l1.42-1.41a1 1 0 011.41 0zM7.05 16.54a1 1 0 010 1.42l-1.41 1.41a1 1 0 11-1.42-1.41l1.42-1.42a1 1 0 011.41 0z" />
        </svg>
      )}
      {preference === 'dark' && (
        <svg viewBox="0 0 24 24" className="fill-current" width="18" height="18" aria-hidden="true">
          <path d="M21.64 13.01A9 9 0 1110.99 2.36a1 1 0 011.13 1.39A7 7 0 0020.25 11.88a1 1 0 011.39 1.13z" />
        </svg>
      )}
      {preference === 'system' && (
        // A display, for "whatever this device says".
        <svg viewBox="0 0 24 24" className="fill-current" width="18" height="18" aria-hidden="true">
          <path d="M20 4H4a2 2 0 00-2 2v10a2 2 0 002 2h5v2H7v2h10v-2h-2v-2h5a2 2 0 002-2V6a2 2 0 00-2-2zm0 12H4V6h16v10z" />
        </svg>
      )}
    </button>
  );
}
