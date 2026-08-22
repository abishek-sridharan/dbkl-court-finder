import { memo, useState } from 'react';
import { LocationFacilityTime } from '../utils/consecutiveSlots';

interface SlotCellProps {
  slot: LocationFacilityTime;
  columnSpan: number;
  bookingUrl?: string;
}

// Memoised alongside CourtRow — these are the ~4,600 cells that would otherwise
// re-render on every batch of venues that lands.
export const SlotCell = memo(function SlotCell({ slot, columnSpan, bookingUrl }: SlotCellProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const baseClass =
    "relative group h-11 sm:h-10 border border-slate-300/60 dark:border-slate-700/60 cursor-pointer transition-all duration-150 rounded-sm active:scale-95";
  const stateClass = slot.slot_available
    ? "bg-emerald-500 hover:shadow-[0_0_10px_rgba(74,222,128,0.6)] hover:z-[5]"
    : "bg-slate-200 dark:bg-slate-700";

  return (
    <div
      className={`${baseClass} ${stateClass}`}
      style={{ gridColumn: `span ${columnSpan}` }}
      tabIndex={0}
      onClick={() => setShowTooltip((prev) => !prev)}
      onBlur={() => setShowTooltip(false)}
    >
      {/* Tooltip with booking action */}
      <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg whitespace-nowrap transition-opacity z-20 shadow-xl ${
        showTooltip ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
      }`}>
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
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 flex items-center justify-center gap-1 px-2 py-1 bg-emerald-500 text-white text-xs font-semibold rounded-md hover:bg-emerald-600 transition-colors"
          >
            Book
            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current">
              <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
});
