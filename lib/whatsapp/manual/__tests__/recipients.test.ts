import { describe, expect, it } from 'vitest';

import { getMessageRecipients, reachableRecipients } from '../recipients';

/**
 * P61 §1.3.1 — THE recipient rule. Every visibility and send decision in the
 * panel reads from this function, so the type-by-type expectations are
 * pinned here rather than re-derived anywhere else.
 */
const patient = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  phone: `+96279000000${id.slice(-1)}`,
  languagePref: 'AR' as const,
  fullNameEn: `Patient ${id}`,
  fullNameAr: `مريض ${id}`,
  whatsappReachable: true,
  ...over,
});

describe('getMessageRecipients', () => {
  it('SESSION → the one scalar patient', () => {
    const r = getMessageRecipients({
      appointmentType: 'SESSION',
      checkedInAt: null,
      patient: patient('p1'),
      groupPatients: [],
    });
    expect(r.map((x) => x.id)).toEqual(['p1']);
    expect(r[0]!.viaMembership).toBe(false);
  });

  it('STRETCHING (no therapist) → still the one scalar patient', () => {
    const r = getMessageRecipients({
      appointmentType: 'STRETCHING',
      checkedInAt: null,
      patient: patient('p1'),
      groupPatients: [],
    });
    expect(r).toHaveLength(1);
  });

  it('GROUP → every member, in membership order', () => {
    const r = getMessageRecipients({
      appointmentType: 'GROUP',
      checkedInAt: null,
      patient: null,
      groupPatients: [
        { checkedInAt: null, patient: patient('g1') },
        { checkedInAt: null, patient: patient('g2') },
        { checkedInAt: null, patient: patient('g3') },
      ],
    });
    expect(r.map((x) => x.id)).toEqual(['g1', 'g2', 'g3']);
    expect(r.every((x) => x.viaMembership)).toBe(true);
  });

  it('WORKSHOP → its members when it has them, its scalar patient otherwise', () => {
    expect(
      getMessageRecipients({
        appointmentType: 'WORKSHOP',
        checkedInAt: null,
        patient: null,
        groupPatients: [
          { checkedInAt: null, patient: patient('w1') },
          { checkedInAt: null, patient: patient('w2') },
        ],
      }).map((x) => x.id),
    ).toEqual(['w1', 'w2']);
    expect(
      getMessageRecipients({
        appointmentType: 'WORKSHOP',
        checkedInAt: null,
        patient: patient('p1'),
        groupPatients: [],
      }).map((x) => x.id),
    ).toEqual(['p1']);
  });

  it('EVENT → nobody (no patient by definition)', () => {
    expect(
      getMessageRecipients({
        appointmentType: 'EVENT',
        checkedInAt: null,
        patient: null,
        groupPatients: [],
      }),
    ).toEqual([]);
  });

  it('carries the arrival state from the right place: appointment vs membership', () => {
    const apptArrival = new Date('2030-01-01T08:00:00Z');
    const memberArrival = new Date('2030-01-01T09:00:00Z');
    const [scalar] = getMessageRecipients({
      appointmentType: 'SESSION',
      checkedInAt: apptArrival,
      patient: patient('p1'),
      groupPatients: [],
    });
    expect(scalar!.checkedInAt).toBe(apptArrival);
    const members = getMessageRecipients({
      appointmentType: 'GROUP',
      checkedInAt: apptArrival,
      patient: null,
      groupPatients: [
        { checkedInAt: memberArrival, patient: patient('g1') },
        { checkedInAt: null, patient: patient('g2') },
      ],
    });
    expect(members[0]!.checkedInAt).toBe(memberArrival);
    expect(members[1]!.checkedInAt).toBeNull();
  });

  it('reachableRecipients drops the phone-less ones without dropping the rest', () => {
    const all = getMessageRecipients({
      appointmentType: 'GROUP',
      checkedInAt: null,
      patient: null,
      groupPatients: [
        { checkedInAt: null, patient: patient('g1') },
        { checkedInAt: null, patient: patient('g2', { phone: null }) },
      ],
    });
    expect(reachableRecipients(all).map((x) => x.id)).toEqual(['g1']);
  });
});
