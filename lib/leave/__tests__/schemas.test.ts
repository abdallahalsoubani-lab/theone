import { LeaveType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { leaveRequestSchema } from '../schemas';

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}
function nextWeek() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}

describe('leaveRequestSchema', () => {
  it('accepts a valid payload', () => {
    expect(
      leaveRequestSchema.safeParse({
        leaveType: LeaveType.VACATION,
        startDate: tomorrow(),
        endDate: nextWeek(),
        reason: 'Family trip out of country.',
      }).success,
    ).toBe(true);
  });

  it('rejects past startDate', () => {
    const past = new Date();
    past.setDate(past.getDate() - 1);
    expect(
      leaveRequestSchema.safeParse({
        leaveType: LeaveType.SICK,
        startDate: past,
        endDate: tomorrow(),
        reason: 'Sick yesterday and today.',
      }).success,
    ).toBe(false);
  });

  it('rejects endDate before startDate', () => {
    expect(
      leaveRequestSchema.safeParse({
        leaveType: LeaveType.SICK,
        startDate: nextWeek(),
        endDate: tomorrow(),
        reason: 'Inverted range.',
      }).success,
    ).toBe(false);
  });

  it('rejects a reason shorter than 5 chars', () => {
    expect(
      leaveRequestSchema.safeParse({
        leaveType: LeaveType.PERSONAL,
        startDate: tomorrow(),
        endDate: nextWeek(),
        reason: 'no',
      }).success,
    ).toBe(false);
  });

  it('caps reason at 1000 chars', () => {
    expect(
      leaveRequestSchema.safeParse({
        leaveType: LeaveType.PERSONAL,
        startDate: tomorrow(),
        endDate: nextWeek(),
        reason: 'x'.repeat(1001),
      }).success,
    ).toBe(false);
  });

  it('accepts same startDate and endDate (single-day leave)', () => {
    const d = tomorrow();
    expect(
      leaveRequestSchema.safeParse({
        leaveType: LeaveType.SICK,
        startDate: d,
        endDate: d,
        reason: 'Single doctor appointment.',
      }).success,
    ).toBe(true);
  });
});
