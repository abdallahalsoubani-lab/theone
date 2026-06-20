/**
 * Overlap layout — the core of the custom calendar (Custom Calendar Phase 1).
 *
 * Given the appointments in ONE lane (a therapist column in day view, or a
 * whole day in week view) that may overlap in time, assign each a horizontal
 * sub-column so overlapping appointments render SIDE-BY-SIDE and readable —
 * never stacked-and-clipped (the react-big-calendar failure this replaces).
 *
 * Algorithm (deterministic interval-graph column packing):
 *   1. Sort by start asc, then longer-first, then id (stable).
 *   2. Cluster: a maximal run of transitively-overlapping items. A new item
 *      whose start is ≥ the cluster's running max-end opens a fresh cluster;
 *      non-overlapping clusters never affect each other's widths.
 *   3. Within a cluster, greedily place each item in the first sub-column whose
 *      last item ends ≤ this item's start; else open a new sub-column.
 *   4. Width = 1 / columns; left = colIndex × width.
 *
 * Min-width floor: past `maxColumns` concurrent, width is pinned to
 * 1/maxColumns (cards stay readable) and `overflow` is flagged so the renderer
 * gives the lane horizontal scroll instead of shrinking cards to slivers.
 *
 * Pure — no React, no DOM. Intervals are half-open [start, end): touching
 * (a.end === b.start) is NOT an overlap.
 */

export interface LayoutInput {
  id: string;
  startMinute: number;
  endMinute: number;
}

export interface LayoutBox {
  id: string;
  /** 0-based sub-column within the overlap cluster. */
  colIndex: number;
  /** Total sub-columns the cluster needed (before the min-width floor). */
  columns: number;
  /** Width as a fraction of the lane (1 = full width). */
  widthFraction: number;
  /** Left offset as a fraction of the lane. */
  leftFraction: number;
  /** True when the cluster exceeded `maxColumns` → lane should scroll. */
  overflow: boolean;
}

export const DEFAULT_MAX_COLUMNS = 4;

function compare(a: LayoutInput, b: LayoutInput): number {
  if (a.startMinute !== b.startMinute) return a.startMinute - b.startMinute;
  if (a.endMinute !== b.endMinute) return b.endMinute - a.endMinute; // longer first
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function layoutColumn(items: LayoutInput[], maxColumns = DEFAULT_MAX_COLUMNS): LayoutBox[] {
  const sorted = [...items].sort(compare);
  const boxes: LayoutBox[] = [];

  let cluster: LayoutInput[] = [];
  let clusterMaxEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = []; // running last-end per sub-column
    const colByIndex: number[] = [];
    cluster.forEach((it, i) => {
      let placed = colEnds.findIndex((end) => end <= it.startMinute);
      if (placed === -1) {
        placed = colEnds.length;
        colEnds.push(it.endMinute);
      } else {
        colEnds[placed] = it.endMinute;
      }
      colByIndex[i] = placed;
    });
    const columns = colEnds.length;
    const effectiveColumns = Math.min(columns, maxColumns);
    const overflow = columns > maxColumns;
    const widthFraction = 1 / effectiveColumns;
    cluster.forEach((it, i) => {
      const colIndex = colByIndex[i]!;
      boxes.push({
        id: it.id,
        colIndex,
        columns,
        widthFraction,
        leftFraction: colIndex * widthFraction,
        overflow,
      });
    });
    cluster = [];
    clusterMaxEnd = Number.NEGATIVE_INFINITY;
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.startMinute >= clusterMaxEnd) flush();
    cluster.push(it);
    clusterMaxEnd = Math.max(clusterMaxEnd, it.endMinute);
  }
  flush();

  // Return in the caller's input order so the renderer can zip with its list.
  const order = new Map(items.map((it, i) => [it.id, i]));
  return boxes.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
