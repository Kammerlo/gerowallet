// Four render sites share this helper, so the two locked cases can't drift apart:
// a programmable token Gero won't transfer, vs the ADA locked inside those UTxOs
// (priced and counted in the portfolio total, but not spendable through Gero).
import { describe, it, expect } from 'vitest';
import { programmableTooltipKey } from './programmableTokenDisplay';

describe('programmableTooltipKey', () => {
  it('explains locked ADA on the lovelace row', () => {
    expect(programmableTooltipKey('lovelace')).toBe('programmableTokens.lockedAdaTooltip');
  });

  it('explains the transfer restriction on a token row', () => {
    const unit = '8f85b5bbdee80ace3a9f75140818d8fd0f9d9672802c4006e0bee92654657374313233';
    expect(programmableTooltipKey(unit)).toBe('programmableTokens.badgeTooltip');
  });
});
