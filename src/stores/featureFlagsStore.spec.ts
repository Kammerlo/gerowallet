import { featureFlagsStore } from '@/stores/featureFlagsStore';
import featureFlagService from '@/services/featureFlag.service';

vi.mock('@/services/featureFlag.service', () => ({
  default: {
    getFlag: vi.fn((_key: string, fallback: unknown) => fallback),
    onFlagChange: vi.fn(),
  },
}));

test('isTrezorWebUsbEnabled defaults to false', () => {
  expect(featureFlagsStore.state.flags.isTrezorWebUsbEnabled).toBe(false);
});

test('exposes isGovernanceEnabled, defaulting to false', () => {
  expect(featureFlagsStore.isGovernanceEnabled()).toBe(false);
});

test('reflects a remote isGovernanceEnabled flag once loaded', () => {
  vi.mocked(featureFlagService.getFlag).mockImplementation((key: string, fallback: unknown) =>
    key === 'isGovernanceEnabled' ? true : fallback,
  );
  featureFlagsStore.loadFlags();
  expect(featureFlagsStore.isGovernanceEnabled()).toBe(true);
});
