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
  /**
   * Half-open range of `timeSlotIds` to draw, for the split day on phones.
   * The walk still starts at column 0 regardless, so a block that begins before
   * the window and runs into it is drawn as a continuation rather than lost.
   */
  fromCol?: number;
  toCol?: number;
}

function CourtRowImpl({ venueName, slots, isDimmed, timeSlotIds, venueColWidth, showVenueColumn, bookingUrl, fromCol = 0, toCol = timeSlotIds.length }: CourtRowProps) {
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

  for (let col = 0; col < toCol; col++) {
    if (col < skipUntilCol) continue;

    const timeId = timeSlotIds[col];
    const slot = slotByStartId.get(timeId);

    if (slot) {
      // Clamp span so it never exceeds the remaining columns
      const span = Math.min(slotSpan(slot), toCol - col);
      if (span > 1) skipUntilCol = col + span;
      // A block starting before the window still occupies its tail of it.
      if (col + span <= fromCol) continue;
      const visibleFrom = Math.max(col, fromCol);
      // Anchor the tooltip inward at either end of the row, so it cannot spill
      // past the card (where it would be clipped) or off a phone screen.
      const align =
        visibleFrom === fromCol ? 'start' : col + span >= toCol ? 'end' : 'center';
      cells.push(
        <SlotCell
          key={slot.id}
          slot={slot}
          columnSpan={col + span - visibleFrom}
          bookingUrl={bookingUrl}
          align={align}
        />
      );
    } else {
      if (col < fromCol) continue;
      // No record for this hour: the venue does not offer a session, which is
      // not the same as one being booked. Flat and unlabelled, versus the
      // striped booked cell, so the two are told apart by shape and not by two
      // near-identical greys.
      cells.push(
        <div
          key={`empty-${timeId}`}
          className="h-11 sm:h-10 rounded-sm bg-slate-100 dark:bg-slate-800"
        />
      );
    }
  }

  const visibleColumns = toCol - fromCol;
  const gridTemplate = showVenueColumn
    ? `${venueColWidth}px repeat(${visibleColumns}, minmax(32px, 1fr))`
    : `repeat(${visibleColumns}, 1fr)`;

  return (
    /*
      Grouped and named by court: without it a slot button announces only
      "6:00 PM to 7:00 PM, available" with no indication of which of a venue's
      courts it belongs to.
    */
    <div
      role="group"
      aria-label={venueName}
      className={`py-1 ${isDimmed ? 'opacity-40' : ''}`}
    >
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
    prev.bookingUrl === next.bookingUrl &&
    prev.fromCol === next.fromCol &&
    prev.toCol === next.toCol
  );
});
