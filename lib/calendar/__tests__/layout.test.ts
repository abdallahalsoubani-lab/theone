import { describe, expect, it } from 'vitest';

import { layoutColumn, type LayoutBox, type LayoutInput } from '../layout';

/** Two items overlap in time iff start < other.end AND other.start < end. */
function overlapsInTime(a: LayoutInput, b: LayoutInput): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/** Horizontal [left, left+width) ranges intersect. */
function rectsIntersect(a: LayoutBox, b: LayoutBox): boolean {
  return (
    a.leftFraction < b.leftFraction + b.widthFraction &&
    b.leftFraction < a.leftFraction + a.widthFraction
  );
}

const EPS = 1e-9;

/** The core invariant: time-overlapping items never share horizontal space. */
function assertNoOverlapBleed(items: LayoutInput[], boxes: LayoutBox[]) {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (overlapsInTime(a, b)) {
        const ba = byId.get(a.id)!;
        const bb = byId.get(b.id)!;
        expect(
          rectsIntersect(ba, bb),
          `${a.id} & ${b.id} overlap in time but their rectangles intersect`,
        ).toBe(false);
      }
    }
  }
  // No zero/negative widths, ever.
  for (const box of boxes) expect(box.widthFraction).toBeGreaterThan(0);
}

const appt = (id: string, startMinute: number, endMinute: number): LayoutInput => ({
  id,
  startMinute,
  endMinute,
});

describe('layoutColumn — overlap algorithm', () => {
  it('no overlap → every appointment full width', () => {
    const items = [appt('a', 540, 570), appt('b', 600, 630), appt('c', 660, 690)];
    const boxes = layoutColumn(items);
    for (const box of boxes) {
      expect(box.widthFraction).toBe(1);
      expect(box.leftFraction).toBe(0);
      expect(box.columns).toBe(1);
    }
    assertNoOverlapBleed(items, boxes);
  });

  it('adjacent (touching) appointments are NOT treated as overlapping', () => {
    const items = [appt('a', 540, 570), appt('b', 570, 600)];
    const boxes = layoutColumn(items);
    expect(boxes.every((b) => b.widthFraction === 1)).toBe(true);
  });

  it('two overlapping → two half-width side-by-side columns', () => {
    const items = [appt('a', 540, 600), appt('b', 570, 630)];
    const boxes = layoutColumn(items);
    expect(boxes.map((b) => b.widthFraction)).toEqual([0.5, 0.5]);
    expect(new Set(boxes.map((b) => b.colIndex))).toEqual(new Set([0, 1]));
    assertNoOverlapBleed(items, boxes);
  });

  it('three mutually overlapping → three columns', () => {
    const items = [appt('a', 540, 660), appt('b', 555, 660), appt('c', 570, 660)];
    const boxes = layoutColumn(items);
    expect(boxes.every((b) => Math.abs(b.widthFraction - 1 / 3) < EPS)).toBe(true);
    expect(new Set(boxes.map((b) => b.colIndex))).toEqual(new Set([0, 1, 2]));
    assertNoOverlapBleed(items, boxes);
  });

  it('partial chain A–B–C (A and C disjoint) → A and C share a sub-column', () => {
    const items = [appt('a', 540, 600), appt('b', 570, 630), appt('c', 600, 660)];
    const boxes = layoutColumn(items);
    const by = Object.fromEntries(boxes.map((b) => [b.id, b]));
    // 2 columns total; A and C in col 0, B in col 1.
    expect(by.a!.columns).toBe(2);
    expect(by.a!.colIndex).toBe(0);
    expect(by.c!.colIndex).toBe(0);
    expect(by.b!.colIndex).toBe(1);
    assertNoOverlapBleed(items, boxes);
  });

  it('staircase / cascading overlaps stay valid', () => {
    const items = [
      appt('a', 540, 580),
      appt('b', 560, 600),
      appt('c', 580, 620),
      appt('d', 600, 640),
    ];
    const boxes = layoutColumn(items);
    assertNoOverlapBleed(items, boxes);
  });

  it('exact duplicates (identical start+end) render side by side, both visible', () => {
    const items = [appt('a', 600, 630), appt('b', 600, 630)];
    const boxes = layoutColumn(items);
    expect(boxes.map((b) => b.widthFraction)).toEqual([0.5, 0.5]);
    assertNoOverlapBleed(items, boxes);
  });

  it('zero-duration appointment does not overlap a neighbour and stays full width', () => {
    const items = [appt('a', 600, 600), appt('b', 615, 645)];
    const boxes = layoutColumn(items);
    expect(boxes.every((b) => b.widthFraction === 1)).toBe(true);
  });

  it('pathological density (10 concurrent) → min-width floor, no zero/negative widths', () => {
    const items = Array.from({ length: 10 }, (_, i) => appt(`a${i}`, 600, 660));
    const boxes = layoutColumn(items, 4);
    for (const box of boxes) {
      expect(box.widthFraction).toBeCloseTo(0.25, 9); // pinned to 1/maxColumns
      expect(box.overflow).toBe(true);
      expect(box.widthFraction).toBeGreaterThan(0);
    }
    // colIndex still spans 0..9 so cards lay out across a scrollable lane.
    expect(new Set(boxes.map((b) => b.colIndex)).size).toBe(10);
  });

  it('is order-independent (returns boxes in input order)', () => {
    const items = [appt('c', 600, 660), appt('a', 540, 600), appt('b', 570, 630)];
    const boxes = layoutColumn(items);
    expect(boxes.map((b) => b.id)).toEqual(['c', 'a', 'b']);
    assertNoOverlapBleed(items, boxes);
  });

  it('empty input → empty output', () => {
    expect(layoutColumn([])).toEqual([]);
  });
});
