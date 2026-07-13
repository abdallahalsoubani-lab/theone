import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSearchDebounce, SEARCH_DEBOUNCE_MS } from '../searchDebounce';

describe('createSearchDebounce (QA Prompt-22 §7.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not flush before the delay elapses', () => {
    const flush = vi.fn();
    const d = createSearchDebounce(flush);

    d.schedule('a', '');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('a');
  });

  it('flushes exactly once with the LAST value after rapid keystrokes', () => {
    const flush = vi.fn();
    const d = createSearchDebounce(flush);

    d.schedule('a', '');
    vi.advanceTimersByTime(100);
    d.schedule('ab', '');
    vi.advanceTimersByTime(100);
    d.schedule('abc', '');
    expect(flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('abc');

    // Nothing else pending afterwards.
    vi.runAllTimers();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('disarms when the query already matches the URL value (sync guard)', () => {
    const flush = vi.fn();
    const d = createSearchDebounce(flush);

    // A stale pending flush (e.g. right before back-navigation)…
    d.schedule('abc', '');
    // …is cancelled once the query and URL agree again.
    d.schedule('abc', 'abc');

    vi.runAllTimers();
    expect(flush).not.toHaveBeenCalled();
  });

  it('cancel() drops the pending flush (unmount path)', () => {
    const flush = vi.fn();
    const d = createSearchDebounce(flush);

    d.schedule('abc', '');
    d.cancel();

    vi.runAllTimers();
    expect(flush).not.toHaveBeenCalled();
  });

  it('respects a custom delay', () => {
    const flush = vi.fn();
    const d = createSearchDebounce(flush, 50);

    d.schedule('x', '');
    vi.advanceTimersByTime(49);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('x');
  });
});
