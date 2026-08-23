import { memo, useState } from 'react';
import { LocationFacilityTime } from '../utils/consecutiveSlots';

interface SlotCellProps {
  slot: LocationFacilityTime;
  columnSpan: number;
  bookingUrl?: string;
  /**
   * Where to anchor the tooltip. Centred by default, but the columns at either
   * end anchor inward — a centred tooltip on the last column runs past the card
   * (where it gets clipped) and past the viewport on a phone, which makes the
   * whole page scroll sideways.
   */
  align?: 'start' | 'center' | 'end';
}

/*
  Booked cells carry diagonal stripes as well as a grey fill. Availability is the
  one thing this grid exists to communicate, so it must not rest on colour alone
  — and the stripe also separates "booked" from the near-identical grey of an
  hour the venue does not open at all.
*/
const BOOKED_STRIPES =
  'bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,rgba(71,85,105,0.3)_2px,rgba(71,85,105,0.3)_4px)] dark:bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,rgba(148,163,184,0.28)_2px,rgba(148,163,184,0.28)_4px)]';

// Memoised alongside CourtRow — these are the ~4,600 cells that would otherwise
// re-render on every batch of venues that lands.
export const SlotCell = memo(function SlotCell({ slot, columnSpan, bookingUrl, align = 'center' }: SlotCellProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  // Escape has to hide the tooltip even though the cell keeps focus, or it is
  // not dismissible without moving focus (WCAG 1.4.13). Without this the
  // focus-within reveal below would immediately show it again.
  const [dismissed, setDismissed] = useState(false);

  const price = slot.price ? `, RM ${slot.price}` : '';
  const label = slot.slot_available
    ? `${slot.start_time_value} to ${slot.end_time_value}, available${price}`
    : `${slot.start_time_value} to ${slot.end_time_value}, booked`;

  const alignClass =
    align === 'start'
      ? 'left-0'
      : align === 'end'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  const stateClass = slot.slot_available
    ? 'bg-emerald-500 hover:shadow-[0_0_10px_rgba(74,222,128,0.6)]'
    : `bg-slate-200 dark:bg-slate-700 ${BOOKED_STRIPES}`;

  return (
    /*
      The tooltip is a sibling of the button rather than a child: it holds the
      Book link, and a link nested inside a button is invalid markup that
      keyboard and screen-reader users cannot reach.
    */
    <div
      className="relative group h-11 sm:h-10 hover:z-[5] focus-within:z-[5]"
      style={{ gridColumn: `span ${columnSpan}` }}
      onMouseLeave={() => setDismissed(false)}
      onBlur={(e) => {
        // Keep it open while focus moves into the tooltip's Book link.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setShowTooltip(false);
          setDismissed(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={showTooltip}
        aria-label={label}
        onClick={() => {
          setDismissed(false);
          setShowTooltip((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setShowTooltip(false);
            setDismissed(true);
          }
        }}
        className={`block w-full h-full border border-slate-300/60 dark:border-slate-700/60 transition-all duration-150 rounded-sm active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900 ${stateClass}`}
      />

      {/* `invisible` rather than opacity alone, so the Book link leaves the tab
          order entirely while the tooltip is closed. */}
      <div
        role="tooltip"
        className={`absolute bottom-full ${alignClass} mb-2 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg whitespace-nowrap transition-opacity z-20 shadow-xl ${
          showTooltip
            ? 'opacity-100 visible'
            : dismissed
              ? 'opacity-0 invisible'
              : 'opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible'
        }`}
      >
        <div className="font-semibold">{slot.start_time_value} – {slot.end_time_value}</div>
        {slot.price && (
          <div className="text-slate-500 dark:text-slate-400 mt-0.5">
            {slot.slot_available ? (
              <span className="text-emerald-600 dark:text-emerald-400">RM {slot.price}</span>
            ) : (
              <span>Booked</span>
            )}
          </div>
        )}
        {slot.slot_available && bookingUrl && (
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Book ${slot.start_time_value} to ${slot.end_time_value} on DBKL`}
            className="mt-1.5 flex items-center justify-center gap-1 px-2 py-1 bg-emerald-500 text-white text-xs font-semibold rounded-md hover:bg-emerald-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
          >
            Book
            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current" aria-hidden="true">
              <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
});
