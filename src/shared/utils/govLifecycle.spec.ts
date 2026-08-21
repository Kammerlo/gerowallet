import { describe, it, expect } from 'vitest';
import { epochsRemaining, daysRemaining, statusTone } from '@/shared/utils/govLifecycle';

describe('epochsRemaining', () => {
  it('counts forward from the current epoch', () => {
    expect(epochsRemaining(500, 510)).toBe(10);
  });

  it('is 0 when the expiry epoch has passed', () => {
    expect(epochsRemaining(520, 510)).toBe(0);
  });

  it('is null when either epoch is unknown', () => {
    expect(epochsRemaining(null, 510)).toBeNull();
    expect(epochsRemaining(500, null)).toBeNull();
  });
});

describe('daysRemaining', () => {
  it('converts remaining epochs to days at 5 days per epoch', () => {
    expect(daysRemaining(500, 510)).toBe(50);
  });

  it('is null when unknown', () => {
    expect(daysRemaining(null, null)).toBeNull();
  });
});

describe('statusTone', () => {
  it('maps each status to a semantic tone', () => {
    expect(statusTone('enacted')).toBe('success');
    expect(statusTone('ratified')).toBe('success');
    expect(statusTone('active')).toBe('info');
    expect(statusTone('expired')).toBe('neutral');
    expect(statusTone('dropped')).toBe('neutral');
  });

  it('is case-insensitive', () => {
    expect(statusTone('ENACTED')).toBe('success');
  });

  it('falls back to neutral for an unknown status rather than throwing', () => {
    expect(statusTone('something-new')).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
  });
});
