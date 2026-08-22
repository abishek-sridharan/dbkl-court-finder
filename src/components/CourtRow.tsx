import React from 'react';
import { LocationFacilityTime, dedupeSlotsByStart, slotSpan } from '../utils/consecutiveSlots';
import { SlotCell } from './SlotCell';

interface CourtRowProps {
  venueName: string;
  slots: LocationFacilityTime[];
  isDimmed: boolean;
  timeSlotIds: string[];
  venueColWidth: number;
  showVenueColumn: boolean;
  bookingUrl?: string;
}

function CourtRowImpl({ venueName, slots, isDimmed, timeSlotIds, venueColWidth, showVenueColumn, bookingUrl }: CourtRowProps) {
  /*
    The API sometimes returns overlapping slot records for the same time window
    (e.g. both a 1-hour "6–7 PM" slot AND a 2-hour "6–8 PM" slot).
    Rendering them all in sequence causes cells to overflow their grid columns,
    so keep one record per start time — the same dedup the filters read through,
    so a cell is never grey while the filters count that hour as free.
  */
  const slotByStartId = React.useMemo(() => dedupeSlotsByStart(slots), [slots]);

  /*
    Walk the header time columns in order. For each column, if we have a slot starting
    there, place it (spanning however many header columns it covers). Skip columns that
    are already covered by a previous multi-hour slot. Columns with no slot get an empty
    placeholder so the grid stays intact.
  */
  const cells: React.ReactNode[] = [];
  let skipUntilCol = 0; // columns with index < skipUntilCol are covered by a previous multi-hour slot

  for (let col = 0; col < timeSlotIds.length; col++) {
    if (col < skipUntilCol) continue;

    const timeId = timeSlotIds[col];
    const slot = slotByStartId.get(timeId);
    if (slot) {
      // Clamp span so it never exceeds the remaining columns
      const span = Math.min(slotSpan(slot), timeSlotIds.length - col);
      if (span > 1) skipUntilCol = col + span;
      cells.push(<SlotCell key={slot.id} slot={slot} columnSpan={span} bookingUrl={bookingUrl} />);
    } else {
      cells.push(
        <div
          key={`empty-${timeId}`}
          className="h-11 sm:h-10 rounded-sm bg-slate-100 dark:bg-slate-800"
        />
      );
    }
  }

  const gridTemplate = showVenueColumn
    ? `${venueColWidth}px repeat(${timeSlotIds.length}, minmax(32px, 1fr))`
    : `repeat(${timeSlotIds.length}, 1fr)`;

  return (
    <div className={`py-1 ${isDimmed ? 'opacity-40' : ''}`}>
      {/* On mobile: venue name as a label above the slots */}
      {!showVenueColumn && (
        <div className="px-1 pb-0.5 font-medium text-xs text-slate-700 dark:text-slate-300 truncate">
          {venueName}
        </div>
      )}
      <div
        className="items-center"
        style={{ display: 'grid', gridTemplateColumns: gridTemplate }}
      >
        {showVenueColumn && (
          <div className="pr-2 font-medium text-sm text-slate-700 dark:text-slate-300 truncate sticky-left bg-white/70 dark:bg-slate-800/60">
            {venueName}
          </div>
        )}
        {cells}
      </div>
    </div>
  );
}

/*
  An all-locations sweep re-renders this component once per batch of venues, and
  each render walks ~16 columns and rebuilds every SlotCell below it — across 60+
  venues that is thousands of cells redrawn for a handful of new rows.

  timeSlotIds is rebuilt from `courts` on every batch, so it needs comparing by
  content; the remaining props are primitives or arrays that keep their identity.
  Props are listed explicitly, so anything added to CourtRowProps must be added
  here too.
*/
export const CourtRow = React.memo(CourtRowImpl, (prev, next) => {
  if (prev.timeSlotIds.length !== next.timeSlotIds.length) return false;
  if (prev.timeSlotIds.some((id, i) => id !== next.timeSlotIds[i])) return false;
  return (
    prev.venueName === next.venueName &&
    prev.slots === next.slots &&
    prev.isDimmed === next.isDimmed &&
    prev.venueColWidth === next.venueColWidth &&
    prev.showVenueColumn === next.showVenueColumn &&
    prev.bookingUrl === next.bookingUrl
  );
});
