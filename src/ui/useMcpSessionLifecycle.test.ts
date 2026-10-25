import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  state: { hydrated: true, mcpServers: [], mcpToolTimeoutSeconds: 30, toolPromptPreferences: { mcp: true } },
  close: vi.fn(), prime: vi.fn(), reconcile: vi.fn()
}));
vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => unknown) => harness.effects.push(effect)
}));
vi.mock('../stores/runtimeStore', () => ({ useRuntimeStore: (selector: (state: typeof harness.state) => unknown) => selector(harness.state) }));
vi.mock('../engines/mcpRuntime', () => ({
  closeAllMcpSessions: harness.close, primeMcpSessions: harness.prime, reconcileMcpSessions: harness.reconcile
}));
vi.mock('@capacitor/core', () => ({ Capacitor: {} }));
vi.mock('@capacitor/app', () => ({ App: {} }));
import { useMcpSessionLifecycle } from './useMcpSessionLifecycle';

beforeEach(() => {
  vi.clearAllMocks();
  harness.effects = [];
  harness.state.hydrated = true;
  harness.state.toolPromptPreferences.mcp = true;
});

describe('useMcpSessionLifecycle session ownership', () => {
  it.each(['user-off', 'startup-not-ready', 'unhydrated'])('closes sessions when %s', (reason) => {
    harness.state.toolPromptPreferences.mcp = reason !== 'user-off';
    harness.state.hydrated = reason !== 'unhydrated';
    useMcpSessionLifecycle({ enabled: reason !== 'startup-not-ready' });
    harness.effects[0]();
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.prime).not.toHaveBeenCalled();
  });
  it('reconciles and primes only after startup and the user switch allow it', () => {
    useMcpSessionLifecycle({ enabled: true });
    harness.effects[0]();
    expect(harness.reconcile).toHaveBeenCalledWith(harness.state.mcpServers);
    expect(harness.prime).toHaveBeenCalledOnce();
    expect(harness.close).not.toHaveBeenCalled();
  });
});
