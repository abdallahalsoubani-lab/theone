import { describe, expect, it } from 'vitest';

import { anyRecipientReachable, panelRecipients } from '../panelRecipients';

/**
 * P61 follow-up — the live bug these pin down:
 *
 * A GROUP booking with exactly ONE member whose phone is on file rendered
 * "No phone number on file for this patient — nothing can be sent." The panel
 * counted recipients from the group members but read the phone from the
 * SCALAR relation, which is null on a GROUP. Two or more members never hit it
 * (the note was gated on `recipientCount === 1`), which is precisely why the
 * P61 service tests — all written against 3-member groups — stayed green.
 */
const GROUP = {
  patientId: '', // the calendar ships '' for a GROUP (patientId ?? '')
  patientPhone: '', // …and no scalar phone, because there is no scalar patient
};

describe('panelRecipients', () => {
  it('REGRESSION: a one-member GROUP yields that member WITH their phone', () => {
    const r = panelRecipients({
      ...GROUP,
      groupPatients: [{ id: 'alaa', phone: '+962788453529' }],
    });
    expect(r).toEqual([{ id: 'alaa', phone: '+962788453529' }]);
    expect(anyRecipientReachable(r)).toBe(true);
  });

  it('REGRESSION: the scalar phone is never consulted for a GROUP', () => {
    // Even with a stale/absent scalar phone the member's number wins.
    const r = panelRecipients({
      patientId: '',
      patientPhone: null,
      groupPatients: [{ id: 'g1', phone: '+962790000001' }],
    });
    expect(r[0]!.phone).toBe('+962790000001');
  });

  it('a multi-member GROUP reports each member and their own phone', () => {
    const r = panelRecipients({
      ...GROUP,
      groupPatients: [
        { id: 'g1', phone: '+962790000001' },
        { id: 'g2', phone: null },
        { id: 'g3', phone: '+962790000003' },
      ],
    });
    expect(r.map((x) => x.id)).toEqual(['g1', 'g2', 'g3']);
    expect(anyRecipientReachable(r)).toBe(true);
  });

  it('a SESSION still reads the scalar patient and its phone', () => {
    const r = panelRecipients({
      patientId: 'p1',
      patientPhone: '+962790123456',
      groupPatients: [],
    });
    expect(r).toEqual([{ id: 'p1', phone: '+962790123456' }]);
  });

  it('a patient-less EVENT has nobody — the section stays hidden', () => {
    expect(panelRecipients({ patientId: '', patientPhone: null, groupPatients: [] })).toEqual([]);
    expect(panelRecipients({ patientId: '', patientPhone: null })).toEqual([]);
  });

  it('the no-phone note fires only when NOBODY is reachable', () => {
    expect(
      anyRecipientReachable(
        panelRecipients({ patientId: 'p1', patientPhone: null, groupPatients: [] }),
      ),
    ).toBe(false);
    expect(
      anyRecipientReachable(
        panelRecipients({ ...GROUP, groupPatients: [{ id: 'g1', phone: null }] }),
      ),
    ).toBe(false);
  });

  it('P15: a Doctor/Therapist viewer gets null phones — but the section is role-gated before this', () => {
    // The calendar nulls every phone for those roles; the helper reports them
    // as unreachable rather than inventing a number.
    const r = panelRecipients({ ...GROUP, groupPatients: [{ id: 'g1', phone: null }] });
    expect(r[0]!.phone).toBeNull();
  });

  it('empty-string phones are normalised to null, not treated as reachable', () => {
    const r = panelRecipients({ patientId: 'p1', patientPhone: '', groupPatients: [] });
    expect(r[0]!.phone).toBeNull();
    expect(anyRecipientReachable(r)).toBe(false);
  });
});
