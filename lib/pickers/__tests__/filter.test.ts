import { describe, expect, it } from 'vitest';

import {
  filterPickerOptions,
  matchesPickerQuery,
  partitionPillOptions,
  type PickerOption,
} from '../filter';

/**
 * Prompt 47 — the shared filtering brain behind every searchable
 * patient/clinician picker. Bilingual matching, the P15 privacy stance
 * (phone matches only when a surface passes it), and the P20/P30
 * selections-never-hide rule all live here.
 */

const OPTIONS: PickerOption[] = [
  { id: 'p1', label: 'سارة خليل', sublabel: 'Sara Khalil' },
  { id: 'p2', label: 'عبدالله ناصر', sublabel: 'Abdullah Nasser' },
  { id: 'p3', label: 'Omar Ziad', sublabel: 'عمر زياد' },
];

describe('matchesPickerQuery', () => {
  it('matches Arabic names', () => {
    expect(matchesPickerQuery('سارة', 'سارة خليل', 'Sara Khalil')).toBe(true);
    expect(matchesPickerQuery('زياد', 'Omar Ziad', 'عمر زياد')).toBe(true);
  });

  it('matches English names case-insensitively', () => {
    expect(matchesPickerQuery('sara', 'سارة خليل', 'Sara Khalil')).toBe(true);
    expect(matchesPickerQuery('KHALIL', 'سارة خليل', 'Sara Khalil')).toBe(true);
  });

  it('trims whitespace and treats an empty query as match-all', () => {
    expect(matchesPickerQuery('  sara  ', 'x', 'Sara')).toBe(true);
    expect(matchesPickerQuery('   ', 'anything')).toBe(true);
    expect(matchesPickerQuery('', 'anything')).toBe(true);
  });

  it('P15 privacy: matching runs ONLY over the passed fields — a phone query cannot match when phone is not passed', () => {
    // Restricted surface (doctor/therapist viewing patients): phone never
    // enters the searchable fields, so a phone query finds nothing.
    expect(matchesPickerQuery('0790', 'سارة خليل', 'Sara Khalil')).toBe(false);
    // Secretary surface embeds the visible phone in the label — then it matches.
    expect(matchesPickerQuery('0790', 'سارة خليل (+9620790000000)', 'Sara Khalil')).toBe(true);
  });
});

describe('filterPickerOptions (single-select lists)', () => {
  it('filters across label AND sublabel so both scripts find the row', () => {
    expect(filterPickerOptions(OPTIONS, 'khalil').map((o) => o.id)).toEqual(['p1']);
    expect(filterPickerOptions(OPTIONS, 'عمر').map((o) => o.id)).toEqual(['p3']);
    expect(filterPickerOptions(OPTIONS, '').map((o) => o.id)).toEqual(['p1', 'p2', 'p3']);
    expect(filterPickerOptions(OPTIONS, 'zzz')).toEqual([]);
  });
});

describe('partitionPillOptions (P20 therapists / P30 group members)', () => {
  it('keeps SELECTED options visible even when they do not match the query', () => {
    const { selected, unselectedMatches } = partitionPillOptions(OPTIONS, ['p1'], 'omar');
    expect(selected.map((o) => o.id)).toEqual(['p1']); // survives a non-matching query
    expect(unselectedMatches.map((o) => o.id)).toEqual(['p3']);
  });

  it('empty query → every unselected option listed after the selected ones', () => {
    const { selected, unselectedMatches } = partitionPillOptions(OPTIONS, ['p2'], '');
    expect(selected.map((o) => o.id)).toEqual(['p2']);
    expect(unselectedMatches.map((o) => o.id)).toEqual(['p1', 'p3']);
  });

  it('selections are never duplicated into the match list', () => {
    const { unselectedMatches } = partitionPillOptions(OPTIONS, ['p1'], 'sara');
    expect(unselectedMatches.find((o) => o.id === 'p1')).toBeUndefined();
  });
});
