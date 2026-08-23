import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockWalletStore, mockNetworkStore, mockSetWalletConfiguration, mockGetDRepById } = vi.hoisted(
  () => ({
    mockWalletStore: {} as Record<string, unknown>,
    mockNetworkStore: {} as Record<string, unknown>,
    mockSetWalletConfiguration: vi.fn(),
    mockGetDRepById: vi.fn(),
  }),
);

vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive(mockWalletStore) };
});

vi.mock('@/stores/networkStore', async () => {
  const { reactive } = await import('vue');
  const networkStore = reactive(mockNetworkStore);
  return {
    networkStore,
    isBitcoinTip: () => false,
    default: {
      state: networkStore,
      getCurrentEpoch: () => (networkStore['tip'] as { epoch?: number } | null)?.epoch ?? null,
    },
  };
});

vi.mock('@/db/wallet-db', () => ({ setWalletConfiguration: mockSetWalletConfiguration }));
vi.mock('@/api/blockchain-api', () => ({ default: { getDRepById: mockGetDRepById } }));

import store, {
  ALERT_SETTINGS_KEY,
  ALERT_SNOOZES_KEY,
  DEFAULT_DISMISS_EPOCHS,
  DEFAULT_RATIONALE_DROP_POINTS,
  evaluateAlerts,
  isAlertActive,
  MATCH_CRITERIA_KEY,
  type GovernanceAlert,
} from '@/stores/governanceAlertsStore';
import type { Account } from '@/stores/walletStore';
import type { DelegatedDRepRecord, DRepVoteRecord } from '@/shared/composables/useDelegationHealth';

const DREP = 'drep1abc';
const EPOCH = 653;
/** 20-epoch window, expiring at 658, i.e. 5 epochs left = 15 epochs into the window. */
const EXPIRES_AT_WARN = EPOCH + 5;

function account(): Account {
  return {
    active: true,
    drep_id: DREP,
    controlled_amount: '23718000000',
  } as Account;
}

function withAccount(overrides: Partial<Account>): Account {
  return { ...account(), ...overrides } as Account;
}

/** `n` votes, the first `withRationale` of which carry a CIP-136 anchor. */
function votes(n: number, withRationale: number): DRepVoteRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    proposal_id: `action${i}#0`,
    vote: 'Yes',
    block_time: 1_700_000_000 - i * 1000,
    meta_url: i < withRationale ? `https://example.test/rationale/${i}` : null,
  }));
}

function record(overrides: Partial<DelegatedDRepRecord> = {}): DelegatedDRepRecord {
  return {
    drep_id: DREP,
    registered: true,
    active: true,
    expires_epoch_no: EPOCH + 12,
    votes: votes(10, 8),
    ...overrides,
  };
}

function setTip(epoch: number | null): void {
  mockNetworkStore['tip'] = epoch === null ? null : { epoch };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockWalletStore)) delete mockWalletStore[key];
  for (const key of Object.keys(mockNetworkStore)) delete mockNetworkStore[key];
  Object.assign(mockWalletStore, {
    loggedWallet: { id: 1, chain: 'Cardano', network: 'mainnet' },
    account: account(),
    isLocked: false,
    config: {},
  });
  setTip(EPOCH);
  mockNetworkStore['epochParams'] = null;
  store.reset();
  store.hydrate(true);
});

// ---------------------------------------------------------------------------
// Nothing to watch
// ---------------------------------------------------------------------------

describe('evaluateAlerts: nothing to watch', () => {
  it('returns no alerts when the wallet has no DRep', () => {
    expect(evaluateAlerts(withAccount({ drep_id: '' }), record(), EPOCH)).toEqual([]);
  });

  it('returns no alerts when the account is missing entirely', () => {
    expect(evaluateAlerts(null, record(), EPOCH)).toEqual([]);
  });

  it.each(['drep_always_abstain', 'drep_always_no_confidence'])(
    'returns no alerts for the predefined choice %s, which never expires or retires',
    (keyword) => {
      const expiring = record({ expires_epoch_no: EXPIRES_AT_WARN, registered: false });
      expect(evaluateAlerts(withAccount({ drep_id: keyword }), expiring, EPOCH)).toEqual([]);
    },
  );

  it('returns no alerts when the stake key is not registered', () => {
    const retired = record({ registered: false });
    expect(evaluateAlerts(withAccount({ active: false }), retired, EPOCH)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Inactivity
// ---------------------------------------------------------------------------

describe('evaluateAlerts: inactivity', () => {
  it('fires at the 15-of-20 boundary, i.e. exactly 5 epochs left', () => {
    const alerts = evaluateAlerts(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH);
    expect(alerts.map((a) => a.kind)).toEqual(['inactivity']);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].facts.epochsLeft).toBe(5);
    expect(alerts[0].facts.epochsSinceVote).toBe(15);
    expect(alerts[0].facts.activityWindow).toBe(20);
  });

  it('stays quiet one epoch before the boundary, at 14 of 20', () => {
    const alerts = evaluateAlerts(account(), record({ expires_epoch_no: EPOCH + 6 }), EPOCH);
    expect(alerts.map((a) => a.kind)).toEqual([]);
  });

  it('escalates to critical once the window has run out', () => {
    const alerts = evaluateAlerts(account(), record({ expires_epoch_no: EPOCH }), EPOCH);
    expect(alerts.map((a) => a.kind)).toEqual(['inactivity']);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].facts.epochsLeft).toBe(0);
  });

  it('honours a moved threshold: at 18 of 20 nothing fires with 5 left', () => {
    const alerts = evaluateAlerts(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH, {
      settings: { inactivityWarnAt: 18 },
    });
    expect(alerts).toEqual([]);
  });

  it('honours a moved threshold: at 18 of 20 it fires with 2 left', () => {
    const alerts = evaluateAlerts(account(), record({ expires_epoch_no: EPOCH + 2 }), EPOCH, {
      settings: { inactivityWarnAt: 18 },
    });
    expect(alerts.map((a) => a.kind)).toEqual(['inactivity']);
  });

  it('scales the boundary with a non-default drep_activity window', () => {
    // A 40-epoch window with the same 15-of-N setting warns with 25 left.
    const alerts = evaluateAlerts(account(), record({ expires_epoch_no: EPOCH + 25 }), EPOCH, {
      activityWindow: 40,
    });
    expect(alerts.map((a) => a.kind)).toEqual(['inactivity']);
    expect(alerts[0].facts.activityWindow).toBe(40);
    expect(alerts[0].facts.epochsSinceVote).toBe(15);
  });

  it('says nothing when the epoch is unknown, rather than guessing a countdown', () => {
    const alerts = evaluateAlerts(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), null);
    expect(alerts).toEqual([]);
  });

  it('carries the stake at risk as the lovelace string, never a float', () => {
    const alerts = evaluateAlerts(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH);
    expect(alerts[0].facts.stakeLovelace).toBe('23718000000');
  });
});

// ---------------------------------------------------------------------------
// Retirement
// ---------------------------------------------------------------------------

describe('evaluateAlerts: retirement', () => {
  it('always fires on a deregistered DRep, even with the window wide open', () => {
    const alerts = evaluateAlerts(account(), record({ registered: false }), EPOCH);
    expect(alerts.map((a) => a.kind)).toEqual(['retired']);
    expect(alerts[0].severity).toBe('critical');
  });

  it('outranks inactivity: a retired DRep near expiry raises one alert, not two', () => {
    const alerts = evaluateAlerts(
      account(),
      record({ registered: false, expires_epoch_no: EXPIRES_AT_WARN }),
      EPOCH,
    );
    expect(alerts.map((a) => a.kind)).toEqual(['retired']);
  });

  it('suppresses the rationale alert too: the remedy is a new DRep, not a note', () => {
    const alerts = evaluateAlerts(
      account(),
      record({ registered: false, votes: votes(20, 12) }),
      EPOCH,
      { matchCriteria: { rationaleMin: 70 } },
    );
    expect(alerts.map((a) => a.kind)).toEqual(['retired']);
  });

  it('fires even when the epoch is unknown: deregistration is not a countdown', () => {
    const alerts = evaluateAlerts(account(), record({ registered: false }), null);
    expect(alerts.map((a) => a.kind)).toEqual(['retired']);
  });
});

// ---------------------------------------------------------------------------
// Rationale drop
// ---------------------------------------------------------------------------

describe('evaluateAlerts: rationale drop', () => {
  // 30 votes: the newest 10 carry 2 rationales (20%), the whole run carries 22
  // of 30 (about 73%) — a 53-point fall.
  const falling = () =>
    record({
      votes: [...votes(10, 2), ...votes(20, 20).map((v, i) => ({ ...v, block_time: 1_600_000_000 - i * 1000 }))],
    });

  it('fires when the user named a rationale minimum and the recent rate fell materially', () => {
    const alerts = evaluateAlerts(account(), falling(), EPOCH, {
      matchCriteria: { rationaleMin: 70 },
    });
    expect(alerts.map((a) => a.kind)).toEqual(['rationaleDrop']);
    expect(alerts[0].severity).toBe('info');
    expect(alerts[0].facts.rationaleRecent).toBe(20);
    expect(alerts[0].facts.recentWindow).toBe(10);
  });

  it('stays silent when the user never named a rationale minimum', () => {
    expect(evaluateAlerts(account(), falling(), EPOCH, { matchCriteria: {} })).toEqual([]);
    expect(evaluateAlerts(account(), falling(), EPOCH, { matchCriteria: null })).toEqual([]);
    expect(evaluateAlerts(account(), falling(), EPOCH)).toEqual([]);
  });

  it('stays silent when the setting is switched off', () => {
    const alerts = evaluateAlerts(account(), falling(), EPOCH, {
      matchCriteria: { rationaleMin: 70 },
      settings: { rationaleDropEnabled: false },
    });
    expect(alerts).toEqual([]);
  });

  it('stays silent for a drop below the threshold', () => {
    // Newest 10 carry 7 (70%); the run of 30 carries 27 (90%) — a 20-point fall.
    const wobble = record({
      votes: [...votes(10, 7), ...votes(20, 20).map((v, i) => ({ ...v, block_time: 1_600_000_000 - i * 1000 }))],
    });
    expect(
      evaluateAlerts(account(), wobble, EPOCH, {
        matchCriteria: { rationaleMin: 70 },
        rationaleDropPoints: 21,
      }),
    ).toEqual([]);
  });

  it('fires exactly at the threshold, which is inclusive', () => {
    const wobble = record({
      votes: [...votes(10, 7), ...votes(20, 20).map((v, i) => ({ ...v, block_time: 1_600_000_000 - i * 1000 }))],
    });
    const alerts = evaluateAlerts(account(), wobble, EPOCH, {
      matchCriteria: { rationaleMin: 70 },
      rationaleDropPoints: DEFAULT_RATIONALE_DROP_POINTS,
    });
    expect(alerts.map((a) => a.kind)).toEqual(['rationaleDrop']);
  });

  it('stays silent for a DRep with no votes: n/a is not a fall from grace', () => {
    const alerts = evaluateAlerts(account(), record({ votes: [] }), EPOCH, {
      matchCriteria: { rationaleMin: 70 },
    });
    expect(alerts).toEqual([]);
  });

  it('can accompany an inactivity alert, since the two are different facts', () => {
    const alerts = evaluateAlerts(
      account(),
      { ...falling(), expires_epoch_no: EXPIRES_AT_WARN },
      EPOCH,
      { matchCriteria: { rationaleMin: 70 } },
    );
    expect(alerts.map((a) => a.kind)).toEqual(['inactivity', 'rationaleDrop']);
  });
});

// ---------------------------------------------------------------------------
// Snooze
// ---------------------------------------------------------------------------

describe('isAlertActive', () => {
  const alert = (overrides: Partial<GovernanceAlert> = {}): GovernanceAlert =>
    ({
      id: 'inactivity:drep1abc',
      kind: 'inactivity',
      severity: 'warning',
      epoch: EPOCH,
      drepId: DREP,
      dismissedUntilEpoch: null,
      facts: {
        epochsSinceVote: 15,
        epochsLeft: 5,
        activityWindow: 20,
        rationaleRecent: null,
        rationaleLongRun: null,
        recentWindow: 10,
        stakeLovelace: '1',
      },
      ...overrides,
    }) as GovernanceAlert;

  it('shows an alert that was never snoozed', () => {
    expect(isAlertActive(alert(), EPOCH)).toBe(true);
  });

  it('hides it one epoch before the snooze expires', () => {
    expect(isAlertActive(alert({ dismissedUntilEpoch: EPOCH + 1 }), EPOCH)).toBe(false);
  });

  it('shows it again on the exact epoch the snooze names', () => {
    expect(isAlertActive(alert({ dismissedUntilEpoch: EPOCH }), EPOCH)).toBe(true);
  });

  it('shows it after the snooze epoch has passed', () => {
    expect(isAlertActive(alert({ dismissedUntilEpoch: EPOCH - 1 }), EPOCH)).toBe(true);
  });

  it('shows a snoozed alert when the epoch is unknown rather than withholding a fact', () => {
    expect(isAlertActive(alert({ dismissedUntilEpoch: EPOCH + 5 }), null)).toBe(true);
  });

  it('never hides a retirement, whatever a stale snooze says', () => {
    const retired = alert({ kind: 'retired', id: 'retired:drep1abc', dismissedUntilEpoch: EPOCH + 99 });
    expect(isAlertActive(retired, EPOCH)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Store behaviour
// ---------------------------------------------------------------------------

describe('store.evaluate', () => {
  it('stores the alerts, the DRep and a timestamp', () => {
    store.evaluate(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH);
    expect(store.state.alerts.map((a) => a.kind)).toEqual(['inactivity']);
    expect(store.state.drepId).toBe(DREP);
    expect(store.state.evaluatedAt).toBeTypeOf('number');
  });

  it('reads the saved Match criteria off the wallet config when none are passed', () => {
    (mockWalletStore['config'] as Record<string, unknown>)[MATCH_CRITERIA_KEY] = { rationaleMin: 70 };
    const falling = record({
      votes: [...votes(10, 2), ...votes(20, 20).map((v, i) => ({ ...v, block_time: 1_600_000_000 - i * 1000 }))],
    });
    store.evaluate(account(), falling, EPOCH);
    expect(store.state.alerts.map((a) => a.kind)).toEqual(['rationaleDrop']);
  });

  it('reads drep_activity off the epoch params', () => {
    mockNetworkStore['epochParams'] = { dRepInactivityPeriod: 40 };
    store.evaluate(account(), record({ expires_epoch_no: EPOCH + 25 }), EPOCH);
    expect(store.state.alerts[0].facts.activityWindow).toBe(40);
  });

  it('clears the alerts when the DRep delegation goes away', () => {
    store.evaluate(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH);
    expect(store.state.alerts).toHaveLength(1);
    store.evaluate(withAccount({ drep_id: '' }), null, EPOCH);
    expect(store.state.alerts).toEqual([]);
  });
});

describe('store.snooze', () => {
  beforeEach(() => {
    store.evaluate(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH);
  });

  it('"remind me at 18" defers to the epoch the window reaches 18 of 20', () => {
    store.snooze('inactivity:drep1abc', 18);
    // 15 epochs in now, so 18 arrives three epochs from here.
    expect(store.state.alerts[0].dismissedUntilEpoch).toBe(EPOCH + 3);
    expect(store.activeAlerts(EPOCH)).toHaveLength(0);
    expect(store.activeAlerts(EPOCH + 3)).toHaveLength(1);
  });

  it('never defers by less than one epoch, even for a target already passed', () => {
    store.snooze('inactivity:drep1abc', 10);
    expect(store.state.alerts[0].dismissedUntilEpoch).toBe(EPOCH + 1);
  });

  it('persists the snooze to the wallet config so it survives a reload', () => {
    store.snooze('inactivity:drep1abc', 18);
    expect(mockSetWalletConfiguration).toHaveBeenCalledWith(1, ALERT_SNOOZES_KEY, {
      'inactivity:drep1abc': EPOCH + 3,
    });
  });

  it('re-applies a stored snooze when the same alert is evaluated again', () => {
    store.snooze('inactivity:drep1abc', 18);
    store.evaluate(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH);
    expect(store.state.alerts[0].dismissedUntilEpoch).toBe(EPOCH + 3);
    expect(store.activeAlerts(EPOCH)).toHaveLength(0);
  });

  it('refuses to snooze a retirement', () => {
    store.evaluate(account(), record({ registered: false }), EPOCH);
    store.snooze('retired:drep1abc', 18);
    expect(store.state.alerts[0].dismissedUntilEpoch).toBeNull();
    expect(store.activeAlerts(EPOCH)).toHaveLength(1);
  });

  it('drops a snooze once its alert stops firing, so a recurrence is not muted', () => {
    store.snooze('inactivity:drep1abc', 18);
    // The DRep votes: the window resets and the alert clears.
    store.evaluate(account(), record({ expires_epoch_no: EPOCH + 20 }), EPOCH);
    expect(store.state.alerts).toEqual([]);
    // It lapses again later; the old snooze must not still be in force.
    store.evaluate(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH);
    expect(store.state.alerts[0].dismissedUntilEpoch).toBeNull();
    expect(store.activeAlerts(EPOCH)).toHaveLength(1);
  });
});

describe('store.dismiss', () => {
  it('defers by the flat dismissal window rather than deleting the fact', () => {
    store.evaluate(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH);
    store.dismiss('inactivity:drep1abc');
    expect(store.state.alerts[0].dismissedUntilEpoch).toBe(EPOCH + DEFAULT_DISMISS_EPOCHS);
    expect(store.activeAlerts(EPOCH)).toHaveLength(0);
    expect(store.activeAlerts(EPOCH + DEFAULT_DISMISS_EPOCHS)).toHaveLength(1);
  });
});

describe('store.alertCount', () => {
  it('counts only the alerts that are not snoozed', () => {
    const falling = record({
      expires_epoch_no: EXPIRES_AT_WARN,
      votes: [...votes(10, 2), ...votes(20, 20).map((v, i) => ({ ...v, block_time: 1_600_000_000 - i * 1000 }))],
    });
    store.evaluate(account(), falling, EPOCH, { matchCriteria: { rationaleMin: 70 } });
    expect(store.alertCount()).toBe(2);
    store.snooze('inactivity:drep1abc', 18);
    expect(store.alertCount()).toBe(1);
  });

  it('is zero when there is no DRep to watch', () => {
    store.evaluate(withAccount({ drep_id: '' }), null, EPOCH);
    expect(store.alertCount()).toBe(0);
  });
});

describe('store settings', () => {
  it('persists a changed threshold and applies it on the next evaluation', () => {
    store.setSettings({ inactivityWarnAt: 18 });
    expect(mockSetWalletConfiguration).toHaveBeenCalledWith(1, ALERT_SETTINGS_KEY, {
      inactivityWarnAt: 18,
      rationaleDropEnabled: true,
      pushEnabled: false,
    });
    store.evaluate(account(), record({ expires_epoch_no: EXPIRES_AT_WARN }), EPOCH);
    expect(store.state.alerts).toEqual([]);
  });

  it('forces pushEnabled false: there is no push channel to enable', () => {
    store.setSettings({ pushEnabled: true });
    expect(store.state.settings.pushEnabled).toBe(false);
  });

  it('hydrates the saved settings off the wallet config, still forcing push off', () => {
    (mockWalletStore['config'] as Record<string, unknown>)[ALERT_SETTINGS_KEY] = {
      inactivityWarnAt: 12,
      rationaleDropEnabled: false,
      pushEnabled: true,
    };
    (mockWalletStore['config'] as Record<string, unknown>)[ALERT_SNOOZES_KEY] = { 'inactivity:drep1abc': 700 };
    store.hydrate(true);
    expect(store.state.settings).toEqual({
      inactivityWarnAt: 12,
      rationaleDropEnabled: false,
      pushEnabled: false,
    });
    expect(store.state.snoozes).toEqual({ 'inactivity:drep1abc': 700 });
  });
});

describe('store.refresh', () => {
  it('fetches the delegated DRep once and evaluates it', async () => {
    mockGetDRepById.mockResolvedValue(record({ expires_epoch_no: EXPIRES_AT_WARN }));
    await store.refresh();
    expect(mockGetDRepById).toHaveBeenCalledWith(DREP, 'Cardano', 'mainnet');
    expect(store.state.alerts.map((a) => a.kind)).toEqual(['inactivity']);
    expect(store.state.loading).toBe(false);
  });

  it('never fetches for a predefined choice', async () => {
    mockWalletStore['account'] = withAccount({ drep_id: 'drep_always_abstain' });
    await store.refresh();
    expect(mockGetDRepById).not.toHaveBeenCalled();
    expect(store.state.alerts).toEqual([]);
  });

  it('keeps the last known alerts up when the lookup fails', async () => {
    mockGetDRepById.mockResolvedValueOnce(record({ expires_epoch_no: EXPIRES_AT_WARN }));
    await store.refresh();
    mockGetDRepById.mockRejectedValueOnce(new Error('indexer down'));
    await store.refresh();
    expect(store.state.error).toBe('indexer down');
    expect(store.state.alerts.map((a) => a.kind)).toEqual(['inactivity']);
  });

  it('resets rather than fetching while the wallet is locked', async () => {
    mockWalletStore['isLocked'] = true;
    await store.refresh();
    expect(mockGetDRepById).not.toHaveBeenCalled();
    expect(store.state.alerts).toEqual([]);
  });

  it('resets rather than fetching on a non-Cardano wallet', async () => {
    mockWalletStore['loggedWallet'] = { id: 2, chain: 'Bitcoin', network: 'mainnet' };
    await store.refresh();
    expect(mockGetDRepById).not.toHaveBeenCalled();
  });
});
